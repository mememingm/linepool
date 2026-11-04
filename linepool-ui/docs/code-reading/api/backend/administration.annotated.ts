/**
 * administration.ts 中文分区导读副本：管理后台业务
 * 原文件：backend/src/administration.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】执行后台查询、汇总、密码重置、账户状态、号码分配回收和商品保存/同步。
 * 【为什么这样组织】写入前核对管理员与当前记录状态，成功变更写审计，读写逻辑与路由分开。
 * 【调用链】AdminController → Administration → SQL 与审计记录；展示字段来自 admin.ts。
 * 【修改提示】7/30 天规则另有业务检查；同步商品有独立套餐和兜底价；可售统计按 7 天门槛判断，详见主报告第 10 节。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { hash } from 'bcryptjs';
import { storefrontRegionIds } from '@linepool/contracts';
import { adminOrdersQuerySchema, type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput, type AdminPasswordResetInput } from '@linepool/contracts/admin';
import { type SessionRequest } from '../../../../backend/src/authentication.js';
import { Database } from '../../../../backend/src/database.js';
import { ApiFailure, SchemaPipe } from '../../../../backend/src/http.js';
import { pagination } from '../../../../backend/src/workspace.js';
import { availableStock, releaseExpired } from '../../../../backend/src/platform-inventory.js';

/**
 * ==================== 01 管理后台业务 / AdminGuard ====================
 * AdminGuard = 管理员守卫。配合 SessionGuard 使用，检查已登录用户的 role 是否为 ADMIN。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  /**
   * canActivate = 检查请求中的管理员身份，不符合则返回 ADMIN_REQUIRED；具体写入前还会在事务中核对账户状态。
   */
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<SessionRequest>().user?.role !== 'ADMIN') {
      throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Platform administrator access is required');
    }
    return true;
  }
}
/**
 * numberFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const numberFrom = `FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id JOIN regions r ON r.id=n.region_id
 LEFT JOIN number_allocations a ON a.number_id=n.id AND a.platform_id=s.platform_id AND a.released_at IS NULL
 LEFT JOIN users u ON u.id=a.user_id
 LEFT JOIN provider_projects p ON p.provider=s.provider AND p.external_project_id=s.external_project_id
 LEFT JOIN provider_resource_bindings b ON b.provider=s.provider AND b.number_id=n.id`;
/**
 * numberFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const numberFields = `s.id,n.id AS number_id,n.phone_number,n.region_id,r.name AS country,r.prefix,s.platform_id AS service,n.capability,n.resource_status,
 s.provider,s.external_project_id,p.project_name,b.external_number_id,n.resource_expires_at,
 a.id AS allocation_id,s.sale_enabled,a.user_id AS assigned_user_id,u.display_name AS owner_name,a.order_id,a.expires_at,
 CASE WHEN a.id IS NOT NULL THEN 'ASSIGNED' WHEN ${availableStock('7')} THEN 'AVAILABLE' ELSE 'UNSELLABLE' END AS sale_status`;
/**
 * orderNeedsAttention = 需要关注的订单 SQL 条件：履行失败，或找不到相应积分扣减凭据。
 */
const orderNeedsAttention = "(o.fulfillment_status='FAILED' OR NOT EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.type='ORDER_DEBIT'))";
/**
 * orderFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const orderFrom = 'FROM orders o JOIN users u ON u.id=o.user_id';
/**
 * orderFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const orderFields = `o.id,o.order_number,o.user_id,u.display_name AS owner_name,o.plan_name,o.quantity,o.total_points,o.created_at,
 CASE WHEN EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.reverses_ledger_id IS NOT NULL) THEN 'POINTS_REVERSED'
 WHEN EXISTS(SELECT 1 FROM point_ledger l WHERE l.reference_id=o.id AND l.type='ORDER_DEBIT') THEN 'POINTS_DEBITED' ELSE 'UNVERIFIED' END AS payment_status,
 o.fulfillment_status,o.completed_at,u.is_demo,
 (SELECT count(*)::int FROM number_allocations a WHERE a.order_id=o.id) AS assigned_count`;
/**
 * allocationFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const allocationFields = 'a.*,n.phone_number,u.display_name AS owner_name';
/**
 * allocationFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const allocationFrom = 'FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN users u ON u.id=a.user_id';
/**
 * auditFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const auditFields = 'a.*,u.display_name AS actor_name';
/**
 * auditFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const auditFrom = 'FROM admin_audit a JOIN users u ON u.id=a.actor_id';
/**
 * userFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const userFields = `u.id,u.email,u.display_name,u.role,u.account_status,u.created_at,u.points_balance,u.is_demo,
 (SELECT count(*)::int FROM number_allocations a WHERE a.user_id=u.id AND a.released_at IS NULL) AS number_count,
 (SELECT count(*)::int FROM orders o WHERE o.user_id=u.id) AS order_count`;
/**
 * productFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const productFrom = 'FROM offers o JOIN regions r ON r.id=o.region_id';
/**
 * productStock = 生成某供应商来源的商品可用库存计数 SQL。匹配国家、平台、能力、前缀及商品对应有效期。
 */
const productStock = (provider: 'pingcode' | 'pingcode-mock') => `(SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
 WHERE n.region_id=o.region_id AND s.platform_id=o.service AND s.provider='${provider}' AND ${availableStock('o.duration_days')}
 AND n.capability=o.capability AND starts_with(n.phone_number,o.area_prefix))`;
/**
 * productFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const productFields = `o.*,r.name AS country,${productStock('pingcode-mock')} AS available_count,
 ${productStock('pingcode')} AS pc_available_count,
 (SELECT p.external_project_id FROM provider_projects p WHERE p.provider='pingcode' AND p.platform_id=o.service AND p.is_active) AS pc_project_id,
 (SELECT p.project_name FROM provider_projects p WHERE p.provider='pingcode' AND p.platform_id=o.service AND p.is_active) AS pc_project_name`;
/**
 * projectFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const projectFrom = 'FROM provider_projects p JOIN platforms f ON f.id=p.platform_id';
/**
 * projectFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const projectFields = `p.provider,p.external_project_id,p.project_name,p.platform_id,f.name AS platform_name,
 (p.is_active AND f.is_active) AS is_active,p.synced_at,
 (SELECT count(*)::int FROM number_platforms s WHERE s.provider=p.provider AND s.external_project_id=p.external_project_id) AS number_count`;
/**
 * receiptFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const receiptFrom = `FROM provider_message_receipts c
 LEFT JOIN sms_messages m ON m.id=c.message_id
 LEFT JOIN number_allocations a ON a.id=c.allocation_id
 LEFT JOIN users u ON u.id=COALESCE(a.user_id,m.user_id)
 LEFT JOIN provider_projects p ON p.provider=c.provider AND p.external_project_id=c.external_project_id
 LEFT JOIN provider_resource_bindings b ON b.provider=c.provider AND b.external_number_id=c.external_number_id
 LEFT JOIN phone_numbers n ON n.id=COALESCE(m.number_id,b.number_id)`;
/**
 * receiptFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
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
/**
 * AdminSection = 后台可查询的板块名称。这里只描述结构，执行操作需看后面的函数。
 */
export type AdminSection = 'users' | 'numbers' | 'products' | 'orders' | 'audit' | 'projects' | 'receipts';

/**
 * ==================== 02 管理后台业务 / Administration ====================
 * Administration = 管理后台业务。执行后台查询、汇总、密码重置、账户状态、号码分配回收和商品保存/同步。
 */
@Injectable()
export class Administration {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database) {}
  /**
   * list = 按条件查询列表并分页。具体数据来源、权限和映射见本方法调用的业务。
   */
  async list(section: AdminSection, input: AdminQuery) {
    if (section === 'orders') input = new SchemaPipe(adminOrdersQuerySchema).transform(input);
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
        fields = numberFields; from = numberFrom; sort = 'n.created_at DESC,s.id';
        if (input.search) add('(n.phone_number ILIKE ? OR n.id::text ILIKE ? OR u.display_name ILIKE ? OR s.platform_id ILIKE ? OR s.external_project_id ILIKE ? OR b.external_number_id ILIKE ?)', search);
        if (input.provider) add('s.provider=?', input.provider);
        if (input.region) add('n.region_id=?', input.region);
        if (input.userId) add('a.user_id=?', input.userId);
        if (input.status === 'AVAILABLE') clauses.push(availableStock('7'));
        else if (input.status === 'ASSIGNED') clauses.push('a.id IS NOT NULL');
        else if (input.status === 'UNSELLABLE') clauses.push(`a.id IS NULL AND NOT COALESCE((${availableStock('7')}),false)`);
        else if (input.status === 'expiring') clauses.push("a.expires_at>now() AND a.expires_at<=now()+interval '3 days'");
        else if (input.status === 'ACTIVE') clauses.push("a.expires_at>now() AND a.released_at IS NULL");
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
        if (input.view === 'today') clauses.push("o.created_at >= date_trunc('day',now())");
        if (input.view === 'attention') clauses.push(orderNeedsAttention);
        if (input.status) add('o.fulfillment_status=?', input.status);
        break;
      case 'projects':
        fields = projectFields; from = projectFrom; sort = 'p.provider,p.platform_id,p.external_project_id';
        if (input.search) add('(p.project_name ILIKE ? OR p.external_project_id ILIKE ? OR f.name ILIKE ?)', search);
        if (input.provider) add('p.provider=?', input.provider);
        if (input.status) add('(p.is_active AND f.is_active)=?', input.status === 'ACTIVE');
        break;
      case 'receipts':
        fields = receiptFields; from = receiptFrom; sort = 'c.received_at DESC,c.provider,c.external_message_id';
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
  /**
   * summary = 读取后台首页汇总，具体统计 SQL 位于 Administration.summary。
   */
  async summary() {
    const { rows: [stats] } = await this.db.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM number_allocations WHERE released_at IS NULL AND expires_at>now()) AS "activeNumbers",
      (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id WHERE n.region_id=ANY($1::text[]) AND ${availableStock('7')}) AS "saleNumbers",
      (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id WHERE n.region_id=ANY($1::text[]) AND s.provider='pingcode' AND ${availableStock('7')}) AS "pcSaleNumbers",
      (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id WHERE n.region_id=ANY($1::text[]) AND s.provider='pingcode-mock' AND ${availableStock('7')}) AS "demoSaleNumbers",
      (SELECT count(*)::int FROM number_allocations WHERE released_at IS NULL AND expires_at>now() AND expires_at<=now()+interval '3 days') AS "expiringNumbers",
      (SELECT count(*)::int FROM orders WHERE created_at>=date_trunc('day',now())) AS "todayOrders",
      (SELECT count(*)::int FROM orders o WHERE ${orderNeedsAttention}) AS "exceptionOrders"`, [storefrontRegionIds]);
    const page = { page: 1, pageSize: 5, search: '', status: '' };
    const [orders, numbers, audit] = await Promise.all([
      this.list('orders', page), this.list('numbers', { ...page, status: 'expiring' }), this.list('audit', page),
    ]);
    return { ...stats, recentOrders: orders.data, expiring: numbers.data, recentAudit: audit.data };
  }
  /**
   * detail = 按后台板块和编号读取用户、号码或订单详情。
   */
  async detail(section: 'users' | 'numbers' | 'orders', id: string) {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const query = (sql: string) => client.query(sql, [id]);
      if (section === 'users') {
        const { rows: [user] } = await query(`SELECT ${userFields} FROM users u WHERE u.id=$1`);
        if (!user) throw new ApiFailure(404, 'NOT_FOUND', 'User not found');
        const [numbers, orders] = await Promise.all([
          query(`SELECT ${numberFields} ${numberFrom} WHERE a.user_id=$1 ORDER BY a.assigned_at DESC LIMIT 50`),
          query(`SELECT ${orderFields} ${orderFrom} WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 50`),
        ]);
        return { user, numbers: numbers.rows, orders: orders.rows };
      }
      if (section === 'numbers') {
        const { rows: [number] } = await query(`SELECT ${numberFields} ${numberFrom} WHERE s.id=$1`);
        if (!number) throw new ApiFailure(404, 'NOT_FOUND', 'Number not found');
        const allocations = await query(`SELECT ${allocationFields} ${allocationFrom} WHERE (a.number_id,a.platform_id)=(SELECT number_id,platform_id FROM number_platforms WHERE id=$1) ORDER BY a.assigned_at DESC LIMIT 50`);
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
  /**
   * actor = 写入事务内再次核对操作人是启用的管理员，避免页面打开后身份或状态已改变。
   */
  private async actor(client: PoolClient, actorId: string) {
    const { rowCount } = await client.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' FOR SHARE", [actorId]);
    if (!rowCount) throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Platform administrator access is required');
  }
  /**
   * audit = 保存管理审计。记录谁、做了什么、目标、理由以及修改前后的数据，与业务变更在同一事务内执行。
   */
  private async audit(client: PoolClient, actorId: string, action: string, target: string, reason: string, before: unknown, after: unknown) {
    await client.query('INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
      [actorId, action, target, reason, JSON.stringify(before), JSON.stringify(after)]);
  }
  /**
   * resetPassword = 管理员重置普通用户密码，删除旧会话和找回令牌并写审计；管理员账户要求走邮件找回。
   */
  async resetPassword(actorId: string, id: string, input: AdminPasswordResetInput) {
    const passwordHash = await hash(input.newPassword, 12);
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      const { rows: [user] } = await client.query<{ id: string; role: string }>(
        'SELECT id,role FROM users WHERE id=$1 FOR UPDATE', [id]);
      if (!user) throw new ApiFailure(404, 'NOT_FOUND', 'User not found');
      if (user.role === 'ADMIN') throw new ApiFailure(409, 'ADMIN_PASSWORD_PROTECTED', 'Use email recovery to reset an administrator password');
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [id, passwordHash]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [id]);
      await this.audit(client, actorId, 'USER_PASSWORD_RESET', id, input.reason, null, { id, sessionsRevoked: true });
      return { changed: true };
    });
  }
  /**
   * userStatus = 启用/停用普通用户，禁止在此停用管理员；停用时删除会话与找回令牌。
   */
  async userStatus(actorId: string, id: string, input: UserStatusInput) {
    return this.db.transaction(async client => {
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
    });
  }
  /**
   * numberAction = 按 assign/reclaim/sale 分支分配、回收或改可售状态。写入前核对资源与当前分配，回收后不会自动上架。
   */
  async numberAction(actorId: string, id: string, input: NumberActionInput) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      // Same account-before-resource lock order as customer checkout.
      if (input.action === 'assign') {
        const { rowCount } = await client.query("SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE' FOR SHARE", [input.userId]);
        if (!rowCount) throw new ApiFailure(409, 'USER_UNAVAILABLE', 'Target user is missing or disabled');
      }
      const snapshot = `SELECT s.*,n.resource_status,n.resource_expires_at,n.sale_enabled AS resource_sale_enabled,a.id AS allocation_id,a.user_id AS assigned_user_id
        FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
        LEFT JOIN number_allocations a ON a.number_id=s.number_id AND a.platform_id=s.platform_id AND a.released_at IS NULL
        WHERE s.id=$1`;
      const { rows: [before] } = await client.query(snapshot + ' FOR UPDATE OF s', [id]);
      if (!before) throw new ApiFailure(404, 'NOT_FOUND', 'Number platform not found');
      if (before.reserved_order_id) throw new ApiFailure(409, 'NUMBER_RESERVED', 'Platform service is reserved by an unresolved Mock order');
      if (input.action === 'assign') {
        await releaseExpired(client, before.platform_id);
        const current = await client.query('SELECT id FROM number_allocations WHERE number_id=$1 AND platform_id=$2 AND released_at IS NULL', [before.number_id, before.platform_id]);
        if (current.rowCount) throw new ApiFailure(409, 'NUMBER_ASSIGNED', 'This number platform is already assigned');
        if (![7,30].includes(input.durationDays)) throw new ApiFailure(400, 'INVALID_DURATION', 'Choose 7 or 30 days');
        if (!before.is_available || !before.sale_enabled || !before.resource_sale_enabled || !['LOCAL','ONLINE'].includes(before.resource_status)) throw new ApiFailure(409, 'RESOURCE_UNAVAILABLE', 'Resource is unavailable');
        if (before.provider === 'pingcode' && (before.resource_status !== 'ONLINE' || !before.resource_expires_at
          || new Date(before.resource_expires_at).getTime() < Date.now()+input.durationDays*86400000)) {
          throw new ApiFailure(409, 'RESOURCE_EXPIRES_TOO_SOON', 'PC resource must cover the full service period');
        }
        await client.query(`INSERT INTO number_allocations(number_id,platform_id,user_id,assigned_at,expires_at)
          VALUES($1,$2,$3,now(),now()+($4*interval '1 day'))`, [before.number_id,before.platform_id,input.userId,input.durationDays]);
      } else if (input.action === 'reclaim') {
        const { rows: [allocation] } = await client.query('SELECT * FROM number_allocations WHERE id=$1 AND number_id=$2 AND platform_id=$3 FOR UPDATE', [input.expectedAllocationId,before.number_id,before.platform_id]);
        if (!before.assigned_user_id && allocation?.user_id === input.expectedUserId && allocation.released_at) return { changed: false };
        if (!allocation || allocation.released_at || allocation.user_id !== input.expectedUserId || before.allocation_id !== input.expectedAllocationId) throw new ApiFailure(409, 'OWNERSHIP_CHANGED', 'Ownership changed; refresh before reclaiming');
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
  /**
   * upstreamOptions = 查询上游资源覆盖的国家与平台组合，并统计资源与已有商品，供创建/同步商品使用。
   */
  private async upstreamOptions(client: PoolClient) {
    const { rows } = await client.query<{ region: string; country: string; service: string; numberCount: number; availableCount: number; productCount: number }>(
      `SELECT n.region_id AS region,r.name AS country,s.platform_id AS service,count(*)::int AS "numberCount",
        (count(*) FILTER (WHERE s.is_available AND s.sale_enabled AND n.resource_status IN ('LOCAL','ONLINE')))::int AS "availableCount",
        (SELECT count(*)::int FROM offers o WHERE o.region_id=n.region_id AND o.service=s.platform_id) AS "productCount"
       FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id JOIN regions r ON r.id=n.region_id
       JOIN provider_projects p ON p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id
       WHERE p.is_active GROUP BY n.region_id,r.name,r.sort_order,s.platform_id ORDER BY r.sort_order,n.region_id,s.platform_id`);
    return rows;
  }
  /**
   * productOptions = 查询上游资源已有的国家与平台组合，供创建商品选择。
   */
  async productOptions() {
    return this.db.transaction(client => this.upstreamOptions(client));
  }
  /** Creates unlisted 7/30-day drafts for upstream combinations that have no product yet; operators then set prices and list them. */
  /**
   * syncProducts = 按资源组合补建缺少的 7/30 天商品草稿。优先复用同平台同天数价格，否则兜底 10/20 积分；新建后不上架。
   */
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
  /**
   * saveProduct = 保存商品。新建时核对上游组合，按国家+平台+套餐定位记录，防止重复或不存在的编辑，并记录审计。
   */
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
