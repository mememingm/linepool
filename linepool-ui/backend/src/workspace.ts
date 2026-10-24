import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  Account, AssignedNumber, InboxQuery, NumbersQuery, ListQuery, PointsQuery, Order, OrderDetail,
  PaginationQuery, PaginatedResponse, SmsMessage,
} from '@linepool/contracts';
import { Database } from './database.js';
import { type UserRow, toUser } from './authentication.js';
import { ApiFailure } from './http.js';
import { platformCatalog } from '@linepool/contracts';
import { allocationStatus } from './providers/receiving-provider.js';
import { availableStock } from './platform-inventory.js';

export type OrderRow = {
  id: string; order_number: string; region_id: Order['region']; country: string;
  service: Order['service']; plan: Order['plan']; plan_name: string;
  fulfillment_status: Order['status']; completed_at: Date | null;
  quantity: number; unit_points: number; total_points: number; duration_days: number; created_at: Date; area_code?: string | null;
};
export type NumberRow = {
  id: string; phone_number: string; region_id: AssignedNumber['region']; country: string;
  service: AssignedNumber['service']; order_id: string | null; assigned_at: Date; expires_at: Date;
  allocation_id: string; message_count: number; unread_count: number;
};
export const orderSelect = 'SELECT o.*,r.name AS country FROM orders o JOIN regions r ON r.id=o.region_id';
export const numberSelect = `SELECT n.id,n.phone_number,n.region_id,a.platform_id AS service,a.order_id,a.assigned_at,
  LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at)) AS expires_at,a.id AS allocation_id,r.name AS country,
  (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id) AS message_count,
  (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id AND NOT m.is_read) AS unread_count
  FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN regions r ON r.id=n.region_id`;
export function toOrder(row: OrderRow): Order {
  return {
    id: row.id, orderNumber: row.order_number, region: row.region_id, country: row.country,
    service: row.service, plan: row.plan, planName: row.plan_name, areaCode: row.area_code ?? null,
    quantity: row.quantity, unitPoints: row.unit_points, totalPoints: row.total_points,
    durationDays: row.duration_days, createdAt: row.created_at.toISOString(), status: row.fulfillment_status,
    completedAt: row.completed_at?.toISOString() ?? null, isDemo: true,
  };
}
export function toNumber(row: NumberRow): AssignedNumber {
  return {
    id: row.id, allocationId: row.allocation_id, phoneNumber: row.phone_number, region: row.region_id, country: row.country,
    service: row.service, orderId: row.order_id, assignedAt: row.assigned_at.toISOString(),
    expiresAt: row.expires_at.toISOString(), status: allocationStatus(row.expires_at),
    remainingDays: Math.max(0, Math.ceil((row.expires_at.getTime() - Date.now()) / 86400000)),
    messageCount: row.message_count, unreadCount: row.unread_count, isDemo: true,
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
  constructor(private readonly db: Database) {}
  async catalog() {
    const from = 'FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id';
    const stock = `${availableStock('o.duration_days')} AND s.provider='pingcode-mock'
      AND n.region_id=o.region_id AND s.platform_id=o.service AND n.capability=o.capability
      AND starts_with(n.phone_number,o.area_prefix)`;
    const [regions, offers, areas] = await Promise.all([
      this.db.query<{ id: AssignedNumber['region']; name: string; english: string; prefix: string; area: string; available_count: number }>(
        `SELECT r.*,(SELECT count(DISTINCT n.id)::int ${from} JOIN offers o ON o.region_id=n.region_id AND o.service=s.platform_id
          WHERE n.region_id=r.id AND o.is_active AND o.duration_days IN (7,30) AND ${stock}) AS available_count
         FROM regions r WHERE r.is_active ORDER BY r.sort_order,r.id`,
      ),
      this.db.query<{ region_id: Order['region']; service: Order['service']; plan: Order['plan']; name: string; duration_days: number; unit_points: number; available_count: number }>(
        `SELECT o.*,(SELECT count(*)::int ${from} WHERE ${stock}) AS available_count
         FROM offers o JOIN regions r ON r.id=o.region_id JOIN platforms p ON p.id=o.service
         WHERE o.is_active AND p.is_active AND r.is_active AND o.duration_days IN (7,30)
         AND o.capability='RECEIVE' AND NOT o.allow_renewal ORDER BY o.region_id,o.service,o.duration_days`,
      ),
      this.db.query<{ service: string; plan: string; code: string; available_count: number }>(
        `SELECT o.service,o.plan,substring(n.phone_number FROM 3 FOR 3) AS code,count(*)::int AS available_count
         ${from} JOIN offers o ON o.region_id=n.region_id AND o.service=s.platform_id JOIN regions r ON r.id=o.region_id
         WHERE o.region_id='us' AND o.is_active AND r.is_active AND o.duration_days IN (7,30)
         AND o.capability='RECEIVE' AND NOT o.allow_renewal AND ${stock}
         AND n.phone_number ~ '^[+]1[2-9][0-9]{9}$'
         GROUP BY o.service,o.plan,code ORDER BY code`,
      ),
    ]);
    return {
      regions: regions.rows.map(row => ({ id: row.id, name: row.name, english: row.english, prefix: row.prefix, area: row.area, availableCount: row.available_count })),
      services: [...new Set(offers.rows.map(row => row.service))],
      offers: offers.rows.map(row => ({ region: row.region_id, service: row.service, plan: row.plan, name: row.name, durationDays: row.duration_days, unitPoints: row.unit_points, availableCount: row.available_count,
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
    where.raw("(a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))");
    if (input.region) where.add('n.region_id=?', input.region);
    if (input.numberId) where.add('n.id=?', input.numberId);
    if (input.allocationId) where.add('a.id=?', input.allocationId);
    if (input.status === 'ACTIVE') where.raw('a.released_at IS NULL AND a.expires_at>now()');
    if (input.status === 'EXPIRED') where.raw('(a.released_at IS NOT NULL OR a.expires_at<=now())');
    if (input.status === 'expiring') where.raw("a.released_at IS NULL AND a.expires_at>now() AND a.expires_at<=now()+interval '3 days'");
    where.search("(concat_ws(' ',n.phone_number,a.platform_id,r.name,r.english) ILIKE ?)", input.search);
    return this.readPage(numberSelect, 'FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN regions r ON r.id=n.region_id', where, 'a.assigned_at DESC,a.id DESC', input, toNumber);
  }
  orders(userId: string, input: ListQuery) {
    const where = new Where();
    where.add('o.user_id=?', userId);
    if (input.region) where.add('o.region_id=?', input.region);
    where.search("(concat_ws(' ',o.order_number,o.service,r.name,r.english,o.plan_name) ILIKE ?)", input.search);
    return this.readPage(orderSelect, 'FROM orders o JOIN regions r ON r.id=o.region_id', where, 'o.created_at DESC,o.id DESC', input, toOrder);
  }
  async orderDetail(userId: string, id: string, client?: PoolClient): Promise<OrderDetail> {
    const query = <T extends Record<string, unknown>>(text: string, values: unknown[]) => client ? client.query<T>(text, values) : this.db.query<T>(text, values);
    const { rows: [order] } = await query<OrderRow>(`${orderSelect} WHERE o.id=$1 AND o.user_id=$2`, [id, userId]);
    if (!order) throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Order not found');
    const { rows } = await query<NumberRow>(`SELECT n.id,n.phone_number,n.region_id,r.name AS country,a.platform_id AS service,
      a.id AS allocation_id,a.order_id,a.assigned_at,LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at)) AS expires_at,
      (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id) AS message_count,
      (SELECT count(*)::int FROM sms_messages m WHERE m.allocation_id=a.id AND m.user_id=a.user_id AND NOT m.is_read) AS unread_count
      FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN regions r ON r.id=n.region_id
      WHERE a.order_id=$1 AND a.user_id=$2 ORDER BY n.id`, [id, userId]);
    return { ...toOrder(order), numbers: rows.map(toNumber) };
  }
  inbox(userId: string, input: InboxQuery) {
    const where = new Where();
    where.add('m.user_id=?', userId);
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
      const owned = await client.query('SELECT id FROM sms_messages WHERE user_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE', [userId, uniqueIds]);
      if (owned.rowCount !== uniqueIds.length) throw new ApiFailure(404, 'MESSAGE_NOT_FOUND', 'One or more messages were not found');
      await client.query('UPDATE sms_messages SET is_read=true WHERE user_id=$1 AND id=ANY($2::uuid[])', [userId, uniqueIds]);
      return { ids: uniqueIds, isRead: true as const };
    });
  }
  async points(userId: string, input: PointsQuery) {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const where = 'user_id=$1' + (input.kind === 'income' ? ' AND delta>0' : input.kind === 'expense' ? ' AND delta<0' : '');
      const { rows: [user] } = await client.query<{ points_balance: number }>('SELECT points_balance FROM users WHERE id=$1', [userId]);
      if (!user) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM point_ledger WHERE ${where}`, [userId]);
      type Row = { id: string; type: 'SEED_CREDIT' | 'ORDER_DEBIT' | 'ADJUSTMENT'; delta: number; balance_after: number; description: string; reference_id: string | null; created_at: Date };
      const { rows } = await client.query<Row>(`SELECT * FROM point_ledger WHERE ${where} ORDER BY sequence DESC LIMIT $2 OFFSET $3`, [userId, input.pageSize, (input.page - 1) * input.pageSize]);
      const { rows: [totals] } = await client.query<{ income: number; expense: number }>('SELECT COALESCE(sum(GREATEST(delta,0)),0)::int AS income, COALESCE(-sum(LEAST(delta,0)),0)::int AS expense FROM point_ledger WHERE user_id=$1', [userId]);
      return { data: { balance: user.points_balance, income: totals!.income, expense: totals!.expense, entries: rows.map(row => ({ id: row.id, type: row.type, delta: row.delta, balanceAfter: row.balance_after, description: row.description, referenceId: row.reference_id, createdAt: row.created_at.toISOString() })) }, pagination: pagination(input, count!.total) };
    });
  }
  async account(userId: string): Promise<Account> {
    const { rows: [row] } = await this.db.query<UserRow & { phone_number: string | null }>('SELECT * FROM users WHERE id=$1', [userId]);
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
        (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=$1 AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))) AS numbers,
        (SELECT count(*)::int FROM sms_messages WHERE user_id=$1) AS messages,
        (SELECT count(*)::int FROM orders WHERE user_id=$1) AS orders,
        (SELECT count(*)::int FROM sms_messages WHERE user_id=$1 AND received_at>=date_trunc('month',now())) AS month`, [userId]),
      this.db.query<NumberRow>(`${numberSelect} WHERE a.user_id=$1 AND a.released_at IS NULL AND a.expires_at>now()
        AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))
        ORDER BY a.expires_at,a.id LIMIT 5`, [userId]),
      this.inbox(userId, { page: 1, pageSize: 4, search: '' }),
      this.db.query<{ date: Date; messages: number; numbers: number }>(`WITH days AS (
        SELECT generate_series(date_trunc('day',now())-interval '29 days',date_trunc('day',now()),interval '1 day') AS day
      ) SELECT day AS date,
        (SELECT count(*)::int FROM sms_messages m WHERE m.user_id=$1 AND m.received_at>=day AND m.received_at<day+interval '1 day') AS messages,
        (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=$1 AND a.assigned_at<LEAST(day+interval '1 day',now())
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
      `SELECT u.points_balance,
       (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=u.id AND a.released_at IS NULL AND a.expires_at>now() AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))) AS active,
       (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=u.id AND a.released_at IS NULL AND a.expires_at>now() AND a.expires_at<=now()+interval '3 days' AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))) AS expiring,
       (SELECT count(*)::int FROM sms_messages m WHERE m.user_id=u.id AND NOT m.is_read) AS unread FROM users u WHERE u.id=$1`, [userId],
    );
    if (!row) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
    const orders = await this.orders(userId, { page: 1, pageSize: 5, search: '' });
    return { pointsBalance: row.points_balance, activeNumbers: row.active, expiringNumbers: row.expiring, unreadMessages: row.unread, recentOrders: orders.data };
  }
}
