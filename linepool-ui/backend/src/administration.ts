import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AdminQuery, NumberActionInput, ProductInput, UserStatusInput } from '@linepool/contracts/admin';
import { type SessionRequest } from './authentication.js';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { pagination } from './workspace.js';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<SessionRequest>().user?.role !== 'ADMIN') {
      throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Platform administrator access is required');
    }
    return true;
  }
}
const numberFrom = 'FROM phone_numbers n JOIN regions r ON r.id=n.region_id LEFT JOIN users u ON u.id=n.assigned_user_id';
const numberFields = `n.id,n.phone_number,n.region_id,r.name AS country,r.prefix,n.service,n.capability,n.resource_status,
 (SELECT a.id FROM number_allocations a WHERE a.number_id=n.id AND a.released_at IS NULL) AS allocation_id,
 n.sale_enabled,n.assigned_user_id,u.display_name AS owner_name,n.order_id,n.expires_at,
 CASE WHEN n.assigned_user_id IS NOT NULL THEN 'ASSIGNED' WHEN NOT n.sale_enabled OR n.resource_status NOT IN ('LOCAL','ONLINE') THEN 'UNSELLABLE' ELSE 'AVAILABLE' END AS sale_status`;
const orderFrom = 'FROM orders o JOIN users u ON u.id=o.user_id';
const orderFields = `o.id,o.order_number,o.user_id,u.display_name AS owner_name,o.plan_name,o.quantity,o.total_points,o.created_at,
 CASE WHEN EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.reverses_ledger_id IS NOT NULL) THEN 'POINTS_REVERSED'
 WHEN EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.type='ORDER_DEBIT') THEN 'POINTS_DEBITED' ELSE 'UNVERIFIED' END AS payment_status,
 o.fulfillment_status,o.completed_at,u.is_demo,
 (SELECT count(*)::int FROM number_allocations a WHERE a.order_id=o.id) AS assigned_count`;
const allocationFields = 'a.*,n.phone_number,u.display_name AS owner_name';
const allocationFrom = 'FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN users u ON u.id=a.user_id';
const auditFields = 'a.*,u.display_name AS actor_name';
const auditFrom = 'FROM admin_audit a JOIN users u ON u.id=a.actor_id';
const userFields = `u.id,u.email,u.display_name,u.role,u.account_status,u.created_at,u.points_balance,u.is_demo,
 (SELECT count(*)::int FROM phone_numbers n WHERE n.assigned_user_id=u.id) AS number_count,
 (SELECT count(*)::int FROM orders o WHERE o.user_id=u.id) AS order_count`;
const productFrom = 'FROM offers o JOIN regions r ON r.id=o.region_id';
const productFields = `o.*,r.name AS country,(SELECT count(*)::int FROM phone_numbers n WHERE n.region_id=o.region_id
 AND n.service=o.service AND n.assigned_user_id IS NULL AND n.sale_enabled AND n.resource_status IN ('LOCAL','ONLINE')
 AND n.capability=o.capability AND starts_with(n.phone_number,o.area_prefix)) AS available_count`;
export type AdminSection = 'users' | 'numbers' | 'products' | 'orders' | 'audit';

@Injectable()
export class Administration {
  constructor(private readonly db: Database) {}
  async list(section: AdminSection, input: AdminQuery) {
    const values: unknown[] = [];
    const clauses = ['true'];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replaceAll('?', `$${values.length}`)); };
    const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
    let fields: string, from: string, sort: string;
    switch (section) {
      case 'users':
        fields = userFields; from = 'FROM users u'; sort = 'u.created_at DESC,u.id';
        if (input.search) add('(u.display_name ILIKE ? OR u.email ILIKE ? OR u.id::text ILIKE ?)', search);
        if (input.status) add('u.account_status=?', input.status);
        break;
      case 'numbers':
        fields = numberFields; from = numberFrom; sort = 'n.created_at DESC,n.id';
        if (input.search) add('(n.phone_number ILIKE ? OR n.id::text ILIKE ? OR u.display_name ILIKE ?)', search);
        if (input.region) add('n.region_id=?', input.region);
        if (input.userId) add('n.assigned_user_id=?', input.userId);
        if (input.status === 'AVAILABLE') clauses.push("n.assigned_user_id IS NULL AND n.sale_enabled AND n.resource_status IN ('LOCAL','ONLINE')");
        else if (input.status === 'ASSIGNED') clauses.push('n.assigned_user_id IS NOT NULL');
        else if (input.status === 'UNSELLABLE') clauses.push("n.assigned_user_id IS NULL AND (NOT n.sale_enabled OR n.resource_status NOT IN ('LOCAL','ONLINE'))");
        else if (input.status === 'expiring') clauses.push("n.expires_at>now() AND n.expires_at<=now()+interval '3 days'");
        else if (input.status === 'ACTIVE') clauses.push("n.expires_at>now() AND n.assigned_user_id IS NOT NULL");
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
        if (input.search) add('(o.order_number ILIKE ? OR u.display_name ILIKE ? OR o.plan_name ILIKE ?)', search);
        if (input.userId) add('o.user_id=?', input.userId);
        if (input.status === 'today') clauses.push("o.created_at >= date_trunc('day',now())");
        else if (input.status === 'UNVERIFIED') clauses.push("NOT EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.type='ORDER_DEBIT')");
        else if (input.status === 'EXCEPTION') clauses.push("(o.fulfillment_status='FAILED' OR NOT EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.type='ORDER_DEBIT'))");
        else if (input.status) add('o.fulfillment_status=?', input.status);
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
      (SELECT count(*)::int FROM phone_numbers WHERE assigned_user_id IS NOT NULL AND expires_at>now()) AS "activeNumbers",
      (SELECT count(*)::int FROM phone_numbers WHERE assigned_user_id IS NULL AND sale_enabled AND resource_status IN ('LOCAL','ONLINE')) AS "saleNumbers",
      (SELECT count(*)::int FROM phone_numbers WHERE expires_at>now() AND expires_at<=now()+interval '3 days') AS "expiringNumbers",
      (SELECT count(*)::int FROM orders WHERE created_at>=date_trunc('day',now())) AS "todayOrders",
      (SELECT count(*)::int FROM orders o WHERE o.fulfillment_status='FAILED' OR NOT EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.type='ORDER_DEBIT')) AS "exceptionOrders"`);
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
        const { rows: [user] } = await query(`SELECT ${userFields} FROM users u WHERE u.id=$1`);
        if (!user) throw new ApiFailure(404, 'NOT_FOUND', 'User not found');
        const [numbers, orders] = await Promise.all([
          query(`SELECT ${numberFields} ${numberFrom} WHERE n.assigned_user_id=$1 ORDER BY n.assigned_at DESC LIMIT 50`),
          query(`SELECT ${orderFields} ${orderFrom} WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 50`),
        ]);
        return { user, numbers: numbers.rows, orders: orders.rows };
      }
      if (section === 'numbers') {
        const { rows: [number] } = await query(`SELECT ${numberFields} ${numberFrom} WHERE n.id=$1`);
        if (!number) throw new ApiFailure(404, 'NOT_FOUND', 'Number not found');
        const allocations = await query(`SELECT ${allocationFields} ${allocationFrom} WHERE a.number_id=$1 ORDER BY a.assigned_at DESC LIMIT 50`);
        return { number, allocations: allocations.rows };
      }
      if (section === 'orders') {
        const { rows: [order] } = await query(`SELECT ${orderFields},o.product_snapshot ${orderFrom} WHERE o.id=$1`);
        if (!order) throw new ApiFailure(404, 'NOT_FOUND', 'Order not found');
        const allocations = await query(`SELECT ${allocationFields} ${allocationFrom} WHERE a.order_id=$1 ORDER BY a.assigned_at DESC`);
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
  async userStatus(actorId: string, id: string, input: UserStatusInput) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      const { rows: [before] } = await client.query('SELECT id,role,account_status FROM users WHERE id=$1 FOR UPDATE', [id]);
      if (!before) throw new ApiFailure(404, 'NOT_FOUND', 'User not found');
      if (before.role === 'ADMIN') throw new ApiFailure(409, 'ADMIN_PROTECTED', 'Administrator accounts cannot be disabled here');
      if (before.account_status === input.status) return { changed: false };
      await client.query('UPDATE users SET account_status=$2 WHERE id=$1', [id, input.status]);
      if (input.status === 'DISABLED') await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await this.audit(client, actorId, 'USER_STATUS', id, input.reason, before, { id, account_status: input.status });
      return { changed: true };
    });
  }
  async numberAction(actorId: string, id: string, input: NumberActionInput) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      // Same account-before-resource lock order as customer checkout.
      if (input.action === 'assign') {
        const { rowCount } = await client.query("SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE' FOR SHARE", [input.userId]);
        if (!rowCount) throw new ApiFailure(409, 'USER_UNAVAILABLE', 'Target user is missing or disabled');
      }
      const { rows: [before] } = await client.query('SELECT * FROM phone_numbers WHERE id=$1 FOR UPDATE', [id]);
      if (!before) throw new ApiFailure(404, 'NOT_FOUND', 'Number not found');
      if (before.reserved_order_id) throw new ApiFailure(409, 'NUMBER_RESERVED', 'Number is reserved by an unresolved Mock order');
      if (input.action === 'assign') {
        if (before.assigned_user_id) throw new ApiFailure(409, 'NUMBER_ASSIGNED', 'Number is already assigned');
        if (!['LOCAL', 'ONLINE'].includes(before.resource_status)) throw new ApiFailure(409, 'RESOURCE_UNAVAILABLE', 'Resource is unavailable');
        await client.query("UPDATE phone_numbers SET assigned_user_id=$2,assigned_at=now(),expires_at=now()+($3*interval '1 day'),sale_enabled=false WHERE id=$1", [id, input.userId, input.durationDays]);
      } else if (input.action === 'reclaim') {
        const { rows: [allocation] } = await client.query<{ user_id: string; released_at: Date | null }>(
          'SELECT user_id,released_at FROM number_allocations WHERE id=$1 AND number_id=$2 FOR UPDATE', [input.expectedAllocationId, id]);
        if (!before.assigned_user_id && allocation?.user_id === input.expectedUserId && allocation.released_at) return { changed: false };
        if (!allocation || allocation.released_at || allocation.user_id !== input.expectedUserId || before.assigned_user_id !== input.expectedUserId) throw new ApiFailure(409, 'OWNERSHIP_CHANGED', 'Ownership changed; refresh before reclaiming');
        await client.query('UPDATE phone_numbers SET assigned_user_id=NULL,order_id=NULL,assigned_at=NULL,expires_at=NULL,sale_enabled=false WHERE id=$1', [id]);
      } else {
        if (input.saleEnabled && before.assigned_user_id) throw new ApiFailure(409, 'NUMBER_ASSIGNED', 'Assigned numbers cannot be listed for sale');
        if (input.saleEnabled && !['LOCAL', 'ONLINE'].includes(before.resource_status)) throw new ApiFailure(409, 'RESOURCE_UNAVAILABLE', 'Resource is unavailable');
        await client.query('UPDATE phone_numbers SET sale_enabled=$2 WHERE id=$1', [id, input.saleEnabled]);
      }
      const { rows: [after] } = await client.query('SELECT * FROM phone_numbers WHERE id=$1', [id]);
      await this.audit(client, actorId, `NUMBER_${input.action.toUpperCase()}`, id, input.reason, before, after);
      return { changed: true };
    });
  }
  async saveProduct(actorId: string, input: ProductInput, create: boolean) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      const key = [input.region, input.service, input.plan];
      const { rows: [before] } = await client.query('SELECT * FROM offers WHERE region_id=$1 AND service=$2 AND plan=$3 FOR UPDATE', key);
      if (create && before) throw new ApiFailure(409, 'PRODUCT_EXISTS', 'Product key already exists');
      if (!create && !before) throw new ApiFailure(404, 'NOT_FOUND', 'Product not found');
      const values = [...key, input.name, input.durationDays, input.unitPoints, input.isActive, input.areaPrefix, input.capability];
      const { rows: [after] } = await client.query(`INSERT INTO offers(region_id,service,plan,name,duration_days,unit_points,is_active,area_prefix,capability)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(region_id,service,plan) ${create ? 'DO NOTHING' : `DO UPDATE SET name=EXCLUDED.name,duration_days=EXCLUDED.duration_days,unit_points=EXCLUDED.unit_points,
        is_active=EXCLUDED.is_active,area_prefix=EXCLUDED.area_prefix,capability=EXCLUDED.capability`} RETURNING *`, values);
      if (!after) throw new ApiFailure(409, 'PRODUCT_EXISTS', 'Product key already exists');
      await this.audit(client, actorId, create ? 'PRODUCT_CREATE' : 'PRODUCT_UPDATE', key.join('/'), input.reason, before ?? null, after);
      return { changed: true };
    });
  }
}
