/**
 * recharge.ts 中文分区导读副本：充值设置、记录与入账业务
 * 原文件：backend/src/recharge.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】读取/保存充值规则、分页查看记录、建立充值订单和处理已验证的入账。
 * 【为什么这样组织】配置带版本检查，入账有交易去重；创建待支付订单与确认付款是不同阶段。
 * 【调用链】RechargeController / AdminController → Recharge → recharge_orders / users / point_ledger。
 * 【修改提示】当前支付状态 not_connected；creditVerified 需要可信来源调用，不能把前端点击支付成功当作到账凭据。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { randomUUID } from 'node:crypto';
import { Controller, Get, Injectable, Post, Body, Req, UseGuards, Query } from '@nestjs/common';
import { calculateRechargePoints, createRechargeOrderInputSchema, rechargeQuerySchema, rechargeRulesSchema, type AdminRechargeQuery, type CreateRechargeOrderInput, type RechargeOverview, type RechargeQuery, type RechargeSettings, type RechargeSettingsInput } from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from '../../../../backend/src/authentication.js';
import { Database } from '../../../../backend/src/database.js';
import { Environment } from '../../../../backend/src/environment.js';
import { ApiFailure, SchemaPipe } from '../../../../backend/src/http.js';
import { pagination, Workspace } from '../../../../backend/src/workspace.js';

/**
 * recordFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const recordFields = `r.id,r.order_number AS "orderNumber",r.currency,r.fraction_digits AS "fractionDigits",
  r.amount_minor::float8 AS "amountMinor",r.points,r.status,r.payment_method AS "paymentMethod",
  r.created_at AS "createdAt",r.paid_at AS "paidAt",r.credited_at AS "creditedAt"`;
/**
 * SettingsRow = 数据库读取出的充值配置记录。这里只描述结构，执行操作需看后面的函数。
 */
type SettingsRow = { rules: unknown; version: number; updated_at: Date; updated_by: string };

/**
 * CreditInput = 已确认充值入账所需的内部参数。这里只描述结构，执行操作需看后面的函数。
 */
type CreditInput = { providerTransactionId: string; amountMinor: number; currency: string; paidAt?: string };
/**
 * ==================== 01 充值设置、记录与入账业务 / Recharge ====================
 * Recharge = 充值业务服务。读取/保存兑换规则、管理待支付订单及记录，并提供已验证付款后的内部积分入账能力。
 */
@Injectable()
export class Recharge {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly workspace: Workspace, private readonly environment: Environment, private readonly db: Database) {}
  /**
   * settings = 读取充值配置。数据库已有记录优先，否则使用环境配置；均没有时标记 unconfigured。
   */
  async settings(): Promise<RechargeSettings> {
    const { rows: [row] } = await this.db.query<SettingsRow>(`SELECT s.rules,s.version,s.updated_at,u.display_name AS updated_by
      FROM recharge_settings s JOIN users u ON u.id=s.updated_by WHERE s.id=true`);
    if (row) return { rules: row.rules === null ? null : rechargeRulesSchema.parse(row.rules), version: row.version,
      source: 'database', updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by };
    const rules = this.environment.values.RECHARGE_RULES;
    return { rules, version: 0, source: rules ? 'environment' : 'unconfigured', updatedAt: null, updatedBy: null };
  }
  /**
   * saveSettings = 保存充值规则。锁定修改过程并检查 expectedVersion，成功增加版本、记录审计，再返回新配置。
   */
  async saveSettings(actorId: string, input: RechargeSettingsInput): Promise<RechargeSettings> {
    return this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(734102613)');
      const { rows: [before] } = await client.query<SettingsRow>('SELECT rules,version,updated_at,updated_by FROM recharge_settings WHERE id=true');
      if ((before?.version ?? 0) !== input.expectedVersion) throw new ApiFailure(409, 'RECHARGE_SETTINGS_CHANGED', 'Recharge settings changed; refresh before saving');
      const { rows: [after] } = await client.query<SettingsRow>(`INSERT INTO recharge_settings(id,rules,version,updated_by)
        VALUES(true,$1,1,$2) ON CONFLICT(id) DO UPDATE SET rules=excluded.rules,version=recharge_settings.version+1,
        updated_by=excluded.updated_by,updated_at=now() RETURNING rules,version,updated_at,updated_by`, [input.rules, actorId]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,'RECHARGE_SETTINGS','recharge',$2,$3,$4)`,
        [actorId, input.reason, before ? { rules: before.rules, version: before.version } : { rules: this.environment.values.RECHARGE_RULES, version: 0 }, { rules: after!.rules, version: after!.version }]);
      const { rows: [actor] } = await client.query<{ display_name: string }>('SELECT display_name FROM users WHERE id=$1', [actorId]);
      return { rules: input.rules, version: after!.version, source: 'database', updatedAt: after!.updated_at.toISOString(), updatedBy: actor!.display_name };
    });
  }
  /**
   * records = 分页读取记录。筛选和可见范围交给业务服务处理。
   */
  async records(input: RechargeQuery | AdminRechargeQuery, userId: string | undefined, admin = false) {
    const values: unknown[] = []; const clauses = ['true'];
    const add = (clause: string, value: unknown) => { values.push(value); clauses.push(clause.replaceAll('?', `$${values.length}`)); };
    if (!admin && !userId) throw new ApiFailure(401, 'AUTH_REQUIRED', 'Authentication required');
    if (userId) add('r.user_id=?', userId);
    if (input.status) add('r.status=?', input.status);
    if (input.search) {
      const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
      if (admin) { add('r.order_number ILIKE ?', search); add('u.email ILIKE ?', search); add('u.display_name ILIKE ?', search); add('r.provider_transaction_id ILIKE ?', search); }
      else add('r.order_number ILIKE ?', search);
    }
    const where = clauses.join(' AND '); const from = 'FROM recharge_orders r JOIN users u ON u.id=r.user_id';
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${from} WHERE ${where}`, values);
      const fields = recordFields + (admin ? ',r.user_id AS "userId",u.display_name AS "ownerName",u.email,r.provider_transaction_id AS "providerTransactionId"' : '');
      const { rows } = await client.query(`SELECT ${fields} ${from} WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, input.pageSize, (input.page - 1) * input.pageSize]);
      return { data: rows, pagination: pagination(input, count!.total) };
    });
  }
  /**
   * overview = 读取概览资料。把页面初始化需要的概要数据集中返回。
   */
  async overview(userId: string): Promise<RechargeOverview> {
    const [account, settings] = await Promise.all([this.workspace.account(userId), this.settings()]);
    return { pointsBalance: account.pointsBalance, rules: settings.rules, paymentStatus: 'not_connected', paymentMethods: [] };
  }

  /**
   * createOrder = 建立待支付充值订单，检查配置、金额换算和幂等请求；当前返回 not_connected，不执行真实支付。
   */
  async createOrder(userId: string, input: CreateRechargeOrderInput) {
    const settings = await this.settings();
    const parsed = createRechargeOrderInputSchema.parse(input);
    const rules = settings.rules;
    if (!rules) throw new ApiFailure(409, 'RECHARGE_NOT_CONFIGURED', 'Recharge rules are not configured');
    const converted = calculateRechargePoints(parsed.amountMinor, rules);
    if (converted.error) throw new ApiFailure(400, 'RECHARGE_AMOUNT_INVALID', `Recharge amount cannot be converted: ${converted.error}`);
    return this.db.transaction(async client => {
      const { rows: [user] } = await client.query<{ id: string }>('SELECT id FROM users WHERE id=$1 AND account_status=\'ACTIVE\' FOR SHARE', [userId]);
      if (!user) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
      const { rows: [existing] } = await client.query<{ id: string; order_number: string; amount_minor: number; currency: string; points: number; payment_method: string | null; status: string }>(
        'SELECT id,order_number,amount_minor::float8,currency,points,payment_method,status FROM recharge_orders WHERE user_id=$1 AND idempotency_key=$2 FOR SHARE',
        [userId, parsed.idempotencyKey]);
      if (existing) {
        if (existing.amount_minor !== parsed.amountMinor || existing.currency !== rules.currency || existing.points !== converted.points
          || existing.payment_method !== (parsed.paymentMethod ?? null)) {
          throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different recharge request');
        }
        return { id: existing.id, orderNumber: existing.order_number, status: existing.status as 'PENDING', paymentStatus: 'not_connected' as const };
      }
      const { rows: [row] } = await client.query<{ id: string; order_number: string }>(`INSERT INTO recharge_orders(order_number,user_id,currency,fraction_digits,amount_minor,points,payment_method,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,order_number`, [`LP-R-${randomUUID().toUpperCase()}`, userId, rules.currency,
        rules.fractionDigits, parsed.amountMinor, converted.points, parsed.paymentMethod ?? null, parsed.idempotencyKey]);
      return { id: row!.id, orderNumber: row!.order_number, status: 'PENDING' as const, paymentStatus: 'not_connected' as const };
    });
  }

  /** Payment provider callback boundary: caller must verify signature externally before invoking this transaction. */
  // 此方法名中的 Verified = 调用前已验证付款来源；函数本身不代替外部供应商签名验证，且目前没有接通真实支付回调。
  /**
   * creditVerified = 已验证付款后的内部入账入口。核对供应商交易唯一、订单状态、金额和币种，事务内增加积分、写流水并更新充值状态；调用前必须完成可信验签。
   */
  async creditVerified(orderId: string, input: CreditInput) {
    if (!input.providerTransactionId.trim()) throw new ApiFailure(400, 'PAYMENT_TRANSACTION_REQUIRED', 'A provider transaction ID is required');
    return this.db.transaction(async client => {
      const { rows: [order] } = await client.query<{ id: string; user_id: string; currency: string; amount_minor: number; points: number; status: string; points_ledger_id: string | null }>(
        'SELECT id,user_id,currency,amount_minor::float8,points,status,points_ledger_id FROM recharge_orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!order) throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Recharge order not found');
      const { rows: [duplicate] } = await client.query<{ id: string; status: string }>('SELECT id,status FROM recharge_orders WHERE provider_transaction_id=$1 FOR UPDATE', [input.providerTransactionId]);
      if (duplicate && duplicate.id !== orderId) throw new ApiFailure(409, 'PAYMENT_TRANSACTION_REUSED', 'Payment transaction is already linked to another order');
      if (order.status === 'SUCCEEDED') return { orderId, status: 'SUCCEEDED' as const, idempotent: true };
      if (order.status !== 'PENDING') throw new ApiFailure(409, 'RECHARGE_ORDER_NOT_PENDING', 'Recharge order is not pending');
      if (order.currency !== input.currency || order.amount_minor !== input.amountMinor) throw new ApiFailure(409, 'PAYMENT_AMOUNT_MISMATCH', 'Payment amount or currency does not match the order');
      const { rows: [user] } = await client.query<{ points_balance: number }>('SELECT points_balance FROM users WHERE id=$1 FOR UPDATE', [order.user_id]);
      if (!user) throw new ApiFailure(404, 'USER_NOT_FOUND', 'Recharge owner not found');
      const { rows: [balance] } = await client.query<{ points_balance: number }>('UPDATE users SET points_balance=points_balance+$2 WHERE id=$1 RETURNING points_balance', [order.user_id, order.points]);
      const { rows: [ledger] } = await client.query<{ id: string }>(`INSERT INTO point_ledger(user_id,type,delta,balance_after,description,recharge_order_id)
        VALUES($1,'RECHARGE',$2,$3,$4,$5) RETURNING id`, [order.user_id, order.points, balance!.points_balance, `Recharge ${orderId}`, orderId]);
      await client.query(`UPDATE recharge_orders SET status='SUCCEEDED',provider_transaction_id=$2,paid_at=COALESCE($3::timestamptz,now()),credited_at=now(),points_ledger_id=$4 WHERE id=$1`,
        [orderId, input.providerTransactionId, input.paidAt ?? null, ledger!.id]);
      return { orderId, status: 'SUCCEEDED' as const, idempotent: false, points: order.points, balance: balance!.points_balance };
    });
  }
}
/**
 * ==================== 02 充值设置、记录与入账业务 / RechargeController ====================
 * RechargeController = 充值页面接口入口。要求登录，提供概览、建立充值订单与查询自己的充值记录。
 */
@Controller('account/recharge')
@UseGuards(SessionGuard)
export class RechargeController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly recharge: Recharge) {}
  /**
   * overview = 读取概览资料。把页面初始化需要的概要数据集中返回。
   * 接口：GET /api/account/recharge。接收：登录用户与请求信息(request)。
   */
  @Get() async overview(@Req() request: SessionRequest) { return { data: await this.recharge.overview(request.user.id) }; }
  /**
   * createOrder = 建立待支付充值订单，检查配置、金额换算和幂等请求；当前返回 not_connected，不执行真实支付。
   * 接口：POST /api/account/recharge/orders。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('orders')
  async createOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(createRechargeOrderInputSchema)) input: CreateRechargeOrderInput) {
    return { data: await this.recharge.createOrder(request.user.id, input) };
  }
  /**
   * records = 分页读取记录。筛选和可见范围交给业务服务处理。
   * 接口：GET /api/account/recharge/records。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('records') records(@Req() request: SessionRequest, @Query(new SchemaPipe(rechargeQuerySchema)) input: RechargeQuery) { return this.recharge.records(input, request.user.id); }
}
