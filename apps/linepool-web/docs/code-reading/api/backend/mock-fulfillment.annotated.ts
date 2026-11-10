/**
 * mock-fulfillment.ts 中文分区导读副本：模拟订单履行状态机
 * 原文件：backend/src/mock-fulfillment.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】领取并处理模拟履行任务，根据确认结果分配号码或退款，保留事件记录。
 * 【为什么这样组织】UNKNOWN 表示无法确认结果，需要后续 resolve；受理、成功和失败分开处理。
 * 【调用链】本地沙盒 → MockFulfillment.claim / resolve → 订单、分配、积分账本。
 * 【修改提示】改变模拟结果看 outcome；不能把 UNKNOWN 直接当成功或失败，否则会错误分配或退款。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Database } from '../../../../backend/src/database.js';
import { ApiFailure } from '../../../../backend/src/http.js';
import { MockReceivingProvider } from '../../../../backend/src/providers/mock-receiving-provider.js';

/**
 * Operation = 模拟订单履行任务的数据库结构。这里只描述结构，执行操作需看后面的函数。
 */
type Operation = { status: string; claim_token: string | null; claim_until: Date | null };
/** Explicit local simulation, used only by the local CLI. No HTTP, queue or supplier write API. */
/**
 * ==================== 01 模拟订单履行状态机 / MockFulfillment ====================
 * MockFulfillment = 模拟订单履行状态机。领取并处理模拟履行任务，根据确认结果分配号码或退款，保留事件记录。
 */
export class MockFulfillment {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database) {}
  /**
   * locked = 在事务中依次锁账户、订单和模拟任务，再执行传入 work，保持并发状态变更的锁定顺序一致。
   */
  private async locked<T>(orderId: string, work: (client: PoolClient, userId: string, operation: Operation) => Promise<T>) {
    return this.db.transaction(async client => {
      const { rows: [order] } = await client.query<{ user_id: string }>('SELECT user_id FROM orders WHERE id=$1', [orderId]);
      if (!order) throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Order not found');
      // Same account -> order -> operation -> sorted resource order for every transition.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [order.user_id]);
      await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const { rows: [operation] } = await client.query<Operation>('SELECT * FROM mock_fulfillment_operations WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (!operation) throw new ApiFailure(409, 'NOT_DEFERRED_MOCK', 'Order has no deferred Mock operation');
      return work(client, order.user_id, operation);
    });
  }
  /**
   * event = 记录模拟履行状态从 before 到 after 的变化与证据，供追踪和排查。
   */
  private async event(client: PoolClient, id: string, before: string, after: string, evidence: string) {
    await client.query(`INSERT INTO mock_fulfillment_events(order_id,from_status,to_status,evidence) VALUES($1,$2,$3,$4)`, [id, before, after, evidence]);
  }
  /**
   * claim = 领取待处理模拟任务，签发 60 秒领取令牌；处理超时则记为 UNCERTAIN，避免盲目重试供应商副作用。
   */
  async claim(orderId: string) {
    return this.locked(orderId, async (client, _userId, op) => {
      if (op.status === 'PROCESSING' && op.claim_until! <= new Date()) {
        await client.query(`UPDATE mock_fulfillment_operations SET status='UNCERTAIN',claim_token=NULL,claim_until=NULL,
          evidence='Local claim expired; outcome requires resolution',updated_at=now() WHERE order_id=$1`, [orderId]);
        await this.event(client, orderId, op.status, 'UNCERTAIN', 'Local claim expired; no automatic retry');
        return { status: 'UNCERTAIN', token: null };
      }
      if (op.status !== 'PENDING') return { status: op.status, token: null };
      const token = randomUUID();
      await client.query(`UPDATE mock_fulfillment_operations SET status='PROCESSING',claim_token=$2,
        claim_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() WHERE order_id=$1`, [orderId, token]);
      await this.event(client, orderId, op.status, 'PROCESSING', 'Local simulator claimed');
      return { status: 'PROCESSING', token };
    });
  }
  /**
   * resolve = 提交明确模拟结果。校验领取状态及令牌；成功分配号码，失败退还原扣减积分并隔离库存，不确定则保留待确认状态。
   */
  async resolve(orderId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN', evidence: string, token?: string) {
    if (evidence.trim().length < 3 || evidence.length > 1000) throw new Error('Mock evidence must be 3..1000 characters');
    return this.locked(orderId, async (client, userId, op) => {
      if (['SUCCEEDED', 'FAILED'].includes(op.status)) {
        if (op.status === outcome) return { changed: false, status: op.status };
        throw new ApiFailure(409, 'MOCK_TERMINAL', 'A terminal Mock result cannot be overwritten');
      }
      if (op.status === 'PROCESSING') {
        if (!token || token !== op.claim_token || op.claim_until! <= new Date()) {
          throw new ApiFailure(409, 'MOCK_CLAIM_STALE', 'Claim token is stale; run claim to record expiry before resolving');
        }
      } else if (op.status !== 'UNCERTAIN' || token) {
        throw new ApiFailure(409, 'MOCK_TRANSITION', 'Claim pending work first; uncertain results require an explicit token-free resolution');
      }
      if (op.status === 'UNCERTAIN' && outcome === 'UNCERTAIN') return { changed: false, status: op.status };
      if (outcome !== 'UNCERTAIN') {
        const { rows: [order] } = await client.query<{ quantity: number; duration_days: number; fulfillment_status: string }>('SELECT quantity,duration_days,fulfillment_status FROM orders WHERE id=$1', [orderId]);
        if (order!.fulfillment_status !== 'PROCESSING') throw new ApiFailure(409, 'ORDER_STATE_CONFLICT', 'Order was already resolved');
        const { rows: numbers } = await client.query<{ id: string }>('SELECT number_id AS id FROM number_platforms WHERE reserved_order_id=$1 ORDER BY number_id FOR UPDATE', [orderId]);
        if (numbers.length !== order!.quantity) throw new ApiFailure(409, 'MOCK_RESERVATION_CONFLICT', 'Reserved inventory differs from order');
        if (outcome === 'SUCCEEDED') {
          await client.query('UPDATE number_platforms SET reserved_order_id=NULL WHERE reserved_order_id=$1', [orderId]);
          await new MockReceivingProvider().allocate(client, { userId, orderId, durationDays: order!.duration_days, numberIds: numbers.map(n => n.id) });
          await client.query("UPDATE orders SET fulfillment_status='COMPLETED',completed_at=now() WHERE id=$1", [orderId]);
        } else {
          const { rows: [debit] } = await client.query<{ id: string; delta: number }>("SELECT id,delta FROM point_ledger WHERE reference_id=$1 AND user_id=$2 AND type='ORDER_DEBIT'", [orderId, userId]);
          if (!debit) throw new ApiFailure(409, 'MOCK_DEBIT_MISSING', 'Original order debit is missing');
          const { rows: [balance] } = await client.query<{ points_balance: number }>('UPDATE users SET points_balance=points_balance-$2 WHERE id=$1 RETURNING points_balance', [userId, debit.delta]);
          await client.query(`INSERT INTO point_ledger(user_id,type,delta,balance_after,description,reference_id,reverses_ledger_id)
            VALUES($1,'ADJUSTMENT',$2,$3,'Deferred Mock failure reversal',$4,$5)`, [userId, -debit.delta, balance!.points_balance, orderId, debit.id]);
          // Explicit failure releases the reservation into a quarantined, unsellable state.
          await client.query('UPDATE number_platforms SET reserved_order_id=NULL,sale_enabled=false WHERE reserved_order_id=$1', [orderId]);
          await client.query("UPDATE orders SET fulfillment_status='FAILED',completed_at=NULL WHERE id=$1", [orderId]);
        }
      }
      await client.query(`UPDATE mock_fulfillment_operations SET status=$2,claim_token=NULL,claim_until=NULL,evidence=$3,updated_at=now() WHERE order_id=$1`, [orderId, outcome, evidence]);
      await this.event(client, orderId, op.status, outcome, evidence);
      return { changed: true, status: outcome };
    });
  }
}
