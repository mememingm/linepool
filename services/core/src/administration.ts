import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { hash } from 'bcryptjs';
import { storefrontRegionIds } from '@linepool/contracts';
import { adminOrdersQuerySchema, type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput, type AdminPasswordResetInput,
  type AdminPlatform, type PlatformInput, type AdminShops, type OfficialShopInput, type AdminShopProduct, type ShopProductHoldInput,
  type AdminShopDelivery, type AdminShopDeliveryQuery, type AdminShopDeliveryPage } from '@linepool/contracts/admin';
import { type SessionRequest } from './authentication.js';
import { Database } from './database.js';
import { ApiFailure, SchemaPipe } from './http.js';
import { pagination } from './workspace.js';
import { LocalPlatformInventory } from './pc/local-inventory.js';
import { shopProductSelect, shopProductView, type ShopProductRow } from './pc/shop-products.js';
import { availableStock, sellableStock, receivingOfferEligibility, releaseExpired, linePoolResourceScope, linePoolAllocationScope, linePoolOrderScope, shopConnection } from './platform-inventory.js';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<SessionRequest>().user?.role !== 'ADMIN') {
      throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Platform administrator access is required');
    }
    return true;
  }
}
const numberFrom = `FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id JOIN regions r ON r.id=n.region_id
 LEFT JOIN number_allocations a ON a.number_id=n.id AND a.platform_id=s.platform_id AND a.released_at IS NULL
 LEFT JOIN users u ON u.id=a.user_id
 LEFT JOIN provider_projects p ON p.provider=s.provider AND p.external_project_id=s.external_project_id
 LEFT JOIN provider_resource_bindings b ON b.provider=s.provider AND b.number_id=n.id`;
const numberFields = `s.id,n.id AS number_id,n.phone_number,n.region_id,r.name AS country,r.prefix,s.platform_id AS service,n.capability,n.resource_status,
 s.provider,s.external_project_id,p.project_name,b.external_number_id,n.resource_expires_at,
 a.id AS allocation_id,s.sale_enabled,a.user_id AS assigned_user_id,u.display_name AS owner_name,a.order_id,a.expires_at,
 COALESCE(a.receiving_mode,'HOSTED') AS receiving_mode,a.receiving_status,a.first_message_id,
 EXISTS(SELECT 1 FROM lp_platform_sales sold WHERE sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id) AS permanently_sold,
 CASE WHEN a.id IS NOT NULL THEN 'ASSIGNED'
 WHEN EXISTS(SELECT 1 FROM lp_platform_sales sold WHERE sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id) THEN 'PERMANENTLY_SOLD'
 WHEN ${sellableStock()} THEN 'AVAILABLE' ELSE 'UNSELLABLE' END AS sale_status`;
const orderNeedsAttention = "(o.fulfillment_status='FAILED' OR EXISTS(SELECT 1 FROM number_allocations receiving WHERE receiving.order_id=o.id AND receiving.receiving_status='WAITING' AND receiving.expires_at<=now()) OR NOT EXISTS(SELECT 1 FROM point_reservations reservation WHERE reservation.id=o.point_reservation_id))";
const orderFrom = 'FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN point_reservations reservation ON reservation.id=o.point_reservation_id';
const orderFields = `o.id,o.order_number,o.user_id,u.display_name AS owner_name,o.plan_name,o.quantity,o.total_points,o.created_at,
 CASE WHEN reservation.status='RESERVED' THEN 'POINTS_RESERVED'
 WHEN reservation.status='RELEASED' THEN 'POINTS_RELEASED'
 WHEN reservation.status='CAPTURED' AND reservation.refunded_points=reservation.points THEN 'POINTS_REVERSED'
 WHEN reservation.status='CAPTURED' AND reservation.refunded_points>0 THEN 'POINTS_PARTIALLY_REFUNDED'
 WHEN reservation.status='CAPTURED' THEN 'POINTS_DEBITED' ELSE 'UNVERIFIED' END AS payment_status,
 o.fulfillment_status,o.completed_at,u.is_demo,o.receiving_mode,
 (SELECT a.receiving_status FROM number_allocations a WHERE a.order_id=o.id AND a.receiving_mode='ONE_TIME') AS receiving_status,
 (SELECT a.first_message_id FROM number_allocations a WHERE a.order_id=o.id AND a.receiving_mode='ONE_TIME') AS first_message_id,
 (SELECT count(*)::int FROM number_allocations a WHERE a.order_id=o.id) AS assigned_count`;
const allocationFields = `a.*,n.phone_number,u.display_name AS owner_name,
 CASE WHEN a.receiving_mode='ONE_TIME' THEN a.assigned_at END AS receiving_started_at,
 CASE WHEN a.receiving_mode='ONE_TIME' THEN a.expires_at END AS receiving_ends_at`;
const allocationFrom = 'FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN users u ON u.id=a.user_id';
const auditFields = 'a.*,u.display_name AS actor_name';
const auditFrom = 'FROM admin_audit a JOIN users u ON u.id=a.actor_id';
const userFrom = 'FROM users u JOIN point_accounts wallet ON wallet.user_id=u.id';
const userFields = `u.id,u.email,u.display_name,u.role,u.auth_kind,u.account_status,u.created_at,wallet.available_points AS points_balance,u.is_demo,
 (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=u.id AND ${linePoolAllocationScope()} AND a.released_at IS NULL) AS number_count,
 (SELECT count(*)::int FROM orders o WHERE o.user_id=u.id AND ${linePoolOrderScope()}) AS order_count`;
const productFrom = 'FROM offers o JOIN regions r ON r.id=o.region_id';
const productStock = (provider: 'pingcode' | 'pingcode-mock') => `(SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
 WHERE n.region_id=o.region_id AND s.platform_id=o.service AND s.provider='${provider}' AND ${receivingOfferEligibility()} AND ${availableStock('o.duration_days', 'o.receiving_mode')}
 AND n.capability=o.capability AND starts_with(n.phone_number,o.area_prefix))`;
const selfServiceProject = `EXISTS(SELECT 1 FROM upstream_accounts account WHERE account.id=p.upstream_account_id
  AND account.storefront_id='linepool' AND (account.owner_kind='SELF_SERVICE' OR ${shopConnection('account')}) AND NOT account.historical_only)`;
const productFields = `o.*,r.name AS country,${productStock('pingcode-mock')} AS available_count,
 ${productStock('pingcode')} AS pc_available_count,
 (SELECT p.external_project_id FROM provider_projects p WHERE p.provider='pingcode' AND p.platform_id=o.service AND p.is_active AND ${selfServiceProject}) AS pc_project_id,
 (SELECT p.project_name FROM provider_projects p WHERE p.provider='pingcode' AND p.platform_id=o.service AND p.is_active AND ${selfServiceProject}) AS pc_project_name`;
const projectFrom = 'FROM provider_projects p JOIN platforms f ON f.id=p.platform_id';
const projectFields = `p.provider,p.external_project_id,p.project_name,p.platform_id,f.name AS platform_name,
 (p.is_active AND f.is_active) AS is_active,p.synced_at,
 (SELECT count(*)::int FROM number_platforms s WHERE s.provider=p.provider AND s.external_project_id=p.external_project_id) AS number_count`;
const receiptFrom = `FROM provider_message_receipts c
 LEFT JOIN sms_messages m ON m.id=c.message_id
 LEFT JOIN number_allocations a ON a.id=c.allocation_id
 LEFT JOIN users u ON u.id=COALESCE(a.user_id,m.user_id)
 LEFT JOIN provider_projects p ON p.provider=c.provider AND p.external_project_id=c.external_project_id
 LEFT JOIN provider_resource_bindings b ON b.provider=c.provider AND b.external_number_id=c.external_number_id
 LEFT JOIN phone_numbers n ON n.id=COALESCE(m.number_id,b.number_id)`;
const receiptFields = `c.provider,c.external_message_id,c.external_project_id,c.external_number_id,
 COALESCE(p.platform_id,m.platform_id) AS platform,COALESCE(n.phone_number,c.raw_payload->>'phoneNumber') AS phone_number,
 u.display_name AS owner_name,COALESCE(m.sender,c.raw_payload->>'sender') AS sender,
 left(COALESCE(m.body,c.raw_payload->>'content'),1000) AS body,
 COALESCE(m.received_at::text,c.raw_payload->>'occurredAt') AS sms_received_at,
 c.received_at AS recorded_at,c.processed_at,c.processing_status,c.failure_reason,
 (SELECT e.event_id FROM provider_event_receipts e WHERE e.provider=c.provider AND e.external_message_id=c.external_message_id
 ORDER BY e.received_at DESC,e.event_id DESC LIMIT 1) AS event_id,
 (SELECT COALESCE(sum(e.delivery_count),0)::int FROM provider_event_receipts e
 WHERE e.provider=c.provider AND e.external_message_id=c.external_message_id) AS delivery_count`;
export type AdminSection = 'users' | 'numbers' | 'products' | 'orders' | 'audit' | 'projects' | 'receipts';

@Injectable()
export class Administration {
  constructor(private readonly db: Database, private readonly localInventory: LocalPlatformInventory) {}
  async list(section: AdminSection, input: AdminQuery) {
    if (section === 'orders') input = new SchemaPipe(adminOrdersQuerySchema).transform(input);
    const values: unknown[] = [];
    const clauses = ['true'];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replaceAll('?', `$${values.length}`)); };
    const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
    let fields: string, from: string, sort: string;
    switch (section) {
      case 'users':
        fields = userFields; from = userFrom; sort = 'u.created_at DESC,u.id';
        if (input.search) add('(u.display_name ILIKE ? OR u.email ILIKE ? OR u.id::text ILIKE ?)', search);
        if (input.status) add('u.account_status=?', input.status);
        break;
      case 'numbers':
        fields = numberFields; from = numberFrom; sort = 'n.created_at DESC,s.id';
        clauses.push(linePoolResourceScope());
        if (input.search) add('(n.phone_number ILIKE ? OR n.id::text ILIKE ? OR u.display_name ILIKE ? OR s.platform_id ILIKE ? OR s.external_project_id ILIKE ? OR b.external_number_id ILIKE ?)', search);
        if (input.provider) add('s.provider=?', input.provider);
        if (input.region) add('n.region_id=?', input.region);
        if (input.userId) add('a.user_id=?', input.userId);
        if (input.status === 'AVAILABLE') clauses.push(sellableStock());
        else if (input.status === 'ASSIGNED') clauses.push('a.id IS NOT NULL');
        else if (input.status === 'PERMANENTLY_SOLD') clauses.push('EXISTS(SELECT 1 FROM lp_platform_sales sold WHERE sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id)');
        else if (input.status === 'UNSELLABLE') clauses.push(`a.id IS NULL AND NOT COALESCE((${sellableStock()}),false)`);
        else if (input.status === 'expiring') clauses.push("a.expires_at>now() AND a.expires_at<=now()+interval '3 days'");
        else if (input.status === 'ACTIVE') clauses.push("a.released_at IS NULL AND (a.receiving_status='WAITING' OR (a.receiving_mode='HOSTED' AND a.expires_at>now()))");
        else if (input.status) add('n.resource_status=?', input.status);
        break;
      case 'products':
        fields = productFields; from = productFrom; sort = 'o.region_id,o.service,o.duration_days,o.plan';
        if (input.search) add('(o.name ILIKE ? OR o.plan ILIKE ? OR o.service ILIKE ?)', search);
        if (input.region) add('o.region_id=?', input.region);
        if (input.status) add('o.is_active=?', input.status === 'ACTIVE');
        break;
      case 'orders':
        fields = orderFields; from = orderFrom; sort = 'o.created_at DESC,o.id';
        clauses.push(linePoolOrderScope());
        if (input.search) add('(o.order_number ILIKE ? OR u.display_name ILIKE ? OR o.plan_name ILIKE ?)', search);
        if (input.userId) add('o.user_id=?', input.userId);
        if (input.view === 'today') clauses.push("o.created_at >= date_trunc('day',now())");
        if (input.view === 'attention') clauses.push(orderNeedsAttention);
        if (input.status) add('o.fulfillment_status=?', input.status);
        break;
      case 'projects':
        fields = projectFields; from = projectFrom; sort = 'p.provider,p.platform_id,p.external_project_id';
        clauses.push(selfServiceProject);
        if (input.search) add('(p.project_name ILIKE ? OR p.external_project_id ILIKE ? OR f.name ILIKE ?)', search);
        if (input.provider) add('p.provider=?', input.provider);
        if (input.status) add('(p.is_active AND f.is_active)=?', input.status === 'ACTIVE');
        break;
      case 'receipts':
        fields = receiptFields; from = receiptFrom; sort = 'c.received_at DESC,c.provider,c.external_message_id';
        clauses.push("EXISTS(SELECT 1 FROM upstream_accounts account WHERE account.id=c.upstream_account_id AND account.storefront_id='linepool' AND account.owner_kind='SELF_SERVICE')");
        if (input.search) add('(c.external_message_id ILIKE ? OR c.external_project_id ILIKE ? OR COALESCE(n.phone_number,c.raw_payload->>\'phoneNumber\') ILIKE ? OR u.display_name ILIKE ? OR m.platform_id ILIKE ? OR p.project_name ILIKE ?)', search);
        if (input.provider) add('c.provider=?', input.provider);
        if (input.status) add('c.processing_status=?', input.status);
        break;
      case 'audit':
        fields = auditFields; from = auditFrom; sort = 'a.created_at DESC,a.id';
        if (input.search) add('(a.action ILIKE ? OR a.target_id ILIKE ? OR a.reason ILIKE ? OR u.display_name ILIKE ?)', search);
        break;
    }
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const where = clauses.join(' AND ');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${from} WHERE ${where}`, values);
      const { rows } = await client.query(`SELECT ${fields} ${from} WHERE ${where} ORDER BY ${sort} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, input.pageSize, (input.page - 1) * input.pageSize]);
      return { data: rows, pagination: pagination(input, count!.total) };
    });
  }
  async summary() {
    const { rows: [stats] } = await this.db.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM number_allocations a WHERE ${linePoolAllocationScope()} AND a.released_at IS NULL AND (a.receiving_status='WAITING' OR (a.receiving_mode='HOSTED' AND a.expires_at>now()))) AS "activeNumbers",
      (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id WHERE n.region_id=ANY($1::text[]) AND ${sellableStock()}) AS "saleNumbers",
      (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id WHERE n.region_id=ANY($1::text[]) AND s.provider='pingcode' AND ${sellableStock()}) AS "pcSaleNumbers",
      (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id WHERE n.region_id=ANY($1::text[]) AND s.provider='pingcode-mock' AND ${sellableStock()}) AS "demoSaleNumbers",
      (SELECT count(*)::int FROM number_allocations a WHERE ${linePoolAllocationScope()} AND a.receiving_mode='HOSTED' AND a.released_at IS NULL AND a.expires_at>now() AND a.expires_at<=now()+interval '3 days') AS "expiringNumbers",
      (SELECT count(*)::int FROM orders o WHERE ${linePoolOrderScope()} AND o.created_at>=date_trunc('day',now())) AS "todayOrders",
      (SELECT count(*)::int FROM orders o WHERE ${linePoolOrderScope()} AND ${orderNeedsAttention}) AS "exceptionOrders"`, [storefrontRegionIds]);
    const page = { page: 1, pageSize: 5, search: '', status: '' };
    const [orders, numbers, audit] = await Promise.all([
      this.list('orders', page), this.list('numbers', { ...page, status: 'expiring' }), this.list('audit', page),
    ]);
    return { ...stats, recentOrders: orders.data, expiring: numbers.data, recentAudit: audit.data };
  }
  async detail(section: 'users' | 'numbers' | 'orders', id: string) {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const query = (sql: string) => client.query(sql, [id]);
      if (section === 'users') {
        const { rows: [user] } = await query(`SELECT ${userFields} ${userFrom} WHERE u.id=$1`);
        if (!user) throw new ApiFailure(404, 'NOT_FOUND', 'User not found');
        const [numbers, orders] = await Promise.all([
          query(`SELECT ${numberFields} ${numberFrom} WHERE a.user_id=$1 AND ${linePoolAllocationScope()} ORDER BY a.assigned_at DESC LIMIT 50`),
          query(`SELECT ${orderFields} ${orderFrom} WHERE o.user_id=$1 AND ${linePoolOrderScope()} ORDER BY o.created_at DESC LIMIT 50`),
        ]);
        return { user, numbers: numbers.rows, orders: orders.rows };
      }
      if (section === 'numbers') {
        const { rows: [number] } = await query(`SELECT ${numberFields} ${numberFrom} WHERE s.id=$1 AND ${linePoolResourceScope()}`);
        if (!number) throw new ApiFailure(404, 'NOT_FOUND', 'Number not found');
        const allocations = await query(`SELECT ${allocationFields} ${allocationFrom} WHERE (a.number_id,a.platform_id)=(SELECT number_id,platform_id FROM number_platforms WHERE id=$1) ORDER BY a.assigned_at DESC LIMIT 50`);
        return { number, allocations: allocations.rows };
      }
      if (section === 'orders') {
        const { rows: [order] } = await query(`SELECT ${orderFields},o.product_snapshot ${orderFrom} WHERE o.id=$1 AND ${linePoolOrderScope()}`);
        if (!order) throw new ApiFailure(404, 'NOT_FOUND', 'Order not found');
        const allocations = await query(`SELECT ${allocationFields} ${allocationFrom} WHERE a.order_id=$1 AND ${linePoolAllocationScope()} ORDER BY a.assigned_at DESC`);
        return { order, allocations: allocations.rows };
      }
      throw new ApiFailure(404, 'NOT_FOUND', 'Management record not found');
    });
  }
  private async actor(client: PoolClient, actorId: string) {
    const { rowCount } = await client.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' FOR SHARE", [actorId]);
    if (!rowCount) throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Platform administrator access is required');
  }
  private async audit(client: PoolClient, actorId: string, action: string, target: string, reason: string, before: unknown, after: unknown) {
    await client.query('INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
      [actorId, action, target, reason, JSON.stringify(before), JSON.stringify(after)]);
  }
  async resetPassword(actorId: string, id: string, input: AdminPasswordResetInput, transaction?: PoolClient) {
    const passwordHash = await hash(input.newPassword, 12);
    const work = async (client: PoolClient) => {
      await this.actor(client, actorId);
      const { rows: [user] } = await client.query<{ id: string; role: string; auth_kind: string }>(
        'SELECT id,role,auth_kind FROM users WHERE id=$1 FOR UPDATE', [id]);
      if (!user) throw new ApiFailure(404, 'NOT_FOUND', 'User not found');
      if (user.role === 'ADMIN') throw new ApiFailure(409, 'ADMIN_PASSWORD_PROTECTED', 'Use email recovery to reset an administrator password');
      if (user.auth_kind !== 'LOCAL') throw new ApiFailure(409, 'PINCLODE_LOGIN_REQUIRED', 'PinClode credentials are managed by the connection provider');
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [id, passwordHash]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [id]);
      await this.audit(client, actorId, 'USER_PASSWORD_RESET', id, input.reason, null, { id, sessionsRevoked: true });
      return { changed: true };
    };
    return transaction ? work(transaction) : this.db.transaction(work);
  }
  async userStatus(actorId: string, id: string, input: UserStatusInput, transaction?: PoolClient) {
    const work = async (client: PoolClient) => {
      await this.actor(client, actorId);
      const { rows: [before] } = await client.query('SELECT id,role,account_status FROM users WHERE id=$1 FOR UPDATE', [id]);
      if (!before) throw new ApiFailure(404, 'NOT_FOUND', 'User not found');
      if (before.role === 'ADMIN') throw new ApiFailure(409, 'ADMIN_PROTECTED', 'Administrator accounts cannot be disabled here');
      if (before.account_status === input.status) return { changed: false };
      await client.query('UPDATE users SET account_status=$2 WHERE id=$1', [id, input.status]);
      if (input.status === 'DISABLED') {
        await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [id]);
      }
      await this.audit(client, actorId, 'USER_STATUS', id, input.reason, before, { id, account_status: input.status });
      return { changed: true };
    };
    return transaction ? work(transaction) : this.db.transaction(work);
  }
  async numberAction(actorId: string, id: string, input: NumberActionInput) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      // Same account-before-resource lock order as customer checkout.
      if (input.action === 'assign') {
        const { rowCount } = await client.query("SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE' AND auth_kind='LOCAL' FOR SHARE", [input.userId]);
        if (!rowCount) throw new ApiFailure(409, 'USER_UNAVAILABLE', 'Target user is missing or disabled');
        await client.query(`SELECT connection.id FROM number_platforms slot JOIN phone_numbers resource ON resource.id=slot.number_id
          JOIN upstream_accounts connection ON connection.id=resource.upstream_account_id WHERE slot.id=$1 FOR SHARE OF connection`, [id]);
      }
      const snapshot = `SELECT s.*,n.resource_status,n.resource_expires_at,n.sale_enabled AS resource_sale_enabled,a.id AS allocation_id,a.user_id AS assigned_user_id,
        EXISTS(SELECT 1 FROM lp_platform_sales sold WHERE sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id) AS permanently_sold
        FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
        LEFT JOIN number_allocations a ON a.number_id=s.number_id AND a.platform_id=s.platform_id AND a.released_at IS NULL
        WHERE s.id=$1 AND ${linePoolResourceScope()}`;
      const { rows: [before] } = await client.query(snapshot + ' FOR UPDATE OF s', [id]);
      if (!before) throw new ApiFailure(404, 'NOT_FOUND', 'Number platform not found');
      if (before.reserved_order_id) throw new ApiFailure(409, 'NUMBER_RESERVED', 'Platform service is reserved by an unresolved Mock order');
      if (before.permanently_sold && (input.action === 'assign' || (input.action === 'sale' && input.saleEnabled))) {
        throw new ApiFailure(409, 'NUMBER_PLATFORM_PERMANENTLY_SOLD', 'This number and platform were permanently sold and cannot be listed or assigned again');
      }
      if (input.action === 'assign') {
        await releaseExpired(client, before.platform_id);
        const current = await client.query('SELECT id FROM number_allocations WHERE number_id=$1 AND platform_id=$2 AND released_at IS NULL', [before.number_id, before.platform_id]);
        if (current.rowCount) throw new ApiFailure(409, 'NUMBER_ASSIGNED', 'This number platform is already assigned');
        if (![7,30].includes(input.durationDays)) throw new ApiFailure(400, 'INVALID_DURATION', 'Choose 7 or 30 days');
        const available = await client.query(`SELECT 1 FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
          WHERE s.id=$1 AND ${availableStock('$2')}`, [id, input.durationDays]);
        if (!available.rowCount) throw new ApiFailure(409, 'RESOURCE_UNAVAILABLE', 'Authorized PC resource must cover the full service period');
        await client.query(`WITH delivered AS (SELECT date_trunc('milliseconds',clock_timestamp()) AS at)
          INSERT INTO number_allocations(number_id,platform_id,user_id,assigned_at,expires_at)
          SELECT $1,$2,$3,at,at+($4*interval '24 hours') FROM delivered`, [before.number_id,before.platform_id,input.userId,input.durationDays]);
      } else if (input.action === 'reclaim') {
        const { rows: [allocation] } = await client.query('SELECT * FROM number_allocations WHERE id=$1 AND number_id=$2 AND platform_id=$3 FOR UPDATE', [input.expectedAllocationId,before.number_id,before.platform_id]);
        if (!before.assigned_user_id && allocation?.user_id === input.expectedUserId && allocation.released_at) return { changed: false };
        if (!allocation || allocation.released_at || allocation.user_id !== input.expectedUserId || before.allocation_id !== input.expectedAllocationId) throw new ApiFailure(409, 'OWNERSHIP_CHANGED', 'Ownership changed; refresh before reclaiming');
        if (allocation.receiving_status === 'WAITING') throw new ApiFailure(409, 'RECEIVING_REVIEW_REQUIRED', 'One-time receiving remains frozen and occupied until its complete window is externally reviewed');
        await client.query(`UPDATE number_allocations SET released_at=GREATEST(assigned_at,LEAST(now(),expires_at)),release_reason='MANUAL' WHERE id=$1`, [allocation.id]);
        await client.query('UPDATE number_platforms SET sale_enabled=false WHERE id=$1', [id]);
      } else {
        if (input.saleEnabled && before.assigned_user_id) throw new ApiFailure(409, 'NUMBER_ASSIGNED', 'Assigned platform service cannot be listed for sale');
        if (input.saleEnabled && (!before.is_available || !['LOCAL','ONLINE'].includes(before.resource_status))) throw new ApiFailure(409, 'RESOURCE_UNAVAILABLE', 'Resource is unavailable');
        await client.query('UPDATE number_platforms SET sale_enabled=$2 WHERE id=$1', [id,input.saleEnabled]);
      }
      const { rows: [after] } = await client.query(snapshot, [id]);
      await this.audit(client, actorId, `NUMBER_${input.action.toUpperCase()}`, id, input.reason, before, after);
      return { changed: true };
    });
  }
  /** Country × platform combinations backed by numbers from an active upstream project. */
  private async upstreamOptions(client: PoolClient) {
    const { rows } = await client.query<{ region: string; country: string; service: string; numberCount: number; availableCount: number; productCount: number }>(
      `SELECT n.region_id AS region,r.name AS country,s.platform_id AS service,count(*)::int AS "numberCount",
        (count(*) FILTER (WHERE ${sellableStock()}))::int AS "availableCount",
        (SELECT count(*)::int FROM offers o WHERE o.region_id=n.region_id AND o.service=s.platform_id) AS "productCount"
       FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id JOIN regions r ON r.id=n.region_id
       JOIN provider_projects p ON p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id
       WHERE p.is_active AND ${selfServiceProject} AND ${linePoolResourceScope()}
       GROUP BY n.region_id,r.name,r.sort_order,s.platform_id ORDER BY r.sort_order,n.region_id,s.platform_id`);
    return rows;
  }
  async productOptions() {
    return this.db.transaction(client => this.upstreamOptions(client));
  }
  /** Creates unlisted 7/30-day drafts for upstream combinations that have no product yet; operators then set prices and list them. */
  async syncProducts(actorId: string, reason: string) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-product-sync',0))");
      const options = await this.upstreamOptions(client);
      const created: { region: string; service: string; plan: string; name: string }[] = [];
      for (const option of options) for (const [plan, days, fallback] of [['week', 7, 10], ['month', 30, 20]] as const) {
        const name = `${days} 天短期服务`;
        // Reuse the platform's current price for the same duration so drafts start close to the live price list.
        const { rows: [after] } = await client.query(`INSERT INTO offers(region_id,service,plan,name,duration_days,unit_points,is_active,area_prefix,capability)
          SELECT $1,$2,$3,$4,$5,COALESCE((SELECT unit_points FROM offers WHERE service=$2 AND duration_days=$5 ORDER BY is_active DESC,unit_points DESC LIMIT 1),$6),false,'','RECEIVE'
          WHERE NOT EXISTS (SELECT 1 FROM offers WHERE region_id=$1 AND service=$2 AND duration_days=$5)
          ON CONFLICT(region_id,service,plan) DO NOTHING RETURNING *`, [option.region, option.service, plan, name, days, fallback]);
        if (after) { created.push({ region: option.region, service: option.service, plan, name }); await this.audit(client, actorId, 'PRODUCT_CREATE', `${option.region}/${option.service}/${plan}`, reason, null, after); }
      }
      return { optionCount: options.length, createdCount: created.length, created };
    });
  }
  async saveProduct(actorId: string, input: ProductInput, create: boolean) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      if (create && !(await this.upstreamOptions(client)).some(option => option.region === input.region && option.service === input.service)) {
        throw new ApiFailure(422, 'PRODUCT_NOT_OFFERED_UPSTREAM', 'Upstream provides no numbers for this region and platform');
      }
      const key = [input.region, input.service, input.plan];
      const { rows: [before] } = await client.query('SELECT * FROM offers WHERE region_id=$1 AND service=$2 AND plan=$3 FOR UPDATE', key);
      if (create && before) throw new ApiFailure(409, 'PRODUCT_EXISTS', 'Product key already exists');
      if (!create && !before) throw new ApiFailure(404, 'NOT_FOUND', 'Product not found');
      if (input.receivingMode === 'ONE_TIME' && input.isActive && !(await client.query('SELECT platform_id FROM lp_platform_code_rules WHERE platform_id=$1 AND enabled FOR SHARE', [input.service])).rowCount) {
        throw new ApiFailure(409, 'PLATFORM_CODE_RULE_REQUIRED', 'Configure the platform-specific code rule before listing one-time receiving');
      }
      const values = [...key, input.name, input.durationDays, input.unitPoints, input.isActive, input.areaPrefix, input.capability, input.receivingMode, input.windowMinutes];
      const { rows: [after] } = await client.query(`INSERT INTO offers(region_id,service,plan,name,duration_days,unit_points,is_active,area_prefix,capability,receiving_mode,window_minutes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(region_id,service,plan) ${create ? 'DO NOTHING' : `DO UPDATE SET name=EXCLUDED.name,duration_days=EXCLUDED.duration_days,unit_points=EXCLUDED.unit_points,
        is_active=EXCLUDED.is_active,area_prefix=EXCLUDED.area_prefix,capability=EXCLUDED.capability,allow_renewal=false,
        receiving_mode=EXCLUDED.receiving_mode,window_minutes=EXCLUDED.window_minutes`} RETURNING *`, values);
      if (!after) throw new ApiFailure(409, 'PRODUCT_EXISTS', 'Product key already exists');
      await this.audit(client, actorId, create ? 'PRODUCT_CREATE' : 'PRODUCT_UPDATE', key.join('/'), input.reason, before ?? null, after);
      return { changed: true };
    });
  }
  /** Administrator-defined platforms with listing facts for the platform management page. */
  async platforms(): Promise<AdminPlatform[]> {
    const { rows } = await this.db.query<{ id: string; name: string; is_active: boolean; created_at: Date; active_products: number; available_slots: number; code_rule_enabled: boolean }>(
      `SELECT p.id,p.name,p.is_active,p.created_at,
        (SELECT count(*)::int FROM offers o WHERE o.service=p.id AND o.is_active) AS active_products,
        (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
          JOIN upstream_accounts a ON a.id=n.upstream_account_id AND a.storefront_id='linepool' AND NOT a.historical_only
            AND (a.owner_kind='SELF_SERVICE' OR ${shopConnection('a')})
          WHERE s.platform_id=p.id AND s.is_available AND s.sale_enabled) AS available_slots,
        EXISTS(SELECT 1 FROM lp_platform_code_rules r WHERE r.platform_id=p.id AND r.enabled) AS code_rule_enabled
       FROM platforms p ORDER BY p.created_at,p.id`);
    return rows.map(row => ({ id: row.id, name: row.name, isActive: row.is_active, createdAt: row.created_at.toISOString(),
      activeProducts: row.active_products, availableSlots: row.available_slots, codeRuleEnabled: row.code_rule_enabled }));
  }
  /** Create or update a platform. Ids are permanent; disabling stops new sales and keeps existing services. */
  async savePlatform(actorId: string, input: PlatformInput, create: boolean) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-platforms',0))");
      const { rows: [before] } = await client.query('SELECT * FROM platforms WHERE lower(id)=lower($1) FOR UPDATE', [input.id]);
      if (create && before) throw new ApiFailure(409, 'PLATFORM_EXISTS', 'A platform with this id already exists');
      if (!create && (!before || before.id !== input.id)) throw new ApiFailure(404, 'NOT_FOUND', 'Platform not found');
      const { rows: [after] } = create
        ? await client.query('INSERT INTO platforms(id,name,is_active) VALUES($1,$2,$3) RETURNING *', [input.id, input.name, input.isActive])
        : await client.query('UPDATE platforms SET name=$2,is_active=$3 WHERE id=$1 RETURNING *', [input.id, input.name, input.isActive]);
      await this.audit(client, actorId, create ? 'PLATFORM_CREATE' : 'PLATFORM_UPDATE', input.id, input.reason, before ?? null, after);
      await this.localInventory.reconcile(client);
      return { changed: true };
    });
  }
  /** Official shop and the agents (real LinePool PinClode connections) an administrator may designate. */
  async shops(): Promise<AdminShops> {
    const { rows: [official] } = await this.db.query<{ id: string; agent_id: string; display_name: string; external_account_id: string; connection_id: string; created_at: Date; available_slots: number }>(
      `SELECT s.id,s.agent_id,u.display_name,a.external_account_id,s.connection_id,s.created_at,
        (SELECT count(*)::int FROM number_platforms np JOIN phone_numbers n ON n.id=np.number_id
          WHERE n.upstream_account_id=s.connection_id AND np.is_available AND np.sale_enabled) AS available_slots
       FROM shops s JOIN agents g ON g.id=s.agent_id JOIN users u ON u.id=g.user_id JOIN upstream_accounts a ON a.id=s.connection_id
       WHERE s.site_id='linepool' AND s.kind='OFFICIAL' AND s.status='ACTIVE'`);
    const { rows } = await this.db.query<{ agent_id: string; display_name: string; role: 'USER' | 'ADMIN'; external_account_id: string; connection_id: string; auth_status: string; numbers: number; last_synced_at: Date | null }>(
      `SELECT g.id AS agent_id,u.display_name,u.role,a.external_account_id,a.id AS connection_id,a.auth_status,a.last_synced_at,
        (SELECT count(*)::int FROM phone_numbers n WHERE n.upstream_account_id=a.id AND NOT n.source_missing) AS numbers
       FROM upstream_accounts a JOIN agents g ON g.id=a.agent_id JOIN users u ON u.id=g.user_id
       WHERE a.storefront_id='linepool' AND a.owner_kind='AGENT' AND a.provider='pingcode' AND NOT a.historical_only
         AND g.status='ACTIVE' AND u.account_status='ACTIVE' ORDER BY u.display_name,a.external_account_id`);
    return {
      official: official ? { shopId: official.id, agentId: official.agent_id, displayName: official.display_name, externalAccountId: official.external_account_id,
        connectionId: official.connection_id, createdAt: official.created_at.toISOString(), availableSlots: official.available_slots } : null,
      candidates: rows.map(row => ({ agentId: row.agent_id, displayName: row.display_name, role: row.role, externalAccountId: row.external_account_id,
        connectionId: row.connection_id, authStatus: row.auth_status, numbers: row.numbers, lastSyncedAt: row.last_synced_at?.toISOString() ?? null })),
    };
  }
  /** Designate the official shop's agent. The previous official shop is suspended (kept as history), never rewritten. */
  async setOfficialShop(actorId: string, input: OfficialShopInput) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lp-official-shop',0))");
      const { rows: [connection] } = await client.query<{ id: string }>(`SELECT a.id FROM upstream_accounts a JOIN agents g ON g.id=a.agent_id
        WHERE a.agent_id=$1 AND a.storefront_id='linepool' AND a.owner_kind='AGENT' AND a.provider='pingcode' AND NOT a.historical_only
          AND g.status='ACTIVE' FOR SHARE OF a,g`, [input.agentId]);
      if (!connection) throw new ApiFailure(404, 'AGENT_CONNECTION_NOT_FOUND', 'This agent has no real PinClode connection on this site');
      const { rows: [before] } = await client.query(`SELECT * FROM shops WHERE site_id='linepool' AND kind='OFFICIAL' AND status='ACTIVE' FOR UPDATE`);
      if (before?.agent_id === input.agentId) return { changed: false };
      const { rows: [other] } = await client.query(`SELECT id FROM shops WHERE agent_id=$1 AND status='ACTIVE'`, [input.agentId]);
      if (other) throw new ApiFailure(409, 'AGENT_SHOP_EXISTS', 'This agent already runs another active shop');
      if (before) await client.query(`UPDATE shops SET status='SUSPENDED',suspended_at=now() WHERE id=$1`, [before.id]);
      const { rows: [after] } = await client.query(`INSERT INTO shops(site_id,kind,agent_id,connection_id,created_by)
        VALUES('linepool','OFFICIAL',$1,$2,$3) RETURNING *`, [input.agentId, connection.id, actorId]);
      await this.audit(client, actorId, 'OFFICIAL_SHOP_SET', after.id, input.reason, before ?? null, after);
      await this.localInventory.reconcile(client, connection.id);
      return { changed: true };
    });
  }
  /** Every shop's products. Administrators do not set prices; they can only hold a product off sale. */
  async shopProducts(): Promise<AdminShopProduct[]> {
    const { rows } = await this.db.query<ShopProductRow & { shop_kind: 'OFFICIAL' | 'AGENT'; agent_name: string }>(
      `SELECT listed.*,u.display_name AS agent_name FROM (${shopProductSelect} WHERE sh.status='ACTIVE') listed
       JOIN shops owner ON owner.id=listed.shop_id JOIN agents g ON g.id=owner.agent_id JOIN users u ON u.id=g.user_id
       ORDER BY listed.shop_kind DESC,u.display_name,listed.region_id,listed.platform_id,listed.duration_days`);
    return rows.map(row => ({ ...shopProductView(row), shopKind: row.shop_kind, agentName: row.agent_name }));
  }
  async holdShopProduct(actorId: string, id: string, input: ShopProductHoldInput) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      const { rows: [before] } = await client.query('SELECT * FROM shop_products WHERE id=$1 FOR UPDATE', [id]);
      if (!before) throw new ApiFailure(404, 'NOT_FOUND', 'Shop product not found');
      if (before.admin_hold === input.hold) return { changed: false };
      const { rows: [after] } = await client.query(`UPDATE shop_products SET admin_hold=$2,admin_hold_reason=$3,version=version+1,updated_at=now()
        WHERE id=$1 RETURNING *`, [id, input.hold, input.hold ? input.reason : null]);
      await this.audit(client, actorId, input.hold ? 'SHOP_PRODUCT_HOLD' : 'SHOP_PRODUCT_RELEASE', id, input.reason, before, after);
      return { changed: true };
    });
  }
  /** Read-only shop delivery outcomes; administrators use this to inspect unmatched or ambiguous messages. */
  async shopDeliveries(input: AdminShopDeliveryQuery): Promise<AdminShopDeliveryPage> {
    const values: unknown[] = [];
    const where = input.outcome ? 'd.outcome=$1' : 'true';
    if (input.outcome) values.push(input.outcome);
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [count] } = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM shop_message_deliveries d WHERE ${where}`, values);
      const limit = `$${values.length + 1}`, offset = `$${values.length + 2}`;
      const { rows } = await client.query<{
        provider: string; external_message_id: string; shop_id: string; connection_id: string; number_id: string;
        outcome: AdminShopDelivery['outcome']; platform_id: string | null; platform_name: string | null;
        rule_version: number | null; allocation_id: string | null; sms_message_id: string | null;
        occurred_at: Date; created_at: Date; phone_number: string | null; sender: string | null;
        buyer_name: string | null; buyer_email: string | null;
      }>(`SELECT d.provider,d.external_message_id,d.shop_id,d.connection_id,d.number_id,d.outcome,d.platform_id,
        p.name AS platform_name,d.rule_version,d.allocation_id,d.sms_message_id,d.occurred_at,d.created_at,
        n.phone_number,COALESCE(c.normalized_payload->>'sender',c.raw_payload->>'sender') AS sender,
        u.display_name AS buyer_name,u.email AS buyer_email
        FROM shop_message_deliveries d
        LEFT JOIN phone_numbers n ON n.id=d.number_id
        LEFT JOIN platforms p ON p.id=d.platform_id
        LEFT JOIN number_allocations a ON a.id=d.allocation_id
        LEFT JOIN users u ON u.id=a.user_id
        LEFT JOIN provider_message_receipts c ON c.provider=d.provider AND c.external_message_id=d.external_message_id
        WHERE ${where} ORDER BY d.occurred_at DESC,d.provider,d.external_message_id LIMIT ${limit} OFFSET ${offset}`,
      [...values, input.pageSize, (input.page - 1) * input.pageSize]);
      return {
        data: rows.map(row => ({
          provider: row.provider === 'pingcode-mock' ? 'pingcode-mock' : 'pingcode',
          externalMessageId: row.external_message_id, shopId: row.shop_id, connectionId: row.connection_id,
          numberId: row.number_id, phoneNumber: row.phone_number, sender: row.sender,
          platformId: row.platform_id, platformName: row.platform_name, outcome: row.outcome,
          ruleVersion: row.rule_version, allocationId: row.allocation_id, smsMessageId: row.sms_message_id,
          buyerName: row.buyer_name, buyerEmail: row.buyer_email,
          occurredAt: row.occurred_at.toISOString(), createdAt: row.created_at.toISOString(),
        })),
        pagination: pagination(input, count!.total),
      };
    });
  }
}
