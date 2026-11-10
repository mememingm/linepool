import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  Account, AssignedNumber, InboxQuery, NumbersQuery, ListQuery, PointsQuery, Order, OrderDetail,
  PaginationQuery, PaginatedResponse, SmsMessage, ReceivingMode, ReceivingStatus,
} from '@linepool/contracts';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { type UserRow, toUser } from './authentication.js';
import { ApiFailure } from './http.js';
import { platformCatalog } from '@linepool/contracts';
import { allocationStatus } from './providers/receiving-provider.js';
import { availableStock, receivingOfferEligibility, linePoolAllocationScope, linePoolMessageScope, linePoolOrderScope } from './platform-inventory.js';

export type OrderRow = {
  id: string; order_number: string; region_id: Order['region']; country: string;
  service: Order['service']; plan: Order['plan']; plan_name: string;
  fulfillment_status: Order['status']; completed_at: Date | null;
  quantity: number; unit_points: number; total_points: number; duration_days: number | null; receiving_mode: ReceivingMode; window_minutes: 15 | null;
  receiving_status?: ReceivingStatus | null; first_message_id?: string | null; created_at: Date; area_code?: string | null;
};
export type NumberRow = {
  id: string; phone_number: string; region_id: AssignedNumber['region']; country: string;
  service: AssignedNumber['service']; order_id: string | null; assigned_at: Date; expires_at: Date;
  allocation_id: string; message_count: number; unread_count: number;
  source?: 'DIRECT' | 'AGENT'; provided_by?: string | null; released_at?: Date | null;
  receiving_mode: ReceivingMode; receiving_status: ReceivingStatus | null; first_message_id: string | null; receiving_ends_at: Date;
};
export const orderSelect = `SELECT o.*,r.name AS country,
  (SELECT a.receiving_status FROM number_allocations a WHERE a.order_id=o.id AND a.receiving_mode='ONE_TIME') AS receiving_status,
  (SELECT a.first_message_id FROM number_allocations a WHERE a.order_id=o.id AND a.receiving_mode='ONE_TIME') AS first_message_id
  FROM orders o JOIN regions r ON r.id=o.region_id`;
export const numberSelect = `SELECT n.id,n.phone_number,n.region_id,a.platform_id AS service,a.order_id,a.assigned_at,a.released_at,
  a.receiving_mode,a.receiving_status,a.first_message_id,a.expires_at AS receiving_ends_at,
  CASE WHEN a.agent_entitlement_id IS NULL THEN 'DIRECT' ELSE 'AGENT' END AS source,
  (SELECT supplier.name FROM service_entitlements e JOIN number_holdings holding ON holding.id=e.holding_id
    LEFT JOIN customers customer ON customer.id=holding.customer_id
    LEFT JOIN number_holdings previous ON previous.id=holding.source_holding_id
    LEFT JOIN agents supplier ON supplier.id=COALESCE(customer.agent_id,previous.agent_id)
    WHERE e.id=a.agent_entitlement_id) AS provided_by,
  LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at)) AS expires_at,a.id AS allocation_id,r.name AS country,
  (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id) AS message_count,
  (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id AND NOT m.is_read) AS unread_count
  FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN regions r ON r.id=n.region_id`;
export function toOrder(row: OrderRow): Order {
  return {
    id: row.id, orderNumber: row.order_number, region: row.region_id, country: row.country,
    service: row.service, plan: row.plan, planName: row.plan_name, areaCode: row.area_code ?? null,
    quantity: row.quantity, unitPoints: row.unit_points, totalPoints: row.total_points,
    durationDays: row.duration_days, receivingMode: row.receiving_mode, windowMinutes: row.window_minutes,
    receivingStatus: row.receiving_status ?? null, firstMessageId: row.first_message_id ?? null,
    createdAt: row.created_at.toISOString(), status: row.fulfillment_status,
    completedAt: row.completed_at?.toISOString() ?? null, isDemo: true,
  };
}
export function toNumber(row: NumberRow): AssignedNumber {
  return {
    id: row.id, allocationId: row.allocation_id, phoneNumber: row.phone_number, region: row.region_id, country: row.country,
    service: row.service, source: row.source ?? 'DIRECT', providedBy: row.provided_by ?? null,
    orderId: row.order_id, assignedAt: row.assigned_at.toISOString(),
    expiresAt: row.expires_at.toISOString(), status: row.receiving_status === 'WAITING' ? 'ACTIVE'
      : row.receiving_mode === 'ONE_TIME' || row.released_at ? 'EXPIRED' : allocationStatus(row.expires_at),
    remainingDays: row.released_at ? 0 : Math.max(0, Math.ceil((row.expires_at.getTime() - Date.now()) / 86400000)),
    messageCount: row.message_count, unreadCount: row.unread_count, isDemo: true,
    receivingMode: row.receiving_mode, receivingStatus: row.receiving_status, firstMessageId: row.first_message_id,
    receivingStartedAt: row.receiving_mode === 'ONE_TIME' ? row.assigned_at.toISOString() : null,
    receivingEndsAt: row.receiving_mode === 'ONE_TIME' ? row.receiving_ends_at.toISOString() : null,
  };
}
class Where {
  readonly values: unknown[] = [];
  readonly clauses: string[] = [];
  add(sql: string, value: unknown) {
    this.values.push(value);
    this.clauses.push(sql.replaceAll('?', `$${this.values.length}`));
  }
  raw(sql: string) { this.clauses.push(sql); }
  get sql() { return this.clauses.join(' AND '); }
  search(sql: string, search: string) {
    if (search) this.add(sql, `%${search.replace(/[\\%_]/g, '\\$&')}%`);
  }
}
export const pagination = (input: PaginationQuery, totalItems: number) => ({
  page: input.page, pageSize: input.pageSize, totalItems, totalPages: Math.ceil(totalItems / input.pageSize),
});
@Injectable()
export class Workspace {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  async catalog() {
    const from = 'FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id';
    // The storefront lists stock of the configured provider only: Mock slots in Mock mode, real PinClode slots in real mode.
    const real = this.environment.pcProvider === 'pingcode';
    // "Each shop sells its own": in real mode the storefront lists the ACTIVE official shop's products, shaped like
    // offers, and counts only that shop's numbers. Mock mode keeps the site-wide offers.
    const source = real ? `(SELECT sp.region_id,sp.platform_id AS service,sp.plan,sp.name,sp.duration_days,sp.unit_points,sp.is_active,
        ''::text AS area_prefix,'RECEIVE'::text AS capability,false AS allow_renewal,'HOSTED'::text AS receiving_mode,NULL::integer AS window_minutes,
        sh.connection_id FROM shop_products sp JOIN shops sh ON sh.id=sp.shop_id
        WHERE sh.site_id='linepool' AND sh.kind='OFFICIAL' AND sh.status='ACTIVE' AND NOT sp.admin_hold)` : 'offers';
    const stock = `${availableStock('o.duration_days', 'o.receiving_mode')} AND ${receivingOfferEligibility()} AND s.provider='${this.environment.pcProvider}'
      ${real ? 'AND n.upstream_account_id=o.connection_id' : ''}
      AND n.region_id=o.region_id AND s.platform_id=o.service AND n.capability=o.capability
      AND starts_with(n.phone_number,o.area_prefix)`;
    const [regions, offers, areas] = await Promise.all([
      this.db.query<{ id: AssignedNumber['region']; name: string; english: string; prefix: string; area: string; available_count: number }>(
        `SELECT r.*,(SELECT count(DISTINCT n.id)::int ${from} JOIN ${source} o ON o.region_id=n.region_id AND o.service=s.platform_id
          WHERE n.region_id=r.id AND o.is_active AND o.capability='RECEIVE' AND NOT o.allow_renewal AND ${stock}) AS available_count
         FROM regions r WHERE r.is_active AND r.id='us' ORDER BY r.sort_order,r.id`,
      ),
      this.db.query<{ region_id: Order['region']; service: Order['service']; plan: Order['plan']; name: string; duration_days: number | null; receiving_mode: ReceivingMode; window_minutes: 15 | null; unit_points: number; available_count: number }>(
        `SELECT o.*,(SELECT count(*)::int ${from} WHERE ${stock}) AS available_count
         FROM ${source} o JOIN regions r ON r.id=o.region_id JOIN platforms p ON p.id=o.service
         WHERE o.is_active AND p.is_active AND r.is_active AND o.region_id='us' AND ${receivingOfferEligibility()}
         AND o.capability='RECEIVE' AND NOT o.allow_renewal ORDER BY o.region_id,o.service,o.receiving_mode,o.duration_days`,
      ),
      this.db.query<{ service: string; plan: string; code: string; available_count: number }>(
        `SELECT o.service,o.plan,substring(n.phone_number FROM 3 FOR 3) AS code,count(*)::int AS available_count
         ${from} JOIN ${source} o ON o.region_id=n.region_id AND o.service=s.platform_id JOIN regions r ON r.id=o.region_id
         WHERE o.region_id='us' AND o.is_active AND r.is_active AND ${receivingOfferEligibility()}
         AND o.capability='RECEIVE' AND NOT o.allow_renewal AND ${stock}
         AND n.phone_number ~ '^[+]1[2-9][0-9]{9}$'
         GROUP BY o.service,o.plan,code ORDER BY code`,
      ),
    ]);
    return {
      regions: regions.rows.map(row => ({ id: row.id, name: row.name, english: row.english, prefix: row.prefix, area: row.area, availableCount: row.available_count })),
      services: [...new Set(offers.rows.map(row => row.service))],
      offers: offers.rows.map(row => ({ region: row.region_id, service: row.service, plan: row.plan, name: row.name, durationDays: row.duration_days,
        receivingMode: row.receiving_mode, windowMinutes: row.window_minutes, unitPoints: row.unit_points, availableCount: row.available_count,
        areaCodes: row.region_id === 'us' ? areas.rows.filter(area => area.service === row.service && area.plan === row.plan).map(area => ({ code: area.code, availableCount: area.available_count })) : [],
      })),
      platforms: platformCatalog.map(platform => ({ ...platform, available: offers.rows.some(offer => offer.service === platform.name && offer.available_count > 0) })),
      isDemo: true as const,
    };
  }
  private async readPage<T, Row extends Record<string, unknown>>(
    select: string, countFrom: string, where: Where, sort: string, input: PaginationQuery, map: (row: Row) => T,
  ): Promise<PaginatedResponse<T>> {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${countFrom} WHERE ${where.sql}`, where.values);
      const index = where.values.length;
      const { rows } = await client.query<Row>(`${select} WHERE ${where.sql} ORDER BY ${sort} LIMIT $${index + 1} OFFSET $${index + 2}`, [
        ...where.values, input.pageSize, (input.page - 1) * input.pageSize,
      ]);
      return { data: rows.map(map), pagination: pagination(input, count!.total) };
    });
  }
  numbers(userId: string, input: NumbersQuery) {
    const where = new Where();
    where.add('a.user_id=?', userId);
    where.raw(linePoolAllocationScope());
    where.raw("(a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))");
    if (input.region) where.add('n.region_id=?', input.region);
    if (input.numberId) where.add('n.id=?', input.numberId);
    if (input.allocationId) where.add('a.id=?', input.allocationId);
    if (input.status === 'ACTIVE') where.raw("a.released_at IS NULL AND (a.receiving_status='WAITING' OR (a.receiving_mode='HOSTED' AND a.expires_at>now()))");
    if (input.status === 'EXPIRED') where.raw("a.receiving_status IS DISTINCT FROM 'WAITING' AND (a.receiving_mode='ONE_TIME' OR a.released_at IS NOT NULL OR a.expires_at<=now())");
    if (input.status === 'expiring') where.raw("a.receiving_mode='HOSTED' AND a.released_at IS NULL AND a.expires_at>now() AND a.expires_at<=now()+interval '3 days'");
    where.search("(concat_ws(' ',n.phone_number,a.platform_id,r.name,r.english) ILIKE ?)", input.search);
    return this.readPage(numberSelect, 'FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN regions r ON r.id=n.region_id', where, 'a.assigned_at DESC,a.id DESC', input, toNumber);
  }
  orders(userId: string, input: ListQuery) {
    const where = new Where();
    where.add('o.user_id=?', userId);
    where.raw(linePoolOrderScope());
    if (input.region) where.add('o.region_id=?', input.region);
    where.search("(concat_ws(' ',o.order_number,o.service,r.name,r.english,o.plan_name) ILIKE ?)", input.search);
    return this.readPage(orderSelect, 'FROM orders o JOIN regions r ON r.id=o.region_id', where, 'o.created_at DESC,o.id DESC', input, toOrder);
  }
  async orderDetail(userId: string, id: string, client?: PoolClient): Promise<OrderDetail> {
    const query = <T extends Record<string, unknown>>(text: string, values: unknown[]) => client ? client.query<T>(text, values) : this.db.query<T>(text, values);
    const { rows: [order] } = await query<OrderRow>(`${orderSelect} WHERE o.id=$1 AND o.user_id=$2 AND ${linePoolOrderScope()}`, [id, userId]);
    if (!order) throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Order not found');
    const { rows } = await query<NumberRow>(`SELECT n.id,n.phone_number,n.region_id,r.name AS country,a.platform_id AS service,
      a.id AS allocation_id,a.order_id,a.assigned_at,a.released_at,LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at)) AS expires_at,
      a.receiving_mode,a.receiving_status,a.first_message_id,a.expires_at AS receiving_ends_at,
      (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id) AS message_count,
      (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id AND NOT m.is_read) AS unread_count
      FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN regions r ON r.id=n.region_id
      WHERE a.order_id=$1 AND a.user_id=$2 AND ${linePoolAllocationScope()} ORDER BY n.id`, [id, userId]);
    return { ...toOrder(order), numbers: rows.map(toNumber) };
  }
  inbox(userId: string, input: InboxQuery) {
    const where = new Where();
    where.add('m.user_id=?', userId);
    where.raw(linePoolMessageScope());
    if (input.region) where.add('n.region_id=?', input.region);
    if (input.numberId) where.add('m.number_id=?', input.numberId);
    if (input.allocationId) where.add('m.allocation_id=?', input.allocationId);
    if (input.messageId) where.add('m.id=?', input.messageId);
    if (input.unread) where.add('m.is_read=?', input.unread === 'false');
    where.search("(concat_ws(' ',m.body,m.sender,m.platform_id,m.verification_code,n.phone_number) ILIKE ?)", input.search);
    type Row = { platform_id: SmsMessage['platformId']; allocation_id: string | null; id: string; number_id: string; phone_number: string; sender: string; body: string; verification_code: string | null; received_at: Date; is_read: boolean };
    return this.readPage<SmsMessage, Row>('SELECT m.*,n.phone_number FROM sms_messages m JOIN phone_numbers n ON n.id=m.number_id',
      'FROM sms_messages m JOIN phone_numbers n ON n.id=m.number_id', where, 'm.received_at DESC,m.id DESC', input,
      row => ({ id: row.id, platformId: row.platform_id ?? undefined, allocationId: row.allocation_id, numberId: row.number_id, phoneNumber: row.phone_number, sender: row.sender, body: row.body, verificationCode: row.verification_code, receivedAt: row.received_at.toISOString(), isRead: row.is_read }),
    );
  }
  async markRead(userId: string, ids: string[]) {
    return this.db.transaction(async client => {
      const uniqueIds = [...new Set(ids)];
      const owned = await client.query(`SELECT m.id FROM sms_messages m WHERE m.user_id=$1 AND m.id=ANY($2::uuid[]) AND ${linePoolMessageScope()} FOR UPDATE`, [userId, uniqueIds]);
      if (owned.rowCount !== uniqueIds.length) throw new ApiFailure(404, 'MESSAGE_NOT_FOUND', 'One or more messages were not found');
      await client.query('UPDATE sms_messages SET is_read=true WHERE user_id=$1 AND id=ANY($2::uuid[])', [userId, uniqueIds]);
      return { ids: uniqueIds, isRead: true as const };
    });
  }
  async points(userId: string, input: PointsQuery) {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [account] } = await client.query<{ id: string; available_points: number; frozen_points: number }>(
        'SELECT id,available_points,frozen_points FROM point_accounts WHERE user_id=$1', [userId]);
      if (!account) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
      const where = 'account_id=$1' + (input.kind === 'income' ? ' AND delta+frozen_delta>0' : input.kind === 'expense' ? ' AND delta+frozen_delta<0' : '');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM point_ledger WHERE ${where}`, [account.id]);
      type Row = { id: string; type: 'SEED_CREDIT' | 'ORDER_DEBIT' | 'ADJUSTMENT' | 'RECHARGE' | 'ORDER_RESERVE' | 'ORDER_CAPTURE' | 'ORDER_RELEASE' | 'ORDER_REFUND'; delta: number; balance_after: number; frozen_delta: number; frozen_after: number; description: string; reference_id: string | null; created_at: Date };
      const { rows } = await client.query<Row>(`SELECT * FROM point_ledger WHERE ${where} ORDER BY sequence DESC LIMIT $2 OFFSET $3`, [account.id, input.pageSize, (input.page - 1) * input.pageSize]);
      const { rows: [totals] } = await client.query<{ income: string; expense: string }>(
        'SELECT COALESCE(sum(GREATEST(delta::bigint+frozen_delta::bigint,0)),0)::text AS income, COALESCE(-sum(LEAST(delta::bigint+frozen_delta::bigint,0)),0)::text AS expense FROM point_ledger WHERE account_id=$1', [account.id]);
      const income = Number(totals!.income);
      const expense = Number(totals!.expense);
      if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expense)) {
        throw new ApiFailure(500, 'POINTS_TOTAL_OUT_OF_RANGE', 'Point totals exceed the supported numeric range');
      }
      return { data: { balance: account.available_points, frozenBalance: account.frozen_points, income, expense, entries: rows.map(row => ({ id: row.id, type: row.type, delta: row.delta, balanceAfter: row.balance_after, frozenDelta: row.frozen_delta, frozenAfter: row.frozen_after, description: row.description, referenceId: row.reference_id, createdAt: row.created_at.toISOString() })) }, pagination: pagination(input, count!.total) };
    });
  }
  async account(userId: string): Promise<Account> {
    const { rows: [row] } = await this.db.query<UserRow & { phone_number: string | null }>(
      `SELECT u.*,a.available_points AS points_balance,(SELECT agent.id FROM agents agent WHERE agent.user_id=u.id) AS agent_id
       FROM users u JOIN point_accounts a ON a.user_id=u.id WHERE u.id=$1`, [userId]);
    if (!row) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
    return { ...toUser(row), phoneNumber: row.phone_number ?? null, preferences: { expiryNotice: row.expiry_notice, language: 'zh-CN' } };
  }
  async preferences(userId: string, expiryNotice: boolean) {
    const result = await this.db.query('UPDATE users SET expiry_notice=$2 WHERE id=$1', [userId, expiryNotice]);
    if (!result.rowCount) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
    return { expiryNotice, language: 'zh-CN' as const };
  }
  async dashboardOverview(userId: string) {
    const [summary, totals, latest, messages, daily] = await Promise.all([
      this.dashboard(userId),
      this.db.query<{ numbers: number; messages: number; orders: number; month: number }>(`SELECT
        (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=$1 AND ${linePoolAllocationScope()} AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))) AS numbers,
        (SELECT count(*)::int FROM sms_messages m WHERE m.user_id=$1 AND ${linePoolMessageScope()}) AS messages,
        (SELECT count(*)::int FROM orders o WHERE o.user_id=$1 AND ${linePoolOrderScope()}) AS orders,
        (SELECT count(*)::int FROM sms_messages m WHERE m.user_id=$1 AND ${linePoolMessageScope()} AND m.received_at>=date_trunc('month',now())) AS month`, [userId]),
      this.db.query<NumberRow>(`${numberSelect} WHERE a.user_id=$1 AND ${linePoolAllocationScope()} AND a.released_at IS NULL
        AND (a.receiving_status='WAITING' OR (a.receiving_mode='HOSTED' AND a.expires_at>now()))
        AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))
        ORDER BY a.expires_at,a.id LIMIT 5`, [userId]),
      this.inbox(userId, { page: 1, pageSize: 4, search: '' }),
      this.db.query<{ date: Date; messages: number; numbers: number }>(`WITH days AS (
        SELECT generate_series(date_trunc('day',now())-interval '29 days',date_trunc('day',now()),interval '1 day') AS day
      ) SELECT day AS date,
        (SELECT count(*)::int FROM sms_messages m WHERE m.user_id=$1 AND ${linePoolMessageScope()} AND m.received_at>=day AND m.received_at<day+interval '1 day') AS messages,
        (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=$1 AND ${linePoolAllocationScope()} AND a.assigned_at<LEAST(day+interval '1 day',now())
          AND a.expires_at>=LEAST(day+interval '1 day',now()) AND (a.released_at IS NULL OR a.released_at>=LEAST(day+interval '1 day',now()))
          AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))) AS numbers
        FROM days ORDER BY day`, [userId]),
    ]);
    const total = totals.rows[0]!;
    return { ...summary, overview: { totalNumbers: total.numbers, totalMessages: total.messages, totalOrders: total.orders,
      receivedThisMonth: total.month, recentNumbers: latest.rows.map(toNumber), recentMessages: messages.data,
      daily: daily.rows.map(row => ({ ...row, date: row.date.toISOString() })),
    } };
  }
  async dashboard(userId: string) {
    const { rows: [row] } = await this.db.query<{ points_balance: number; active: number; expiring: number; unread: number }>(
      `SELECT wallet.available_points AS points_balance,
       (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=u.id AND ${linePoolAllocationScope()} AND a.released_at IS NULL
         AND (a.receiving_status='WAITING' OR (a.receiving_mode='HOSTED' AND a.expires_at>now())) AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))) AS active,
       (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=u.id AND ${linePoolAllocationScope()} AND a.receiving_mode='HOSTED' AND a.released_at IS NULL AND a.expires_at>now() AND a.expires_at<=now()+interval '3 days' AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))) AS expiring,
       (SELECT count(*)::int FROM sms_messages m WHERE m.user_id=u.id AND ${linePoolMessageScope()} AND NOT m.is_read) AS unread
       FROM users u JOIN point_accounts wallet ON wallet.user_id=u.id WHERE u.id=$1`, [userId],
    );
    if (!row) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
    const orders = await this.orders(userId, { page: 1, pageSize: 5, search: '' });
    return { pointsBalance: row.points_balance, activeNumbers: row.active, expiringNumbers: row.expiring, unreadMessages: row.unread, recentOrders: orders.data };
  }
}
