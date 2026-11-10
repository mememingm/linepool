import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { HoldingBatchInput, HoldingBatchPreviewInput } from '@linepool/contracts';
import type { Database } from './database.js';
import { ApiFailure } from './http.js';
import { quoteSettlement, saveSettlement, settleBalances } from './agent-settlement.js';

export function transferableHoldingSql(stock = 's') {
  return `h.owner_type='AGENT' AND h.status='ACTIVE' AND h.transferred_at IS NULL
    AND ${stock}.status='ALLOCATED' AND ${stock}.resource_status IN ('LOCAL','ONLINE')
    AND (h.expires_at IS NULL OR h.expires_at>now())
    AND (${stock}.resource_expires_at IS NULL OR ${stock}.resource_expires_at>now())`;
}

type BatchContext = { agent: { id: string }; capabilities: { transferHoldings: boolean } };

type Source = {
  id: string; stock_id: string; inventory_id: string; phone_number: string; region_id: string; platform_id: string;
  cost_minor: string;
  starts_at: Date; expires_at: Date | null; resource_expires_at: Date | null; transferable: boolean;
};

/** One order, set-based writes, and one transaction for up to 10,000 holdings. */
export class HoldingBatch {
  constructor(private readonly db: Database) {}

  private async sources(client: PoolClient, agentId: string, input: HoldingBatchPreviewInput, lock: boolean) {
    const values: unknown[] = [agentId];
    let where = "h.owner_type='AGENT' AND h.agent_id=$1";
    const selection = input.selection;
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

  private async settlement(client: PoolClient, agentId: string, rows: Source[], items: ReturnType<HoldingBatch['plan']>['items'], input: HoldingBatchPreviewInput) {
    return quoteSettlement(client, agentId, input.recipient.ownerType === 'AGENT' ? input.recipient.agentId : null,
      input.recipient.ownerType === 'CUSTOMER', items.map((item, index) => ({ key: item.sourceId, phoneNumber: item.phoneNumber, regionId: item.regionId, service: item.service, startsAt: item.startsAt, expiresAt: item.expiresAt, costMinor: Number(rows[index]!.cost_minor) })), input.bookAmountMinor);
  }

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
