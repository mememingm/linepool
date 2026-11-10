/**
 * ordering.ts 中文分区导读副本：商城购买与积分扣减
 * 原文件：backend/src/ordering.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】检查商品和积分，预留号码，创建订单，扣积分并记录账本，按模式完成或等待模拟履行。
 * 【为什么这样组织】在事务中锁定用户再处理库存；相同 idempotencyKey 重复请求返回原订单，避免重复扣款。
 * 【调用链】WorkspaceController.createOrder → Ordering.create → ReceivingProvider → Workspace.orderDetail。
 * 【修改提示】购买数量上限在共享契约；商品价从数据库读取。天数筛选、库存有效期和页面选项需一致，不由浏览器决定最终价格。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isStorefrontRegion, type CreateOrderInput } from '@linepool/contracts';
import { Database } from '../../../../backend/src/database.js';
import { ApiFailure } from '../../../../backend/src/http.js';
import { Workspace } from '../../../../backend/src/workspace.js';
import { Environment } from '../../../../backend/src/environment.js';
import { ReceivingProvider } from '../../../../backend/src/providers/receiving-provider.js';
import { MockReceivingProvider } from '../../../../backend/src/providers/mock-receiving-provider.js';

/**
 * ==================== 01 商城购买与积分扣减 / Ordering ====================
 * Ordering = 商城购买与积分扣减。检查商品和积分，预留号码，创建订单，扣积分并记录账本，按模式完成或等待模拟履行。
 */
@Injectable()
export class Ordering {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, private readonly workspace: Workspace, private readonly provider: ReceivingProvider = new MockReceivingProvider(), private readonly environment?: Environment) {}
  /**
   * create = 创建商城订单。校验国家和幂等请求 → 查商品与积分 → 预留库存 → 创建订单并扣积分 → 立即分配或等待沙盒模拟履行 → 写积分流水；同一事务失败则回滚。
   */
  async create(userId: string, input: CreateOrderInput, delivery: 'immediate' | 'deferred-mock' = 'immediate') {
    if (!isStorefrontRegion(input.region)) throw new ApiFailure(409, 'REGION_NOT_AVAILABLE', 'This region is not open for storefront purchases');
    if (this.environment?.values.LOCAL_SANDBOX) delivery = 'deferred-mock';
    // 以下账户、库存、订单和积分流水同属一个事务；任一步失败都回滚。SELECT ... FOR UPDATE 表示锁定将修改的行。
    return this.db.transaction(async client => {
      const { rows: [user] } = await client.query<{ points_balance: number; account_status: string }>(
        'SELECT points_balance,account_status FROM users WHERE id=$1 FOR UPDATE', [userId],
      );
      if (!user || user.account_status !== 'ACTIVE') throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
      const { rows: [existing] } = await client.query<{ id: string; region_id: string; service: string; plan: string; quantity: number; area_code: string | null }>(
        'SELECT id,region_id,service,plan,quantity,area_code FROM orders WHERE user_id=$1 AND idempotency_key=$2', [userId, input.idempotencyKey],
      );
      // 同一幂等编号再次提交时，先核对参数是否一致；一致返回原订单，不再次扣积分。
      if (existing) {
        if (existing.region_id !== input.region || existing.service !== input.service || existing.plan !== input.plan || existing.quantity !== input.quantity || (existing.area_code ?? undefined) !== input.areaCode) {
          throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different request');
        }
        return this.workspace.orderDetail(userId, existing.id, client);
      }
      const { rows: [offer] } = await client.query<{ name: string; unit_points: number; duration_days: number; area_prefix: string; sms_quota: number | null; quota_source: string; allow_renewal: boolean; capability: string }>(
        `SELECT o.* FROM offers o JOIN regions r ON r.id=o.region_id
         WHERE o.region_id=$1 AND o.service=$2 AND o.plan=$3 AND o.is_active AND r.is_active
         AND o.duration_days IN (7,30) AND o.capability='RECEIVE' AND NOT o.allow_renewal FOR SHARE OF o,r`,
        [input.region, input.service, input.plan],
      );
      if (!offer) throw new ApiFailure(404, 'OFFER_NOT_FOUND', 'Offer is unavailable');
      // 价格来自已查到的商品。页面只能选择商品和数量，不能凭自己提交一个低价决定实际扣多少。
      const totalPoints = offer.unit_points * input.quantity;
      if (user.points_balance < totalPoints) throw new ApiFailure(409, 'INSUFFICIENT_POINTS', 'Insufficient points');
      // Lock inventory only after the account lock; concurrent accounts skip claimed rows.
      const numberIds = await this.provider.reserve(client, input, offer);
      const orderId = randomUUID();
      await client.query(
        `INSERT INTO orders(id,order_number,user_id,region_id,service,plan,plan_name,quantity,unit_points,total_points,duration_days,idempotency_key,product_snapshot,area_code,source_channel,fulfillment_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PROCESSING')`,
        [orderId, `LP-${orderId.toUpperCase()}`, userId, input.region, input.service, input.plan, offer.name, input.quantity, offer.unit_points, totalPoints, offer.duration_days, input.idempotencyKey,
          JSON.stringify({ name: offer.name, unitPoints: offer.unit_points, durationDays: offer.duration_days, capability: offer.capability, smsQuota: offer.sms_quota, quotaSource: offer.quota_source, allowRenewal: false, areaPrefix: offer.area_prefix, areaCode: input.areaCode ?? null, allocationMode: input.areaCode ? 'AREA_CODE' : 'AUTO', source: this.provider.source }), input.areaCode ?? null,
          delivery === 'deferred-mock' ? 'SANDBOX' : 'DIRECT'],
      );
      const balanceAfter = user.points_balance - totalPoints;
      await client.query('UPDATE users SET points_balance=$2 WHERE id=$1', [userId, balanceAfter]);
      // 本地沙盒使用延迟模拟履行：先预留号码；普通模拟购买则立刻在本地建立分配。两者都不是真实供应商采购。
      if (delivery === 'deferred-mock') {
        await client.query('UPDATE number_platforms SET reserved_order_id=$1 WHERE number_id=ANY($2::uuid[]) AND platform_id=$3', [orderId, numberIds, input.service]);
        await client.query('INSERT INTO mock_fulfillment_operations(order_id) VALUES($1)', [orderId]);
      } else {
        await this.provider.allocate(client, { userId, orderId, durationDays: offer.duration_days, numberIds });
        await client.query("UPDATE orders SET fulfillment_status='COMPLETED',completed_at=now() WHERE id=$1", [orderId]);
      }
      await client.query(
        `INSERT INTO point_ledger(user_id,type,delta,balance_after,description,reference_id)
         VALUES($1,'ORDER_DEBIT',$2,$3,$4,$5)`, [userId, -totalPoints, balanceAfter, `Demo order ${orderId}`, orderId],
      );
      return this.workspace.orderDetail(userId, orderId, client);
    });
  }
}
