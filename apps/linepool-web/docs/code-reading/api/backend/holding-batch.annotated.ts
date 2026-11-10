/**
 * holding-batch.ts 中文分区导读副本：持有记录批量预览与流转
 * 原文件：backend/src/holding-batch.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】选出可转移持有记录，校验接收方和时间窗口，生成预览标识，再原子执行批量转移。
 * 【为什么这样组织】预览标识绑定选择集合与报价，执行时重算，避免分页全选或预览过期导致转错号码。
 * 【调用链】批量预览/执行接口 → HoldingBatch → agent-settlement → 持有记录/权益/账本。
 * 【修改提示】最多 10000 条的选择限制还分布在共享契约、请求体和超时；批量执行依赖预览 fingerprint 与 idempotencyKey。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { HoldingBatchInput, HoldingBatchPreviewInput } from '@linepool/contracts';
import type { Database } from '../../../../backend/src/database.js';
import { ApiFailure } from '../../../../backend/src/http.js';
import { quoteSettlement, saveSettlement, settleBalances } from '../../../../backend/src/agent-settlement.js';

/**
 * transferableHoldingSql = 可转移持有的 SQL 条件。要求代理持有有效、库存已分配且资源可用，服务与资源均未过期。
 */
export function transferableHoldingSql(stock = 's') {
  return `h.owner_type='AGENT' AND h.status='ACTIVE' AND h.transferred_at IS NULL
    AND ${stock}.status='ALLOCATED' AND ${stock}.resource_status IN ('LOCAL','ONLINE')
    AND (h.expires_at IS NULL OR h.expires_at>now())
    AND (${stock}.resource_expires_at IS NULL OR ${stock}.resource_expires_at>now())`;
}

/**
 * BatchContext = 批量操作所需的操作者身份和可见范围。这里只描述结构，执行操作需看后面的函数。
 */
type BatchContext = { agent: { id: string }; capabilities: { transferHoldings: boolean } };

/**
 * Source = 批量操作的一条来源持有记录。这里只描述结构，执行操作需看后面的函数。
 */
type Source = {
  id: string; stock_id: string; inventory_id: string; phone_number: string; region_id: string; platform_id: string;
  cost_minor: string;
  starts_at: Date; expires_at: Date | null; resource_expires_at: Date | null; transferable: boolean;
};

/** One order, set-based writes, and one transaction for up to 10,000 holdings. */
/**
 * ==================== 01 持有记录批量预览与流转 / HoldingBatch ====================
 * HoldingBatch = 持有记录批量预览与流转。选出可转移持有记录，校验接收方和时间窗口，生成预览标识，再原子执行批量转移。
 */
export class HoldingBatch {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database) {}

  /**
   * sources = 按明确编号或跨页筛选取得来源持有。最多 10000 条，核对全部仍可转移；执行时加行锁。
   */
  private async sources(client: PoolClient, agentId: string, input: HoldingBatchPreviewInput, lock: boolean) {
    const values: unknown[] = [agentId];
    let where = "h.owner_type='AGENT' AND h.agent_id=$1";
    const selection = input.selection;
    // IDS 按明确勾选编号选择；FILTER 重新按筛选条件查询所有符合记录，不受当前网页页码限制。
    if (selection.mode === 'IDS') {
      values.push(selection.holdingIds); where += ' AND h.id=ANY($2::uuid[])';
    } else {
      where += ` AND (${transferableHoldingSql()})`;
      if (selection.status) { values.push(selection.status); where += ` AND h.status=$${values.length}`; }
      if (selection.search) {
        values.push(`%${selection.search.replace(/[\\%_]/g, '\\$&')}%`);
        where += ` AND (h.phone_number ILIKE $${values.length} OR h.region_id ILIKE $${values.length})`;
      }
      if (selection.region) { values.push(selection.region); where += ` AND h.region_id=$${values.length}`; }
      if (selection.service) { values.push(selection.service); where += ` AND s.platform_id=$${values.length}`; }
    }
    const { rows } = await client.query<Source>(
      `SELECT h.id,h.phone_number,h.region_id,h.cost_minor,h.starts_at,h.expires_at,s.id AS stock_id,s.inventory_id,
        s.platform_id,s.resource_expires_at,(${transferableHoldingSql()}) AS transferable
       FROM number_holdings h JOIN agent_number_stock s ON s.holding_id=h.id
       WHERE ${where} ORDER BY h.id LIMIT 10001${lock ? ' FOR UPDATE OF h,s' : ''}`, values);
    if (rows.length > 10000) throw new ApiFailure(409, 'BATCH_TOO_LARGE', 'Select at most 10,000 holdings by narrowing the filters');
    if (!rows.length) throw new ApiFailure(409, 'BATCH_EMPTY', 'No eligible holdings match the selection');
    if ((selection.mode === 'IDS' && rows.length !== selection.holdingIds.length) || rows.some(row => !row.transferable)) {
      throw new ApiFailure(409, 'BATCH_SELECTION_CHANGED', 'One or more holdings are no longer available in your inventory');
    }
    return rows;
  }

  /**
   * recipient = 核对接收方。代理目标必须是有权限转移到的直属下级；客户目标必须是当前代理的直属有效客户。
   */
  private async recipient(client: PoolClient, context: BatchContext, input: HoldingBatchPreviewInput, lock: boolean) {
    const recipient = input.recipient;
    if (recipient.ownerType === 'AGENT') {
      if (!context.capabilities.transferHoldings) throw new ApiFailure(403, 'RESALE_SCOPE_INVALID', 'Only level 1 agents can transfer to direct subagents');
      const { rows: [target] } = await client.query<{ status: string }>(
        `SELECT status FROM agents WHERE id=$1 AND parent_agent_id=$2${lock ? ' FOR UPDATE' : ''}`, [recipient.agentId, context.agent.id]);
      if (!target) throw new ApiFailure(403, 'RESALE_SCOPE_INVALID', 'Target must be a direct subagent');
      if (target.status !== 'ACTIVE') throw new ApiFailure(409, 'AGENT_NOT_ACTIVE', 'Target agent is not active');
    } else {
      const { rows: [target] } = await client.query<{ status: string }>(
        `SELECT status FROM customers WHERE id=$1 AND agent_id=$2${lock ? ' FOR UPDATE' : ''}`, [recipient.customerId, context.agent.id]);
      if (!target) throw new ApiFailure(404, 'CUSTOMER_NOT_FOUND', 'Target must be a direct customer');
      if (target.status !== 'ACTIVE') throw new ApiFailure(409, 'CUSTOMER_NOT_ACTIVE', 'Target customer is not active');
    }
  }

  /**
   * plan = 计算每条转移的起止时间、生成新持有编号，并创建绑定来源集合/接收方/期限的预览标识与分布统计。
   */
  private plan(rows: Source[], input: HoldingBatchPreviewInput) {
    const now = Date.now();
    const items = rows.map(row => {
      const startsAt = new Date(Math.max(now, row.starts_at.getTime())).toISOString();
      const maximum = Math.min(row.expires_at?.getTime() ?? Infinity, row.resource_expires_at?.getTime() ?? Infinity);
      const expiry = input.expiresAt ? Date.parse(input.expiresAt) : maximum;
      if (!Number.isFinite(expiry)) throw new ApiFailure(409, 'BATCH_EXPIRY_REQUIRED', 'Choose an expiry for holdings without a finite end');
      if (expiry > maximum) throw new ApiFailure(409, 'HOLDING_WINDOW_EXCEEDED', 'Batch expiry exceeds a holding or resource expiry');
      if (expiry <= Date.parse(startsAt)) throw new ApiFailure(409, 'INVALID_HOLDING_WINDOW', 'Batch expiry must follow each holding start');
      return { sourceId: row.id, holdingId: randomUUID(), stockId: row.stock_id, inventoryId: row.inventory_id, phoneNumber: row.phone_number,
        regionId: row.region_id, service: row.platform_id, startsAt, expiresAt: new Date(expiry).toISOString() };
    });
    // Exclude the clock and generated IDs; include all source/window evidence and the exact requested destination.
    const fingerprint = createHash('sha256').update(JSON.stringify({ rows, recipient: input.recipient, expiresAt: input.expiresAt })).digest('hex');
    const group = (key: 'regionId' | 'service') => {
      const counts = new Map<string, number>();
      for (const item of items) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
      return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    };
    return { items, preview: { fingerprint, count: items.length, sample: items.slice(0, 5).map(item => item.phoneNumber),
      earliestExpiresAt: new Date(Math.min(...items.map(item => Date.parse(item.expiresAt)))).toISOString(),
      latestStartsAt: new Date(Math.max(...items.map(item => Date.parse(item.startsAt)))).toISOString(),
      regions: group('regionId'), services: group('service') } };
  }

  /**
   * settlement = 把转移方案转换为结算来源，调用 quoteSettlement 生成批发或客户零售报价。
   */
  private async settlement(client: PoolClient, agentId: string, rows: Source[], items: ReturnType<HoldingBatch['plan']>['items'], input: HoldingBatchPreviewInput) {
    return quoteSettlement(client, agentId, input.recipient.ownerType === 'AGENT' ? input.recipient.agentId : null,
      input.recipient.ownerType === 'CUSTOMER', items.map((item, index) => ({ key: item.sourceId, phoneNumber: item.phoneNumber, regionId: item.regionId, service: item.service, startsAt: item.startsAt, expiresAt: item.expiresAt, costMinor: Number(rows[index]!.cost_minor) })), input.bookAmountMinor);
  }

  /**
   * preview = 只读预览。查来源、验接收方、规划期限并报价，组合“选择集合标识:报价标识”返回，当前不转移号码。
   */
  async preview(context: BatchContext, input: HoldingBatchPreviewInput) {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='60s'");
      const rows = await this.sources(client, context.agent.id, input, false);
      await this.recipient(client, context, input, false);
      const { items, preview } = this.plan(rows, input);
      const settlement = await this.settlement(client, context.agent.id, rows, items, input);
      return { data: { ...preview, fingerprint: `${preview.fingerprint}:${settlement.quote.fingerprint}`, settlement: settlement.quote } };
    });
  }

  /**
   * execute = 执行批量流转。核对幂等编号 → 锁来源与目标 → 重验预览和报价 → 结算 → 结束旧持有/权益 → 建新持有/权益 → 改库存指向并记事件；整体在同一事务。
   */
  async execute(actorId: string, context: BatchContext, input: HoldingBatchInput) {
    return this.db.transaction(async client => {
      await client.query("SET LOCAL statement_timeout='60s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.idempotencyKey]);
      const { rows: [previous] } = await client.query<{ id: string; status: string; matches: boolean; count: number }>(
        `SELECT id,status,(idempotency_actor_id=$2 AND idempotency_payload->>'operation'='holdingBatch'
          AND idempotency_payload->'input'=$3::jsonb) AS matches,
          (idempotency_payload->'result'->>'count')::int AS count
         FROM tx_orders WHERE idempotency_key=$1 FOR UPDATE`, [input.idempotencyKey, actorId, JSON.stringify(input)]);
      if (previous) {
        if (!previous.matches || previous.status !== 'COMPLETED' || !previous.count) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Batch key was already used with different parameters or actor');
        return { data: { orderId: previous.id, count: previous.count, replayed: true } };
      }
      // 执行时加锁后重新取得来源和接收方，并核对预览标识。预览和执行间资源变化时要求重新预览。
      const rows = await this.sources(client, context.agent.id, input, true);
      await this.recipient(client, context, input, true);
      const { items, preview } = this.plan(rows, input);
      const settlement = await this.settlement(client, context.agent.id, rows, items, input);
      if (`${preview.fingerprint}:${settlement.quote.fingerprint}` !== input.fingerprint) throw new ApiFailure(409, 'BATCH_SELECTION_CHANGED', '号码、价格或计费天数已变化，请重新核对');
      // Recheck the sender under a lock so concurrent suspension cannot race the write.
      const { rows: [sender] } = await client.query<{ status: string }>('SELECT status FROM agents WHERE id=$1 FOR UPDATE', [context.agent.id]);
      if (sender?.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Agent is not active');
      const isAgent = input.recipient.ownerType === 'AGENT';
      const targetId = isAgent ? input.recipient.agentId : input.recipient.customerId;
      const orderId = randomUUID();
      await client.query(
        `INSERT INTO tx_orders(id,order_number,kind,buyer_type,buyer_agent_id,buyer_customer_id,seller_type,seller_agent_id,
          recipient_type,recipient_agent_id,recipient_customer_id,pricing_kind,currency,amount_minor,status,
          idempotency_key,idempotency_actor_id,idempotency_payload,completed_at)
         VALUES($1,$2,'TRANSFER',$3,$4,$5,'AGENT',$6,$3,$4,$5,$7,'USD',0,'COMPLETED',$8,$9,$10::jsonb,now())`,
        [orderId, `LP-${isAgent ? 'R' : 'A'}-${randomUUID().toUpperCase()}`, isAgent ? 'AGENT' : 'CUSTOMER',
          isAgent ? targetId : null, isAgent ? null : targetId, context.agent.id, isAgent ? 'WHOLESALE' : 'RETAIL',
          input.idempotencyKey, actorId, JSON.stringify({ operation: 'holdingBatch', input, result: { count: items.length } })]);
      await settleBalances(client, orderId, settlement);
      const sourceIds = items.map(item => item.sourceId);
      await client.query("UPDATE number_holdings SET status='RETIRED',transferred_at=now() WHERE id=ANY($1::uuid[])", [sourceIds]);
      await client.query("UPDATE service_entitlements SET status='REVOKED' WHERE holding_id=ANY($1::uuid[]) AND status='ACTIVE'", [sourceIds]);
      // 把明细转换成 JSON 批量写入，避免为上万条记录拼出过多 SQL 参数；仍在同一个事务中。
      const payload = JSON.stringify(items);
      // JSON recordset keeps SQL parameter count bounded even for 10,000 numbers.
      const records = `jsonb_to_recordset($1::jsonb) AS item("sourceId" uuid,"holdingId" uuid,"stockId" uuid,"inventoryId" uuid,
        "phoneNumber" text,"regionId" text,service text,"startsAt" timestamptz,"expiresAt" timestamptz)`;
      await client.query(
        `INSERT INTO number_holdings(id,owner_type,agent_id,customer_id,region_id,phone_number,status,source_tx_order_id,source_holding_id,starts_at,expires_at,inventory_id)
         SELECT item."holdingId",$2,$3,$4,item."regionId",item."phoneNumber",'ACTIVE',$5,item."sourceId",item."startsAt",item."expiresAt",item."inventoryId" FROM ${records}`,
        [payload, isAgent ? 'AGENT' : 'CUSTOMER', isAgent ? targetId : null, isAgent ? null : targetId, orderId]);
      await client.query(
        `INSERT INTO service_entitlements(holding_id,service,inventory_id,starts_at,expires_at,status,source_tx_order_id)
         SELECT item."holdingId",item.service,item."inventoryId",item."startsAt",item."expiresAt",'ACTIVE',$2 FROM ${records}`, [payload, orderId]);
      await client.query(
        `UPDATE agent_number_stock stock SET status='ALLOCATED',holding_id=item."holdingId" FROM ${records} WHERE stock.id=item."stockId"`, [payload]);
      await client.query(
        `INSERT INTO agent_number_stock_events(stock_id,holding_id,action,reason,actor_user_id,metadata)
         SELECT item."stockId",item."holdingId",$2,'批量库存划拨',$3,
           jsonb_build_object('orderId',$4::text,'sourceHoldingId',item."sourceId",'fromAgentId',$5::text,'recipientId',$6::text,'batch',true)
         FROM ${records}`, [payload, isAgent ? 'RESELL' : 'ASSIGN_CUSTOMER', actorId, orderId, context.agent.id, targetId]);
      await saveSettlement(client, orderId, settlement, items.map(item => ({ id: item.holdingId, key: item.sourceId })));
      return { data: { orderId, count: items.length, replayed: false } };
    });
  }
}
