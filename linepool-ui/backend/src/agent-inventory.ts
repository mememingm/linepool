import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ownerKey,
  type AdjustBalanceInput, type AgentInventoryQuery, type AgentNumberImportInput, type AgentStatusInput, type AgentStockQuery, type AgentTransactionsQuery,
  type ClaimAgentNumberInput, type ClaimAgentNumbersInput, type CreateAgentInput, type CreateCustomerInput, type CreateHoldingInput, type CreateTxOrderInput,
  type AssignHoldingInput, type HoldingBatchPreviewInput, type HoldingBatchInput,
  type OwnerRef, type PaginationQuery, type ReleaseHoldingInput, type ResellHoldingInput, type TransferBalanceInput, type UpsertPriceRuleInput,
  type SubagentsQuery, type UpdateAgentNameInput, type AgentMetricPeriod, type UpdateCustomerInput, type LedgerQuery,
} from '@linepool/contracts';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { pagination } from './workspace.js';
import { HoldingBatch, transferableHoldingSql } from './holding-batch.js';

// Design v1.1 agent & inventory behavior. All balance changes run inside one transaction with
// row-level locks (FOR UPDATE on balance_accounts), ownership checks and balance_ledger writes.
// PingCode purchase stays unavailable: no provider contract exists, so PURCHASE orders fail
// explicitly with PROVIDER_UNAVAILABLE instead of fabricating success.

type AgentRow = { id: string; user_id: string; parent_agent_id: string | null; level: number; name: string; status: string; created_at: Date };
type OwnerKey = { ownerType: 'AGENT' | 'CUSTOMER'; agentId: string | null; customerId: string | null };

const REPORT_TIME_ZONE = 'Asia/Shanghai';
const REPORT_DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

function startOfReportDay(value: Date) {
  const reportClock = new Date(value.getTime() + REPORT_TIME_ZONE_OFFSET_MS);
  reportClock.setUTCHours(0, 0, 0, 0);
  return new Date(reportClock.getTime() - REPORT_TIME_ZONE_OFFSET_MS);
}

function reportDate(value: Date, hourly = false) {
  return new Date(value.getTime() + REPORT_TIME_ZONE_OFFSET_MS).toISOString().slice(0, hourly ? 16 : 10).replace('T', ' ');
}

// Count only messages with immutable allocation evidence and a matching distribution holding/service window.
// Retired holdings remain valid historical evidence up to the recorded transfer time.
const AGENT_SMS_EVIDENCE = `s.received_at>=c.created_at AND EXISTS (
  SELECT 1 FROM number_allocations allocation
  JOIN phone_numbers phone ON phone.id=allocation.number_id
  JOIN number_holdings holding ON holding.phone_number=phone.phone_number
  JOIN service_entitlements entitlement ON entitlement.holding_id=holding.id AND entitlement.service=phone.service
  WHERE allocation.id=s.allocation_id AND allocation.number_id=s.number_id AND allocation.user_id=s.user_id
    AND s.received_at>=allocation.assigned_at
    AND s.received_at<LEAST(allocation.expires_at,COALESCE(allocation.released_at,allocation.expires_at))
    AND ((holding.owner_type='AGENT' AND holding.agent_id=c.agent_id)
      OR (holding.owner_type='CUSTOMER' AND holding.customer_id=c.id))
    AND s.received_at>=holding.starts_at
    AND (holding.expires_at IS NULL OR s.received_at<holding.expires_at)
    AND (holding.transferred_at IS NULL OR s.received_at<holding.transferred_at)
    AND s.received_at>=entitlement.starts_at AND s.received_at<entitlement.expires_at
)`;

const ownerColumns = (alias = '') => ({
  agent: `${alias}agent_id`, customer: `${alias}customer_id`, type: `${alias}owner_type`,
});

function ownerWhere(owner: OwnerKey, columnPrefix = ''): { clause: string; values: unknown[] } {
  const c = ownerColumns(columnPrefix);
  return owner.ownerType === 'AGENT'
    ? { clause: `${c.type}='AGENT' AND ${c.agent}=$1 AND ${c.customer} IS NULL`, values: [owner.agentId] }
    : { clause: `${c.type}='CUSTOMER' AND ${c.customer}=$1 AND ${c.agent} IS NULL`, values: [owner.customerId] };
}

@Injectable()
export class AgentInventory {
  constructor(private readonly db: Database) {}

  // ---------- visibility ----------

  /** Resolve the calling user's platform, agent, or customer identity; null when not enrolled. */
  async resolveActor(userId: string) {
    const { rows: [user] } = await this.db.query<{ role: 'ADMIN' | 'USER'; account_status: string }>(
      'SELECT role,account_status FROM users WHERE id=$1', [userId]);
    if (user?.role === 'ADMIN' && user.account_status === 'ACTIVE') {
      return { kind: 'ADMIN' as const, agentId: null, customerId: null, parentAgentId: null, level: 0, status: 'ACTIVE', name: 'Platform administrator' };
    }
    if (!user || user.account_status !== 'ACTIVE') return null;
    const [agent, customer] = await Promise.all([
      this.db.query<{ id: string; parent_agent_id: string | null; level: number; status: string; name: string }>(
        'SELECT id,parent_agent_id,level,status,name FROM agents WHERE user_id=$1', [userId]),
      this.db.query<{ id: string; agent_id: string | null; status: string; name: string }>(
        'SELECT id,agent_id,status,name FROM customers WHERE user_id=$1', [userId]),
    ]);
    if (agent.rows[0]) {
      const row = agent.rows[0]!;
      return { kind: 'AGENT' as const, agentId: row.id, customerId: null, parentAgentId: row.parent_agent_id, level: row.level, status: row.status, name: row.name };
    }
    if (customer.rows[0]) {
      const row = customer.rows[0]!;
      return { kind: 'CUSTOMER' as const, agentId: row.agent_id, customerId: row.id, parentAgentId: null, level: 0, status: row.status, name: row.name };
    }
    return null;
  }

  /** Agent subtree (self + descendants) or the customer itself — the ownership visibility scope. */
  async visibleAgentIds(client: PoolClient, agentId: string): Promise<string[]> {
    const { rows } = await client.query<{ id: string }>(
      `WITH RECURSIVE tree AS (
        SELECT id FROM agents WHERE id=$1
        UNION ALL SELECT a.id FROM agents a JOIN tree t ON a.parent_agent_id=t.id
      ) SELECT id FROM tree`, [agentId]);
    return rows.map(row => row.id);
  }

  private async assertVisibleOwner(client: PoolClient, actor: NonNullable<Awaited<ReturnType<AgentInventory['resolveActor']>>>, owner: OwnerRef) {
    const key = ownerKey(owner);
    if (actor.kind === 'ADMIN') return key;
    if (actor.kind === 'AGENT') {
      if (key.ownerType === 'AGENT') {
        const visible = await this.visibleAgentIds(client, actor.agentId);
        if (!key.agentId || !visible.includes(key.agentId)) throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Target owner is outside your agent scope');
        return key;
      }
      const { rows: [customer] } = await client.query<{ agent_id: string | null }>(
        'SELECT agent_id FROM customers WHERE id=$1', [key.customerId]);
      if (!customer || !customer.agent_id) throw new ApiFailure(404, 'OWNER_NOT_FOUND', 'Customer not found');
      const visible = await this.visibleAgentIds(client, actor.agentId);
      if (!visible.includes(customer.agent_id)) throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Target owner is outside your agent scope');
      return key;
    }
    // Customer actor may only address itself.
    if (key.ownerType !== 'CUSTOMER' || key.customerId !== actor.customerId) {
      throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Customers can only access their own inventory');
    }
    return key;
  }

  async createAgent(actorId: string, input: CreateAgentInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || (actor.kind !== 'ADMIN' && actor.kind !== 'AGENT')) {
      throw new ApiFailure(403, 'AGENT_MANAGEMENT_REQUIRED', 'Only platform administrators or agents can create agents');
    }
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Account is not active');
    const parentAgentId = actor.kind === 'AGENT' ? actor.agentId : input.parentAgentId;
    const level = actor.kind === 'AGENT' ? actor.level + 1 : input.level;
    if (level > 2) throw new ApiFailure(409, 'MAX_AGENT_LEVEL', 'Only two agent levels are supported');
    if ((level === 1) !== (parentAgentId === null)) {
      throw new ApiFailure(400, 'AGENT_HIERARCHY_INVALID', 'Level 1 agents have no parent; level 2 agents require a parent');
    }
    return this.db.transaction(async client => {
      if (input.idempotencyKey) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.idempotencyKey]);
        const { rows: [previous] } = await client.query<AgentRow>(
          'SELECT * FROM agents WHERE idempotency_key=$1', [input.idempotencyKey]);
        if (previous) {
          const { rowCount } = await client.query(
            'SELECT 1 FROM agents WHERE id=$1 AND idempotency_actor_id=$2 AND idempotency_payload=$3::jsonb',
            [previous.id, actorId, JSON.stringify(input)]);
          if (!rowCount) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Request key was already used with different parameters');
          return { data: mapAgent(previous) };
        }
      }
      if (actor.kind === 'AGENT' && parentAgentId !== actor.agentId) {
        throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Agents can only create direct child agents');
      }
      if (parentAgentId) {
        const { rows: [parent] } = await client.query<{ id: string; level: number; status: string }>(
          'SELECT id,level,status FROM agents WHERE id=$1 FOR UPDATE', [parentAgentId]);
        if (!parent) throw new ApiFailure(404, 'PARENT_AGENT_NOT_FOUND', 'Parent agent was not found');
        if (parent.status !== 'ACTIVE') throw new ApiFailure(409, 'PARENT_AGENT_NOT_ACTIVE', 'Parent agent is not active');
        if (parent.level + 1 !== level) throw new ApiFailure(400, 'AGENT_HIERARCHY_INVALID', 'Agent level must be directly below its parent');
      }
      const { rows: [user] } = await client.query<{ id: string; role: string; account_status: string }>(
        'SELECT id,role,account_status FROM users WHERE id=$1 FOR UPDATE', [input.userId]);
      if (!user) throw new ApiFailure(404, 'USER_NOT_FOUND', 'User was not found');
      if (user.role !== 'USER' || user.account_status !== 'ACTIVE') throw new ApiFailure(409, 'USER_NOT_ELIGIBLE', 'User must be an active standard account');
      const { rows: [existingAgent] } = await client.query('SELECT id FROM agents WHERE user_id=$1', [input.userId]);
      const { rows: [existingCustomer] } = await client.query('SELECT id FROM customers WHERE user_id=$1', [input.userId]);
      if (existingAgent || existingCustomer) throw new ApiFailure(409, 'USER_ALREADY_ENROLLED', 'User is already enrolled in the distribution system');
      const { rows: [agent] } = await client.query<{ id: string; user_id: string; parent_agent_id: string | null; level: number; name: string; status: string; created_at: Date }>(
        `INSERT INTO agents(user_id,parent_agent_id,name,level,idempotency_key,idempotency_actor_id,idempotency_payload)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id,user_id,parent_agent_id,level,name,status,created_at`,
        [input.userId, parentAgentId, input.name, level, input.idempotencyKey ?? null, actorId, JSON.stringify(input)]);
      await client.query("INSERT INTO balance_accounts(owner_type,agent_id,currency) VALUES('AGENT',$1,'USD')", [agent!.id]);
      await client.query(
        `INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
         VALUES($1,'AGENT_CREATE',$2,'创建代理',NULL,$3::jsonb)`, [actorId, agent!.id, JSON.stringify(mapSubagent(agent!))]);
      return { data: { id: agent!.id, userId: agent!.user_id, parentAgentId: agent!.parent_agent_id, level: agent!.level, name: agent!.name, status: agent!.status, createdAt: agent!.created_at.toISOString() } };
    });
  }

  async updateAgentStatus(actorId: string, agentId: string, input: AgentStatusInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || (actor.kind !== 'ADMIN' && actor.kind !== 'AGENT')) {
      throw new ApiFailure(403, 'AGENT_MANAGEMENT_REQUIRED', 'Only administrators or agents can change agent status');
    }
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Account is not active');
    return this.db.transaction(async client => {
      const { rows: [target] } = await client.query<{ id: string; user_id: string; parent_agent_id: string | null; status: string; name: string }>(
        'SELECT id,user_id,parent_agent_id,status,name FROM agents WHERE id=$1 FOR UPDATE', [agentId]);
      if (!target) throw new ApiFailure(404, 'AGENT_NOT_FOUND', 'Agent was not found');
      if (actor.kind === 'AGENT' && target.parent_agent_id !== actor.agentId) {
        throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Agents can only change direct child agent status');
      }
      if (actor.kind === 'AGENT' && (actor.level !== 1 || input.status === 'TERMINATED' || target.status === 'TERMINATED')) {
        throw new ApiFailure(403, 'AGENT_STATUS_FORBIDDEN', 'Only the platform can terminate or reactivate terminated agents');
      }
      if (target.status === input.status) return { data: { changed: false, agentId, status: target.status } };
      await client.query('UPDATE agents SET status=$2 WHERE id=$1', [agentId, input.status]);
      if (input.status !== 'ACTIVE') await client.query('DELETE FROM sessions WHERE user_id=$1', [target.user_id]);
      await client.query(
        `INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
         VALUES($1,'AGENT_STATUS',$2,$3,$4,$5)`,
        [actorId, agentId, input.reason, JSON.stringify(target), JSON.stringify({ ...target, status: input.status })],
      );
      return { data: { changed: true, agentId, status: input.status } };
    });
  }

  async context(actorId: string) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'AGENT') throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only agents can use this workspace');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Agent is not active');
    const { rows: [agent] } = await this.db.query<AgentRow>('SELECT * FROM agents WHERE id=$1', [actor.agentId]);
    return { data: { agent: mapAgent(agent!), capabilities: { manageSubagents: actor.level === 1, transferHoldings: actor.level === 1 } } };
  }

  async updateProfile(actorId: string, input: UpdateAgentNameInput) {
    const { data: context } = await this.context(actorId);
    return this.db.transaction(async client => {
      const { rows: [before] } = await client.query<AgentRow>('SELECT * FROM agents WHERE id=$1 FOR UPDATE', [context.agent.id]);
      const { rows: [updated] } = await client.query<AgentRow>('UPDATE agents SET name=$2 WHERE id=$1 RETURNING *', [context.agent.id, input.name]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1,'AGENT_PROFILE',$2,'代理更新自己的资料',$3::jsonb,$4::jsonb)`,
        [actorId, context.agent.id, JSON.stringify({ name: before!.name }), JSON.stringify({ name: input.name })]);
      return { data: mapAgent(updated!) };
    });
  }

  async updateCustomer(actorId: string, customerId: string, input: UpdateCustomerInput) {
    const { data: context } = await this.context(actorId);
    return this.db.transaction(async client => {
      const { rows: [customer] } = await client.query('SELECT * FROM customers WHERE id=$1 AND agent_id=$2 FOR UPDATE', [customerId, context.agent.id]);
      if (!customer) throw new ApiFailure(404, 'CUSTOMER_NOT_FOUND', 'Direct customer was not found');
      if (customer.status === 'TERMINATED') throw new ApiFailure(409, 'CUSTOMER_TERMINATED', 'Terminated customers cannot be reactivated here');
      const { rows: [updated] } = await client.query('UPDATE customers SET name=$2,status=$3 WHERE id=$1 RETURNING *', [customerId, input.name, input.status]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1,'CUSTOMER_UPDATE',$2,$3,$4::jsonb,$5::jsonb)`,
        [actorId, customerId, input.reason, JSON.stringify({ name: customer.name, status: customer.status }), JSON.stringify(input)]);
      return { data: { id: updated!.id, userId: updated!.user_id, agentId: updated!.agent_id, name: updated!.name, status: updated!.status, createdAt: updated!.created_at.toISOString() } };
    });
  }

  async dashboard(actorId: string, period: AgentMetricPeriod) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'AGENT') throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only agents can use this workspace');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Agent is not active');
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const visibleAgentIds = await this.visibleAgentIds(client, actor.agentId);
      const todayStart = startOfReportDay(new Date());
      const tomorrowStart = new Date(todayStart.getTime() + REPORT_DAY_MS);
      const dayCount = period === 'today' ? 1 : period === '30d' ? 30 : 7;
      const from = period === 'today' ? todayStart : new Date(todayStart.getTime() - (dayCount - 1) * REPORT_DAY_MS);
      const until = tomorrowStart;
      const hourly = period === 'today';
      const { rows: [account] } = await client.query<{ balance_minor: string }>(
        `SELECT COALESCE(balance_minor,0)::text AS balance_minor FROM balance_accounts WHERE owner_type='AGENT' AND agent_id=$1 AND currency='USD'`, [actor.agentId]);
      const { rows: [counts] } = await client.query<{ assigned: number; current: number; customers: number; codes: number; orders: number }>(
        `SELECT
          (SELECT count(*)::int FROM number_holdings WHERE status='ACTIVE' AND owner_type='AGENT' AND agent_id=ANY($1::uuid[])
            AND (expires_at IS NULL OR expires_at>now())) AS assigned,
          (SELECT count(*)::int FROM number_holdings WHERE status='ACTIVE' AND owner_type='AGENT' AND agent_id=$2
            AND (expires_at IS NULL OR expires_at>now())) AS current,
          (SELECT count(*)::int FROM customers WHERE status='ACTIVE' AND agent_id=ANY($1::uuid[])) AS customers,
          (SELECT count(*)::int FROM sms_messages s JOIN customers c ON c.user_id=s.user_id
           WHERE c.agent_id=ANY($1::uuid[]) AND s.received_at >= $3 AND s.received_at < $4 AND ${AGENT_SMS_EVIDENCE}) AS codes,
          (SELECT count(*)::int FROM orders o JOIN customers c ON c.user_id=o.user_id
           WHERE c.agent_id=ANY($1::uuid[]) AND o.created_at >= $3 AND o.created_at < $4) AS orders`, [visibleAgentIds, actor.agentId, todayStart, tomorrowStart]);
      const { rows: [inventory] } = await client.query<{
        available: number; self_assigned: number; subagent_assigned: number; used: number; expired: number; error: number;
      }>(
        `SELECT
          count(DISTINCT h.id) FILTER (WHERE h.owner_type='AGENT' AND h.agent_id=$2 AND h.status='ACTIVE'
            AND (h.expires_at IS NULL OR h.expires_at>now()) AND s.status='ALLOCATED'
            AND s.resource_status IN ('LOCAL','ONLINE')
            AND (s.resource_expires_at IS NULL OR s.resource_expires_at>now()))::int AS available,
          count(DISTINCT h.id) FILTER (WHERE h.owner_type='AGENT' AND h.agent_id=$2 AND h.status='ACTIVE'
            AND (h.expires_at IS NULL OR h.expires_at>now()))::int AS self_assigned,
          count(DISTINCT h.id) FILTER (WHERE h.owner_type='AGENT' AND h.agent_id=ANY($1::uuid[]) AND h.agent_id<>$2
            AND h.status='ACTIVE' AND (h.expires_at IS NULL OR h.expires_at>now()))::int AS subagent_assigned,
          count(DISTINCT h.id) FILTER (WHERE h.owner_type='CUSTOMER' AND c.agent_id=ANY($1::uuid[]) AND h.status='ACTIVE')::int AS used,
          count(DISTINCT h.id) FILTER (WHERE h.owner_type='AGENT' AND h.agent_id=ANY($1::uuid[])
            AND ((h.status='ACTIVE' AND ((h.expires_at IS NOT NULL AND h.expires_at<=now())
              OR (s.resource_expires_at IS NOT NULL AND s.resource_expires_at<=now())))
              OR (h.status='RETIRED' AND h.expires_at IS NOT NULL AND h.expires_at<=COALESCE(h.transferred_at,now()))))::int AS expired,
          count(DISTINCT h.id) FILTER (WHERE h.owner_type='AGENT' AND h.agent_id=ANY($1::uuid[])
            AND s.status='ALLOCATED' AND s.resource_status='ERROR')::int AS error
         FROM number_holdings h
         LEFT JOIN customers c ON c.id=h.customer_id
         LEFT JOIN agent_number_stock s ON s.holding_id=h.id`, [visibleAgentIds, actor.agentId]);
      const { rows: trend } = await client.query<{ date: string; codes: number }>(
        `SELECT to_char(date_trunc('${hourly ? 'hour' : 'day'}', s.received_at AT TIME ZONE '${REPORT_TIME_ZONE}'),'${hourly ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD'}') AS date, count(*)::int AS codes
         FROM sms_messages s JOIN customers c ON c.user_id=s.user_id
         WHERE c.agent_id=ANY($1::uuid[]) AND s.received_at >= $2 AND s.received_at < $3 AND ${AGENT_SMS_EVIDENCE}
         GROUP BY 1 ORDER BY 1`, [visibleAgentIds, from, until]);
      const { rows: children } = await client.query<{ id: string; name: string; inventory_count: number; code_count: number; last_active_at: Date | null }>(
        `SELECT a.id,a.name,
          (SELECT count(*)::int FROM number_holdings h WHERE h.status='ACTIVE' AND h.owner_type='AGENT' AND h.agent_id=a.id
            AND (h.expires_at IS NULL OR h.expires_at>now())) AS inventory_count,
          (SELECT count(*)::int FROM sms_messages s JOIN customers c ON c.user_id=s.user_id WHERE c.agent_id=a.id AND s.received_at >= $2 AND s.received_at < $3 AND ${AGENT_SMS_EVIDENCE}) AS code_count,
          (SELECT max(s.received_at) FROM sms_messages s JOIN customers c ON c.user_id=s.user_id WHERE c.agent_id=a.id AND ${AGENT_SMS_EVIDENCE}) AS last_active_at
         FROM agents a WHERE a.parent_agent_id=$1 ORDER BY a.created_at DESC`, [actor.agentId, from, until]);
      const trendMap = new Map(trend.map(row => [row.date, row.codes]));
      const trendRows = Array.from({ length: hourly ? 24 : dayCount }, (_, index) => {
        const date = reportDate(new Date(from.getTime() + index * (hourly ? REPORT_DAY_MS / 24 : REPORT_DAY_MS)), hourly);
        return { date, salesMinor: null, costMinor: null, profitMinor: null };
      });
      const codeVolume = trendRows.map(row => ({ bucket: row.date, count: trendMap.get(row.date) ?? 0, platform: null }));
      const kpis = {
        balance: account ? Number(account.balance_minor) : 0,
        availableInventory: Number(inventory?.available ?? 0),
        assignedInventory: Number(counts?.assigned ?? 0),
        currentInventory: Number(counts?.current ?? 0),
        subagentCount: children.length,
        customerCount: Number(counts?.customers ?? 0),
        todaySales: null,
        todayProfit: null,
        todayOrders: Number(counts?.orders ?? 0),
        todayCodes: Number(counts?.codes ?? 0),
      };
      return { data: {
        currency: 'USD', costStatus: 'UNAVAILABLE' as const, kpis, trend: trendRows, codeVolume,
        inventoryStatus: {
          AVAILABLE: Number(inventory?.available ?? 0), SELF_ASSIGNED: Number(inventory?.self_assigned ?? 0),
          SUBAGENT_ASSIGNED: Number(inventory?.subagent_assigned ?? 0), USED: Number(inventory?.used ?? 0),
          EXPIRED: Number(inventory?.expired ?? 0), ERROR: Number(inventory?.error ?? 0),
        },
        serviceRanking: [],
        subagents: children.map(row => ({ agentId: row.id, name: row.name, salesMinor: null, codeCount: row.code_count, inventoryCount: row.inventory_count, profitMinor: null, lastActiveAt: row.last_active_at?.toISOString() ?? null })),
      } };
    });
  }

  private async subagentManager(actorId: string) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'AGENT' || actor.level !== 1) throw new ApiFailure(403, 'SUBAGENT_MANAGEMENT_REQUIRED', 'Only level 1 agents can manage direct subagents');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Agent is not active');
    return actor;
  }

  private async directSubagent(client: PoolClient, parentId: string, agentId: string, lock = false) {
    const { rows: [agent] } = await client.query<AgentRow>(
      `SELECT * FROM agents WHERE id=$1 AND parent_agent_id=$2${lock ? ' FOR UPDATE' : ''}`, [agentId, parentId]);
    if (!agent) throw new ApiFailure(404, 'SUBAGENT_NOT_FOUND', 'Direct subagent was not found');
    return agent;
  }

  async subagents(actorId: string, query: SubagentsQuery) {
    const actor = await this.subagentManager(actorId);
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const values: unknown[] = [actor.agentId];
      let where = 'parent_agent_id=$1';
      if (query.search) {
        values.push(`%${query.search.replace(/[\\%_]/g, '\\$&')}%`);
        where += ` AND (name ILIKE $${values.length} OR id::text ILIKE $${values.length})`;
      }
      if (query.status) { values.push(query.status); where += ` AND status=$${values.length}`; }
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM agents WHERE ${where}`, values);
      const { rows } = await client.query<AgentRow>(
        `SELECT * FROM agents WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize]);
      return { data: rows.map(mapSubagent), pagination: pagination(query, count!.total) };
    });
  }

  async subagent(actorId: string, agentId: string) {
    const actor = await this.subagentManager(actorId);
    return this.db.transaction(async client => ({ data: mapSubagent(await this.directSubagent(client, actor.agentId, agentId)) }));
  }

  async renameSubagent(actorId: string, agentId: string, input: UpdateAgentNameInput) {
    const actor = await this.subagentManager(actorId);
    return this.db.transaction(async client => {
      const target = await this.directSubagent(client, actor.agentId, agentId, true);
      if (target.name === input.name) return { data: mapSubagent(target) };
      const { rows: [updated] } = await client.query<AgentRow>('UPDATE agents SET name=$2 WHERE id=$1 RETURNING *', [agentId, input.name]);
      await client.query(
        `INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
         VALUES($1,'AGENT_NAME',$2,'上级修改直属代理名称',$3::jsonb,$4::jsonb)`,
        [actorId, agentId, JSON.stringify({ name: target.name }), JSON.stringify({ name: input.name })]);
      return { data: mapSubagent(updated!) };
    });
  }

  async subagentHoldings(actorId: string, agentId: string, query: PaginationQuery) {
    const actor = await this.subagentManager(actorId);
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.directSubagent(client, actor.agentId, agentId);
      const from = `FROM number_holdings h JOIN number_holdings source ON source.id=h.source_holding_id
        WHERE source.agent_id=$1 AND h.agent_id=$2`;
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${from}`, [actor.agentId, agentId]);
      const { rows } = await client.query(
        `SELECT h.*,COALESCE(source.transferred_at,h.transferred_at,h.created_at) AS transfer_time,
         (h.status='ACTIVE' AND (h.expires_at IS NULL OR h.expires_at>now())
          AND EXISTS(SELECT 1 FROM agent_number_stock s WHERE s.holding_id=h.id AND s.status='ALLOCATED')) AS currently_held
         ${from} ORDER BY source.transferred_at DESC,h.id DESC LIMIT $3 OFFSET $4`,
        [actor.agentId, agentId, query.pageSize, (query.page - 1) * query.pageSize]);
      return { data: rows.map(row => ({ id: row.id, phoneNumber: row.phone_number, regionId: row.region_id,
        startsAt: row.starts_at.toISOString(), expiresAt: row.expires_at?.toISOString() ?? null,
        transferredAt: row.transfer_time.toISOString(), currentlyHeld: row.currently_held })), pagination: pagination(query, count!.total) };
    });
  }

  async subagentTransactions(actorId: string, agentId: string, query: PaginationQuery) {
    const actor = await this.subagentManager(actorId);
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.directSubagent(client, actor.agentId, agentId);
      // Resale: child buys from parent. Balance transfer: parent pays child recipient.
      const where = `(buyer_type='AGENT' AND buyer_agent_id=$2 AND seller_type='AGENT' AND seller_agent_id=$1)
        OR (buyer_type='AGENT' AND buyer_agent_id=$1 AND seller_type='AGENT' AND seller_agent_id=$2)
        OR (buyer_type='AGENT' AND buyer_agent_id=$1 AND recipient_type='AGENT' AND recipient_agent_id=$2)
        OR (buyer_type='AGENT' AND buyer_agent_id=$2 AND recipient_type='AGENT' AND recipient_agent_id=$1)`;
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM tx_orders WHERE ${where}`, [actor.agentId, agentId]);
      const { rows } = await client.query(`SELECT * FROM tx_orders WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
        [actor.agentId, agentId, query.pageSize, (query.page - 1) * query.pageSize]);
      return { data: rows.map(mapTxOrder), pagination: pagination(query, count!.total) };
    });
  }

  async transferableHoldings(actorId: string, query: AgentInventoryQuery) {
    // Both tiers can assign their own available numbers to direct customers.
    const { data: context } = await this.context(actorId);
    const { rows } = await this.db.query(
      `SELECT h.*,s.platform_id AS service FROM number_holdings h JOIN agent_number_stock s ON s.holding_id=h.id
       WHERE h.owner_type='AGENT' AND h.agent_id=$1 AND h.status='ACTIVE' AND s.status='ALLOCATED'
       AND s.resource_status IN ('LOCAL','ONLINE') AND (h.expires_at IS NULL OR h.expires_at>now())
       AND (s.resource_expires_at IS NULL OR s.resource_expires_at>now())
       AND h.phone_number ILIKE $2 ORDER BY h.acquired_at DESC,h.id DESC LIMIT 200`,
      [context.agent.id, `%${query.search.replace(/[\\%_]/g, '\\$&')}%`]);
    return { data: rows.map(row => ({ ...mapHolding(row), service: row.service })) };
  }

  async createCustomer(actorId: string, input: CreateCustomerInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || (actor.kind !== 'ADMIN' && actor.kind !== 'AGENT')) {
      throw new ApiFailure(403, 'CUSTOMER_MANAGEMENT_REQUIRED', 'Only platform administrators or agents can create customers');
    }
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Account is not active');
    const agentId = actor.kind === 'AGENT' ? actor.agentId : input.agentId;
    return this.db.transaction(async client => {
      if (actor.kind === 'AGENT' && agentId !== actor.agentId) {
        throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Agents can only create customers under themselves');
      }
      if (agentId) {
        const { rows: [agent] } = await client.query<{ id: string; status: string }>(
          'SELECT id,status FROM agents WHERE id=$1 FOR UPDATE', [agentId]);
        if (!agent) throw new ApiFailure(404, 'AGENT_NOT_FOUND', 'Owning agent was not found');
        if (agent.status !== 'ACTIVE') throw new ApiFailure(409, 'AGENT_NOT_ACTIVE', 'Owning agent is not active');
      }
      const { rows: [user] } = await client.query<{ id: string; role: string; account_status: string }>(
        'SELECT id,role,account_status FROM users WHERE id=$1 FOR UPDATE', [input.userId]);
      if (!user) throw new ApiFailure(404, 'USER_NOT_FOUND', 'User was not found');
      if (user.role !== 'USER' || user.account_status !== 'ACTIVE') throw new ApiFailure(409, 'USER_NOT_ELIGIBLE', 'User must be an active standard account');
      const { rows: [existingAgent] } = await client.query('SELECT id FROM agents WHERE user_id=$1', [input.userId]);
      const { rows: [existingCustomer] } = await client.query('SELECT * FROM customers WHERE user_id=$1', [input.userId]);
      if (existingCustomer?.agent_id === agentId && existingCustomer?.name === input.name && existingCustomer?.status === 'ACTIVE' && !existingAgent) {
        return { data: { id: existingCustomer.id, userId: existingCustomer.user_id, agentId: existingCustomer.agent_id, name: existingCustomer.name, status: existingCustomer.status, createdAt: existingCustomer.created_at.toISOString() } };
      }
      if (existingAgent || existingCustomer) throw new ApiFailure(409, 'USER_ALREADY_ENROLLED', 'User is already enrolled in the distribution system');
      const { rows: [customer] } = await client.query<{ id: string; user_id: string; agent_id: string | null; name: string; status: string; created_at: Date }>(
        'INSERT INTO customers(user_id,agent_id,name) VALUES($1,$2,$3) RETURNING id,user_id,agent_id,name,status,created_at',
        [input.userId, agentId, input.name]);
      await client.query("INSERT INTO balance_accounts(owner_type,customer_id,currency) VALUES('CUSTOMER',$1,'USD')", [customer!.id]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,after_data)
        VALUES($1,'CUSTOMER_CREATE',$2,'代理绑定直属客户',$3::jsonb)`, [actorId, customer!.id, JSON.stringify({ agentId, name: input.name })]);
      return { data: { id: customer!.id, userId: customer!.user_id, agentId: customer!.agent_id, name: customer!.name, status: customer!.status, createdAt: customer!.created_at.toISOString() } };
    });
  }

  async customerHoldings(actorId: string, customerId: string, query: PaginationQuery) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'AGENT') throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only agents can access customer holdings');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Agent account is not active');
    return this.db.transaction(async client => {
      const { rows: [customer] } = await client.query('SELECT id FROM customers WHERE id=$1 AND agent_id=$2', [customerId, actor.agentId]);
      if (!customer) throw new ApiFailure(404, 'OWNER_NOT_FOUND', 'Direct customer not found');
      const { rows: [count] } = await client.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM number_holdings WHERE owner_type='CUSTOMER' AND customer_id=$1", [customerId]);
      const { rows } = await client.query(
        `SELECT h.*, entitlement.service FROM number_holdings h
         LEFT JOIN LATERAL (SELECT service FROM service_entitlements WHERE holding_id=h.id ORDER BY created_at DESC,id LIMIT 1) entitlement ON true
         WHERE h.owner_type='CUSTOMER' AND h.customer_id=$1 ORDER BY h.acquired_at DESC,h.id LIMIT $2 OFFSET $3`,
        [customerId, query.pageSize, (query.page - 1) * query.pageSize]);
      return { pagination: pagination(query, count!.total), data: rows.map(mapHolding) };
    });
  }

  // ---------- inventory reading ----------

  async holdings(actorId: string, query: AgentInventoryQuery) {
    const actor = await this.resolveActor(actorId);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    return this.db.transaction(async client => {
      const scope = actor.kind === 'ADMIN'
        ? { clause: 'true', values: [] as unknown[] }
        : actor.kind === 'AGENT'
          ? { clause: "h.owner_type='AGENT' AND h.agent_id=$1", values: [actor.agentId] }
          : { clause: "h.owner_type='CUSTOMER' AND h.customer_id=$1", values: [actor.customerId] };
      const values = [...scope.values];
      let where = scope.clause;
      if (query.status) { values.push(query.status); where += ` AND h.status=$${values.length}`; }
      if (query.search) {
        values.push(`%${query.search.replace(/[\\%_]/g, '\\$&')}%`);
        where += ` AND (h.phone_number ILIKE $${values.length} OR h.region_id ILIKE $${values.length})`;
      }
      if (query.region) { values.push(query.region); where += ` AND h.region_id=$${values.length}`; }
      if (query.service) {
        values.push(query.service);
        where += ` AND EXISTS(SELECT 1 FROM service_entitlements e WHERE e.holding_id=h.id AND e.service=$${values.length})`;
      }
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM number_holdings h WHERE ${where}`, values);
      const { rows } = await client.query<{ id: string; owner_type: string; agent_id: string | null; customer_id: string | null; region_id: string; phone_number: string; service: string | null; status: string; source_tx_order_id: string | null; source_holding_id: string | null; starts_at: Date; expires_at: Date | null; transferred_at: Date | null; acquired_at: Date; created_at: Date; transferable: boolean }>(
        `SELECT h.id,h.owner_type,h.agent_id,h.customer_id,h.region_id,h.phone_number,
          COALESCE(stock.platform_id,entitlement.service) AS service, (${transferableHoldingSql('stock')}) AS transferable,
          h.status,h.source_tx_order_id,h.source_holding_id,h.starts_at,h.expires_at,h.transferred_at,h.acquired_at,h.created_at
         FROM number_holdings h
         LEFT JOIN agent_number_stock stock ON stock.holding_id=h.id
         LEFT JOIN LATERAL (SELECT service FROM service_entitlements WHERE holding_id=h.id ORDER BY created_at DESC LIMIT 1) entitlement ON true
         WHERE ${where} ORDER BY h.acquired_at DESC,h.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize]);
      return { pagination: pagination(query, count!.total), data: rows.map(row => ({
        id: row.id, ownerType: row.owner_type, agentId: row.agent_id, customerId: row.customer_id,
        regionId: row.region_id, phoneNumber: row.phone_number, service: row.service, transferable: row.transferable === true,
        status: row.status, sourceTxOrderId: row.source_tx_order_id, sourceHoldingId: row.source_holding_id,
        startsAt: row.starts_at.toISOString(), expiresAt: row.expires_at?.toISOString() ?? null,
        transferredAt: row.transferred_at?.toISOString() ?? null, acquiredAt: row.acquired_at.toISOString(), createdAt: row.created_at.toISOString(),
      })) };
    });
  }

  async stock(actorId: string, query: AgentStockQuery) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind === 'CUSTOMER') throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only administrators and agents can access number stock');
    return this.db.transaction(async client => {
      const values: unknown[] = [];
      let where = 'true';
      if (actor.kind === 'AGENT') {
        values.push(actor.agentId);
        where += ` AND h.agent_id=$${values.length}`;
      }
      if (query.search) {
        values.push(`%${query.search.replace(/[\\%_]/g, '\\$&')}%`);
        where += ` AND (s.phone_number ILIKE $${values.length} OR s.region_id ILIKE $${values.length} OR s.platform_id ILIKE $${values.length} OR s.external_project_id ILIKE $${values.length} OR COALESCE(s.external_number_id,'') ILIKE $${values.length})`;
      }
      if (query.platform) { values.push(query.platform); where += ` AND s.platform_id=$${values.length}`; }
      if (query.region) { values.push(query.region); where += ` AND s.region_id=$${values.length}`; }
      const from = 'FROM agent_number_stock s LEFT JOIN number_holdings h ON h.id=s.holding_id';
      // Status counts ignore the status filter so tab badges stay meaningful while one status is selected.
      const { rows: [counts] } = await client.query<{ AVAILABLE: number; ALLOCATED: number; RELEASED: number }>(`SELECT
        (count(*) FILTER (WHERE s.status='AVAILABLE'))::int AS "AVAILABLE",(count(*) FILTER (WHERE s.status='ALLOCATED'))::int AS "ALLOCATED",
        (count(*) FILTER (WHERE s.status='RELEASED'))::int AS "RELEASED" ${from} WHERE ${where}`, values);
      if (query.status) { values.push(query.status); where += ` AND s.status=$${values.length}`; }
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${from} WHERE ${where}`, values);
      const { rows } = await client.query(
        `SELECT s.*, h.agent_id AS holding_agent_id ${from}
         WHERE ${where} ORDER BY s.imported_at DESC,s.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize]);
      return { data: rows.map(mapStock), pagination: pagination(query, count!.total), counts: counts! };
    });
  }

  async importNumbers(actorId: string, input: AgentNumberImportInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'ADMIN') throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Only platform administrators can import number stock');
    return this.db.transaction(async client => {
      const { rows: [existingImport] } = await client.query<{ imported_count: number; created_at: Date }>(
        'SELECT imported_count,created_at FROM agent_number_imports WHERE idempotency_key=$1 FOR UPDATE', [input.idempotencyKey]);
      if (existingImport) {
        const { rows } = await client.query('SELECT * FROM agent_number_stock WHERE import_idempotency_key=$1 ORDER BY imported_at,id', [input.idempotencyKey]);
        return { data: { idempotencyKey: input.idempotencyKey, importedCount: Number(existingImport.imported_count), replayed: true, items: rows.map(mapStock) } };
      }
      const phones = input.rows.map(row => row.phoneNumber);
      if (new Set(phones).size !== phones.length) throw new ApiFailure(409, 'DUPLICATE_STOCK', 'The import contains duplicate phone numbers');
      const externalKeys = input.rows.filter(row => row.externalNumberId).map(row => `${row.platformId}\\u0000${row.externalProjectId}\\u0000${row.externalNumberId}`);
      if (new Set(externalKeys).size !== externalKeys.length) throw new ApiFailure(409, 'DUPLICATE_STOCK', 'The import contains duplicate external number IDs');
      const { rows: existingPhones } = await client.query<{ phone_number: string }>(
        'SELECT phone_number FROM agent_number_stock WHERE phone_number=ANY($1::text[])', [phones]);
      if (existingPhones.length) throw new ApiFailure(409, 'DUPLICATE_STOCK', `Number already exists in stock: ${existingPhones[0]!.phone_number}`);
      if (externalKeys.length) {
        const projectIds = input.rows.filter(row => row.externalNumberId).map(row => row.externalProjectId);
        const externalIds = input.rows.filter(row => row.externalNumberId).map(row => row.externalNumberId);
        const { rows: conflicts } = await client.query(
          `SELECT 1 FROM agent_number_stock WHERE external_project_id=ANY($1::text[]) AND external_number_id=ANY($2::text[]) LIMIT 1`,
          [projectIds, externalIds]);
        if (conflicts.length) throw new ApiFailure(409, 'DUPLICATE_STOCK', 'An external number ID already exists in stock');
      }
      await client.query(
        'INSERT INTO agent_number_imports(idempotency_key,reason,imported_count,created_by) VALUES($1,$2,$3,$4)',
        [input.idempotencyKey, input.reason, input.rows.length, actorId]);
      const items: Record<string, unknown>[] = [];
      for (const row of input.rows) {
        const { rows: [stock] } = await client.query(
          `INSERT INTO agent_number_stock(provider,platform_id,external_project_id,external_number_id,phone_number,region_id,resource_status,resource_expires_at,import_idempotency_key)
           VALUES('pingcode-mock',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [row.platformId, row.externalProjectId, row.externalNumberId || null, row.phoneNumber, row.regionId, row.resourceStatus, row.resourceExpiresAt ? new Date(row.resourceExpiresAt) : null, input.idempotencyKey]);
        await client.query(
          `INSERT INTO agent_number_stock_events(stock_id,action,reason,actor_user_id,metadata)
           VALUES($1,'IMPORT',$2,$3,$4)`, [stock!.id, input.reason, actorId, JSON.stringify({ provider: 'pingcode-mock' })]);
        items.push(stock!);
      }
      return { data: { idempotencyKey: input.idempotencyKey, importedCount: items.length, replayed: false, items: items.map(mapStock) } };
    });
  }

  async claimStock(actorId: string, input: ClaimAgentNumberInput) {
    const result = await this.claimStocks(actorId, { ...input, stockIds: [input.stockId] });
    return { data: { holding: result.data.holdings[0]!, stock: result.data.stocks[0]!, replayed: result.data.replayed } };
  }

  async claimStocks(actorId: string, input: ClaimAgentNumbersInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'ADMIN') throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Only platform administrators can allocate number stock');
    const targetAgentId = input.agentId;
    if (!targetAgentId) throw new ApiFailure(400, 'AGENT_REQUIRED', 'A target agent is required');
    const startsAt = new Date(input.startsAt);
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= startsAt) {
      throw new ApiFailure(400, 'INVALID_HOLDING_WINDOW', 'Holding expiry must be later than its start');
    }
    return this.db.transaction(async client => {
      const existing = await findIdempotentOrder(client, input.idempotencyKey, actorId, 'claimStocks', input);
      if (existing) {
        if (existing.status !== 'COMPLETED') throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different outcome');
        const { rows: holdings } = await client.query('SELECT * FROM number_holdings WHERE source_tx_order_id=$1 ORDER BY created_at,id', [existing.id]);
        if (holdings.length !== input.stockIds.length) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'The prior stock claim is incomplete');
        const { rows: stocks } = await client.query('SELECT * FROM agent_number_stock WHERE holding_id = ANY($1::uuid[]) ORDER BY imported_at,id', [holdings.map(holding => holding.id)]);
        return { data: { holdings: holdings.map(mapHolding), stocks: stocks.map(mapStock), replayed: true } };
      }
      const { rows: [agent] } = await client.query<{ id: string; status: string }>('SELECT id,status FROM agents WHERE id=$1 FOR UPDATE', [targetAgentId]);
      if (!agent) throw new ApiFailure(404, 'AGENT_NOT_FOUND', 'Target agent was not found');
      if (agent.status !== 'ACTIVE') throw new ApiFailure(409, 'AGENT_NOT_ACTIVE', 'Target agent is not active');
      const stocks: Record<string, unknown>[] = [];
      for (const stockId of input.stockIds) {
        const { rows: [stock] } = await client.query<Record<string, unknown>>('SELECT * FROM agent_number_stock WHERE id=$1 FOR UPDATE', [stockId]);
        if (!stock) throw new ApiFailure(404, 'STOCK_NOT_FOUND', 'Number stock was not found');
        if (stock.status !== 'AVAILABLE') throw new ApiFailure(409, 'STOCK_UNAVAILABLE', 'Number stock is not available');
        if (!['LOCAL', 'ONLINE'].includes(String(stock.resource_status))) throw new ApiFailure(409, 'STOCK_RESOURCE_UNAVAILABLE', 'The number resource is not currently usable');
        if (stock.resource_expires_at && expiresAt > new Date(stock.resource_expires_at as Date)) throw new ApiFailure(409, 'STOCK_RESOURCE_EXPIRES', 'Holding expiry exceeds the resource expiry');
        if (input.service && input.service !== stock.platform_id) throw new ApiFailure(400, 'SERVICE_MISMATCH', 'The requested service does not match the stock platform');
        stocks.push(stock);
      }
      const { rows: [order] } = await client.query(
        `INSERT INTO tx_orders(order_number,kind,buyer_type,buyer_agent_id,seller_type,recipient_type,recipient_agent_id,pricing_kind,currency,amount_minor,status,idempotency_key,idempotency_actor_id,idempotency_payload,completed_at)
         VALUES($1,'ADJUSTMENT','AGENT',$2,'PLATFORM','AGENT',$2,'WHOLESALE','USD',0,'COMPLETED',$3,$4,$5::jsonb,now()) RETURNING id`,
        [`LP-C-${randomUUID().toUpperCase()}`, targetAgentId, input.idempotencyKey, actorId, JSON.stringify({ operation: 'claimStocks', input })]);
      const holdings: Record<string, unknown>[] = [];
      for (const stock of stocks) {
        const { rows: [holding] } = await client.query(
          `INSERT INTO number_holdings(owner_type,agent_id,region_id,phone_number,status,source_tx_order_id,starts_at,expires_at)
           VALUES('AGENT',$1,$2,$3,'ACTIVE',$4,$5,$6) RETURNING *`,
          [targetAgentId, stock.region_id, stock.phone_number, order!.id, startsAt, expiresAt]);
        await client.query(
          `INSERT INTO service_entitlements(holding_id,service,starts_at,expires_at,status,source_tx_order_id)
           VALUES($1,$2,$3,$4,'ACTIVE',$5)`, [holding!.id, stock.platform_id, startsAt, expiresAt, order!.id]);
        const { rows: [updated] } = await client.query('UPDATE agent_number_stock SET status=\'ALLOCATED\',holding_id=$2 WHERE id=$1 RETURNING *', [stock.id, holding!.id]);
        await client.query(
          `INSERT INTO agent_number_stock_events(stock_id,holding_id,action,reason,actor_user_id,metadata)
           VALUES($1,$2,'CLAIM',$3,$4,$5)`, [stock.id, holding!.id, 'Allocated to agent inventory', actorId, JSON.stringify({ agentId: targetAgentId, batch: true })]);
        holdings.push(holding!); stocks[stocks.indexOf(stock)] = updated!;
      }
      return { data: { holdings: holdings.map(mapHolding), stocks: stocks.map(mapStock), replayed: false } };
    });
  }

  async releaseHolding(actorId: string, holdingId: string, input: ReleaseHoldingInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'ADMIN') throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Only platform administrators can release holdings');
    return this.db.transaction(async client => {
      const { rows: [replayed] } = await client.query<{ holding_id: string; stock_id: string; actor_user_id: string; reason: string }>(
        'SELECT holding_id,stock_id,actor_user_id,reason FROM agent_holding_releases WHERE idempotency_key=$1 FOR UPDATE', [input.idempotencyKey]);
      if (replayed) {
        if (replayed.actor_user_id !== actorId || replayed.holding_id !== holdingId || replayed.reason !== input.reason) {
          throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with different release parameters');
        }
        const { rows: [stock] } = await client.query('SELECT * FROM agent_number_stock WHERE id=$1', [replayed.stock_id]);
        if (!stock) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'The prior release has no stock record');
        return { data: { stock: mapStock(stock), releasedHoldingId: holdingId, replayed: true } };
      }
      const { rows: [holding] } = await client.query<any>(
        `SELECT h.*,s.id AS stock_id FROM number_holdings h JOIN agent_number_stock s ON s.holding_id=h.id WHERE h.id=$1 FOR UPDATE`, [holdingId]);
      if (!holding) throw new ApiFailure(404, 'HOLDING_NOT_FOUND', 'Holding was not found');
      if (holding.status !== 'ACTIVE') throw new ApiFailure(409, 'HOLDING_NOT_ACTIVE', 'Holding is not active');
      await client.query(
        `INSERT INTO agent_holding_releases(idempotency_key,actor_user_id,holding_id,stock_id,reason)
         VALUES($1,$2,$3,$4,$5)`, [input.idempotencyKey, actorId, holdingId, holding.stock_id, input.reason]);
      await client.query("UPDATE number_holdings SET status='RETIRED',transferred_at=now() WHERE id=$1", [holdingId]);
      await client.query("UPDATE service_entitlements SET status='REVOKED' WHERE holding_id=$1 AND status='ACTIVE'", [holdingId]);
      const { rows: [stock] } = await client.query(
        "UPDATE agent_number_stock SET status='AVAILABLE',holding_id=NULL WHERE id=$1 RETURNING *", [holding.stock_id]);
      await client.query(
        `INSERT INTO agent_number_stock_events(stock_id,holding_id,action,reason,actor_user_id)
         VALUES($1,$2,'RELEASE',$3,$4)`, [stock!.id, holdingId, input.reason, actorId]);
      return { data: { stock: mapStock(stock!), releasedHoldingId: holdingId, replayed: false } };
    });
  }

  async previewHoldingBatch(actorId: string, input: HoldingBatchPreviewInput) {
    return new HoldingBatch(this.db).preview((await this.context(actorId)).data, input);
  }

  async transferHoldingBatch(actorId: string, input: HoldingBatchInput) {
    return new HoldingBatch(this.db).execute(actorId, (await this.context(actorId)).data, input);
  }

  async assignHoldingToCustomer(actorId: string, input: AssignHoldingInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || (actor.kind !== 'ADMIN' && actor.kind !== 'AGENT')) throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only administrators and agents can assign holdings');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Account is not active');
    const requestedStartsAt = new Date(input.startsAt); const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(requestedStartsAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= requestedStartsAt) throw new ApiFailure(400, 'INVALID_HOLDING_WINDOW', 'Holding expiry must be later than its start');
    return this.db.transaction(async client => {
      const existing = await findIdempotentOrder(client, input.idempotencyKey, actorId, 'assignHoldingToCustomer', input);
      if (existing) {
        if (existing.status !== 'COMPLETED') throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different outcome');
        const { rows: [holding] } = await client.query('SELECT * FROM number_holdings WHERE source_tx_order_id=$1', [existing.id]);
        if (!holding) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'The prior assignment has no destination holding');
        return { data: { holding: mapHolding(holding), orderId: existing.id, replayed: true } };
      }
      const startsAt = new Date(Math.max(requestedStartsAt.getTime(), Date.now()));
      if (expiresAt <= startsAt) throw new ApiFailure(400, 'INVALID_HOLDING_WINDOW', 'Holding expiry must be later than its start');
      const { rows: [source] } = await client.query<any>(
        `SELECT h.*,s.id AS stock_id,s.platform_id,s.status AS stock_status,s.resource_status,s.resource_expires_at
         FROM number_holdings h JOIN agent_number_stock s ON s.holding_id=h.id WHERE h.id=$1 FOR UPDATE`, [input.holdingId]);
      if (!source) throw new ApiFailure(404, 'HOLDING_NOT_FOUND', 'Holding was not found');
      if (source.status !== 'ACTIVE' || source.stock_status !== 'ALLOCATED' || !['LOCAL', 'ONLINE'].includes(source.resource_status)) throw new ApiFailure(409, 'HOLDING_NOT_AVAILABLE', 'Holding is expired or unavailable');
      if (source.expires_at && new Date(source.expires_at).getTime() <= Date.now()) throw new ApiFailure(409, 'HOLDING_NOT_AVAILABLE', 'Holding is expired or unavailable');
      if (source.resource_expires_at && expiresAt > new Date(source.resource_expires_at)) throw new ApiFailure(409, 'HOLDING_WINDOW_EXCEEDED', 'Assignment expiry exceeds the resource expiry');
      if (source.expires_at && expiresAt > new Date(source.expires_at)) throw new ApiFailure(409, 'HOLDING_WINDOW_EXCEEDED', 'Assignment expiry exceeds the source holding window');
      if (startsAt < new Date(source.starts_at)) throw new ApiFailure(409, 'HOLDING_WINDOW_INVALID', 'Assignment starts outside the available holding window');
      if (actor.kind === 'AGENT' && source.agent_id !== actor.agentId) throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Agents can only assign their own holdings');
      const customerSql = actor.kind === 'AGENT'
        ? 'SELECT id,status,agent_id FROM customers WHERE id=$1 AND agent_id=$2 FOR UPDATE'
        : 'SELECT id,status,agent_id FROM customers WHERE id=$1 FOR UPDATE';
      const customerValues = actor.kind === 'AGENT' ? [input.customerId, actor.agentId] : [input.customerId];
      const { rows: [customer] } = await client.query<{ id: string; status: string; agent_id: string | null }>(customerSql, customerValues);
      if (!customer) throw new ApiFailure(404, 'CUSTOMER_NOT_FOUND', 'Target customer was not found');
      if (customer.status !== 'ACTIVE') throw new ApiFailure(409, 'CUSTOMER_NOT_ACTIVE', 'Target customer is not active');
      const { rows: [order] } = await client.query(
        `INSERT INTO tx_orders(order_number,kind,buyer_type,buyer_customer_id,seller_type,seller_agent_id,recipient_type,recipient_customer_id,pricing_kind,currency,amount_minor,status,idempotency_key,idempotency_actor_id,idempotency_payload,completed_at)
         VALUES($1,'TRANSFER','CUSTOMER',$2,'AGENT',$3,'CUSTOMER',$2,'RETAIL','USD',0,'COMPLETED',$4,$5,$6::jsonb,now()) RETURNING id`,
        [`LP-A-${randomUUID().toUpperCase()}`, customer.id, source.agent_id, input.idempotencyKey, actorId, JSON.stringify({ operation: 'assignHoldingToCustomer', input })]);
      await client.query("UPDATE number_holdings SET status='RETIRED',transferred_at=now() WHERE id=$1", [source.id]);
      await client.query("UPDATE service_entitlements SET status='REVOKED' WHERE holding_id=$1 AND status='ACTIVE'", [source.id]);
      const { rows: [holding] } = await client.query(
        `INSERT INTO number_holdings(owner_type,customer_id,region_id,phone_number,status,source_tx_order_id,source_holding_id,starts_at,expires_at)
         VALUES('CUSTOMER',$1,$2,$3,'ACTIVE',$4,$5,$6,$7) RETURNING *`,
        [customer.id, source.region_id, source.phone_number, order!.id, source.id, startsAt, expiresAt]);
      await client.query(
        `INSERT INTO service_entitlements(holding_id,service,starts_at,expires_at,status,source_tx_order_id)
         VALUES($1,$2,$3,$4,'ACTIVE',$5)`, [holding!.id, source.platform_id, startsAt, expiresAt, order!.id]);
      await client.query('UPDATE agent_number_stock SET status=\'ALLOCATED\',holding_id=$2 WHERE id=$1', [source.stock_id, holding!.id]);
      await client.query(
        `INSERT INTO agent_number_stock_events(stock_id,holding_id,action,reason,actor_user_id,metadata)
         VALUES($1,$2,'ASSIGN_CUSTOMER',$3,$4,$5)`, [source.stock_id, holding!.id, 'Assigned to end customer', actorId, JSON.stringify({ fromAgentId: source.agent_id, customerId: customer.id, sourceHoldingId: source.id })]);
      return { data: { holding: mapHolding(holding!), orderId: order!.id, replayed: false } };
    });
  }

  async resellHolding(actorId: string, input: ResellHoldingInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || (actor.kind !== 'ADMIN' && actor.kind !== 'AGENT')) throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only administrators and agents can resell holdings');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Account is not active');
    const requestedStartsAt = new Date(input.startsAt); const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(requestedStartsAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= requestedStartsAt) throw new ApiFailure(400, 'INVALID_HOLDING_WINDOW', 'Holding expiry must be later than its start');
    return this.db.transaction(async client => {
      const existing = await findIdempotentOrder(client, input.idempotencyKey, actorId, 'resellHolding', input);
      if (existing) {
        if (existing.status !== 'COMPLETED') throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different outcome');
        const { rows: [newHolding] } = await client.query('SELECT * FROM number_holdings WHERE source_tx_order_id=$1', [existing.id]);
        if (!newHolding) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'The prior resale has no destination holding');
        return { data: { holding: mapHolding(newHolding), orderId: existing.id, replayed: true } };
      }
      const startsAt = new Date(Math.max(requestedStartsAt.getTime(), Date.now()));
      if (expiresAt <= startsAt) throw new ApiFailure(400, 'INVALID_HOLDING_WINDOW', 'Holding expiry must be later than its start');
      const { rows: [source] } = await client.query<any>(
        `SELECT h.*,s.id AS stock_id,s.platform_id,s.phone_number AS stock_phone_number,
         s.status AS stock_status,s.resource_status,s.resource_expires_at
         FROM number_holdings h JOIN agent_number_stock s ON s.holding_id=h.id WHERE h.id=$1 FOR UPDATE`, [input.holdingId]);
      if (!source) throw new ApiFailure(404, 'HOLDING_NOT_FOUND', 'Holding was not found');
      if (source.status !== 'ACTIVE') throw new ApiFailure(409, 'HOLDING_NOT_ACTIVE', 'Holding is not active');
      if (source.stock_status !== 'ALLOCATED' || !['LOCAL', 'ONLINE'].includes(source.resource_status)
        || (source.expires_at && new Date(source.expires_at).getTime() <= Date.now())
        || (source.resource_expires_at && new Date(source.resource_expires_at).getTime() <= Date.now())
        || expiresAt.getTime() <= Date.now()) throw new ApiFailure(409, 'HOLDING_NOT_AVAILABLE', 'Holding is expired or unavailable');
      if (source.resource_expires_at && expiresAt > new Date(source.resource_expires_at)) throw new ApiFailure(409, 'HOLDING_WINDOW_EXCEEDED', 'Transfer expiry exceeds the resource expiry');
      if (actor.kind === 'AGENT' && source.agent_id !== actor.agentId) throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Agents can only resell their own holdings');
      if (source.agent_id === input.toAgentId) throw new ApiFailure(400, 'RESALE_SAME_OWNER', 'Source and target agents must differ');
      if (source.expires_at && expiresAt > new Date(source.expires_at)) throw new ApiFailure(409, 'HOLDING_WINDOW_EXCEEDED', 'Resale expiry exceeds the source holding window');
      if (startsAt < new Date(source.starts_at)) throw new ApiFailure(409, 'HOLDING_WINDOW_INVALID', 'Resale starts before the source holding');
      const { rows: [target] } = await client.query<{ id: string; status: string; parent_agent_id: string | null }>('SELECT id,status,parent_agent_id FROM agents WHERE id=$1 FOR UPDATE', [input.toAgentId]);
      if (!target) throw new ApiFailure(404, 'AGENT_NOT_FOUND', 'Target agent was not found');
      if (target.status !== 'ACTIVE') throw new ApiFailure(409, 'AGENT_NOT_ACTIVE', 'Target agent is not active');
      if (actor.kind === 'AGENT' && target.parent_agent_id !== actor.agentId) throw new ApiFailure(403, 'RESALE_SCOPE_INVALID', 'Agents can only resell to direct child agents');
      const { rows: [order] } = await client.query(
        `INSERT INTO tx_orders(order_number,kind,buyer_type,buyer_agent_id,seller_type,seller_agent_id,recipient_type,recipient_agent_id,pricing_kind,currency,amount_minor,status,idempotency_key,idempotency_actor_id,idempotency_payload,completed_at)
         VALUES($1,'TRANSFER','AGENT',$2,'AGENT',$3,'AGENT',$2,'WHOLESALE','USD',0,'COMPLETED',$4,$5,$6::jsonb,now()) RETURNING id`,
        [`LP-R-${randomUUID().toUpperCase()}`, input.toAgentId, source.agent_id, input.idempotencyKey, actorId, JSON.stringify({ operation: 'resellHolding', input })]);
      await client.query("UPDATE number_holdings SET status='RETIRED',transferred_at=now() WHERE id=$1", [source.id]);
      await client.query("UPDATE service_entitlements SET status='REVOKED' WHERE holding_id=$1 AND status='ACTIVE'", [source.id]);
      const { rows: [newHolding] } = await client.query(
        `INSERT INTO number_holdings(owner_type,agent_id,region_id,phone_number,status,source_tx_order_id,source_holding_id,starts_at,expires_at)
         VALUES('AGENT',$1,$2,$3,'ACTIVE',$4,$5,$6,$7) RETURNING *`,
        [input.toAgentId, source.region_id, source.phone_number, order!.id, source.id, startsAt, expiresAt]);
      await client.query(
        `INSERT INTO service_entitlements(holding_id,service,starts_at,expires_at,status,source_tx_order_id)
         VALUES($1,$2,$3,$4,'ACTIVE',$5)`, [newHolding!.id, source.platform_id, startsAt, expiresAt, order!.id]);
      await client.query('UPDATE agent_number_stock SET status=\'ALLOCATED\',holding_id=$2 WHERE id=$1', [source.stock_id, newHolding!.id]);
      await client.query(
        `INSERT INTO agent_number_stock_events(stock_id,holding_id,action,reason,actor_user_id,metadata)
         VALUES($1,$2,'RESELL',$3,$4,$5)`, [source.stock_id, newHolding!.id, 'Transferred to child agent', actorId, JSON.stringify({ fromAgentId: source.agent_id, toAgentId: input.toAgentId, sourceHoldingId: source.id })]);
      return { data: { holding: mapHolding(newHolding!), orderId: order!.id, replayed: false } };
    });
  }

  async balances(actorId: string) {
    const actor = await this.resolveActor(actorId);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    return this.db.transaction(async client => {
      const scope = actor.kind === 'ADMIN'
        ? { clause: 'true', values: [] as unknown[] }
        : actor.kind === 'AGENT'
          ? { clause: "(owner_type='AGENT' AND agent_id=$1) OR (owner_type='CUSTOMER' AND customer_id IN (SELECT id FROM customers WHERE agent_id=$1))", values: [actor.agentId] }
          : { clause: "owner_type='CUSTOMER' AND customer_id=$1", values: [actor.customerId] };
      const { rows } = await client.query<{ id: string; owner_type: string; agent_id: string | null; customer_id: string | null; currency: string; balance_minor: string; version: number; created_at: Date }>(
        `SELECT id,owner_type,agent_id,customer_id,currency,balance_minor,version,created_at
         FROM balance_accounts WHERE ${scope.clause} ORDER BY created_at,id`, scope.values);
      return { data: rows.map(row => ({
        id: row.id, ownerType: row.owner_type, agentId: row.agent_id, customerId: row.customer_id,
        currency: row.currency, balanceMinor: Number(row.balance_minor), version: row.version, createdAt: row.created_at.toISOString(),
      })) };
    });
  }

  async transactions(actorId: string, query: AgentTransactionsQuery) {
    const actor = await this.resolveActor(actorId);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const scope = actor.kind === 'ADMIN'
        ? { clause: 'true', values: [] as unknown[] }
        : actor.kind === 'AGENT'
          ? { clause: "(buyer_type='AGENT' AND buyer_agent_id=$1) OR (buyer_type='CUSTOMER' AND buyer_customer_id IN (SELECT id FROM customers WHERE agent_id=$1)) OR (seller_type='AGENT' AND seller_agent_id=$1) OR (recipient_type='AGENT' AND recipient_agent_id=$1) OR (recipient_type='CUSTOMER' AND recipient_customer_id IN (SELECT id FROM customers WHERE agent_id=$1))", values: [actor.agentId] }
          : { clause: "(buyer_type='CUSTOMER' AND buyer_customer_id=$1) OR (recipient_type='CUSTOMER' AND recipient_customer_id=$1)", values: [actor.customerId] };
      const values = [...scope.values];
      let where = `(${scope.clause})`;
      if (query.status) { values.push(query.status); where += ` AND status=$${values.length}`; }
      if (query.kind) { values.push(query.kind); where += ` AND kind=$${values.length}`; }
      if (query.search) {
        values.push(`%${query.search.replace(/[\\%_]/g, '\\$&')}%`);
        where += ` AND (order_number ILIKE $${values.length} OR id::text ILIKE $${values.length})`;
      }
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM tx_orders WHERE ${where}`, values);
      const { rows } = await client.query(
        `SELECT * FROM tx_orders WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize]);
      return { data: rows.map(mapTxOrder), pagination: pagination(query, count!.total) };
    });
  }

  async ledger(actorId: string, owner: OwnerRef, query: LedgerQuery) {
    const actor = await this.resolveActor(actorId);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // Inventory visibility includes descendants; financial ledgers are limited to self and direct customers.
      if (actor.kind === 'AGENT') {
        const ownsAccount = owner.ownerType === 'AGENT'
          ? owner.agentId === actor.agentId
          : !!(await client.query('SELECT 1 FROM customers WHERE id=$1 AND agent_id=$2', [owner.customerId, actor.agentId])).rowCount;
        if (!ownsAccount) throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Only your own ledger and direct customer ledgers are visible');
      }
      const key = await this.assertVisibleOwner(client, actor, owner);
      const w = ownerWhere(key);
      const { rows: [account] } = await client.query<{ id: string; currency: string; balance_minor: string }>(
        `SELECT id,currency,balance_minor FROM balance_accounts WHERE ${w.clause} AND currency=$2`, [...w.values, query.currency]);
      if (!account) return { data: { currency: query.currency, balanceMinor: 0, entries: [] }, pagination: pagination(query, 0) };
      const { rows: [count] } = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM balance_ledger WHERE account_id=$1', [account.id]);
      const { rows } = await client.query(
        'SELECT * FROM balance_ledger WHERE account_id=$1 ORDER BY sequence DESC LIMIT $2 OFFSET $3',
        [account.id, query.pageSize, (query.page - 1) * query.pageSize]);
      return { data: { currency: account.currency, balanceMinor: Number(account.balance_minor), entries: rows.map(row => ({
        id: row.id, accountId: row.account_id, type: row.type, delta: Number(row.delta),
        balanceAfter: Number(row.balance_after), description: row.description, txOrderId: row.tx_order_id,
        createdAt: row.created_at.toISOString(),
      })) }, pagination: pagination(query, count!.total) };
    });
  }

  // ---------- local demo inventory and funds ----------

  async createHolding(actorId: string, input: CreateHoldingInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'ADMIN') throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Only platform administrators can add local inventory');
    if (input.ownerType !== 'AGENT') throw new ApiFailure(409, 'CUSTOMER_HOLDING_NOT_ALLOWED', 'Customers receive service entitlements, not whole-number inventory');
    const startsAt = new Date(input.startsAt);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(startsAt.getTime() + 30 * 86400000);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= startsAt) {
      throw new ApiFailure(400, 'INVALID_HOLDING_WINDOW', 'Holding expiry must be later than its start');
    }
    return this.db.transaction(async client => {
      const existing = await findIdempotentOrder(client, input.idempotencyKey, actorId, 'createHolding', input);
      if (existing) {
        if (existing.status !== 'COMPLETED') throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different outcome');
        const { rows: [holding] } = await client.query('SELECT * FROM number_holdings WHERE source_tx_order_id=$1', [existing.id]);
        if (!holding) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'The prior inventory adjustment has no holding record');
        return { data: mapHolding(holding) };
      }
      const { rows: [agent] } = await client.query<{ id: string; status: string }>(
        'SELECT id,status FROM agents WHERE id=$1 FOR UPDATE', [input.agentId]);
      if (!agent) throw new ApiFailure(404, 'AGENT_NOT_FOUND', 'Target agent was not found');
      if (agent.status !== 'ACTIVE') throw new ApiFailure(409, 'AGENT_NOT_ACTIVE', 'Target agent is not active');
      const { rows: [order] } = await client.query(
        `INSERT INTO tx_orders(order_number,kind,buyer_type,buyer_agent_id,seller_type,recipient_type,recipient_agent_id,pricing_kind,currency,amount_minor,status,idempotency_key,idempotency_actor_id,idempotency_payload,completed_at)
         VALUES($1,'ADJUSTMENT','AGENT',$2,'PLATFORM','AGENT',$2,'RETAIL','USD',0,'COMPLETED',$3,$4,$5::jsonb,now()) RETURNING id`,
        [`LP-I-${randomUUID().toUpperCase()}`, input.agentId, input.idempotencyKey, actorId, JSON.stringify({ operation: 'createHolding', input })]);
      const { rows: [holding] } = await client.query(
        `INSERT INTO number_holdings(owner_type,agent_id,region_id,phone_number,status,source_tx_order_id,starts_at,expires_at)
         VALUES('AGENT',$1,$2,$3,'ACTIVE',$4,$5,$6) RETURNING *`,
        [input.agentId, input.regionId, input.phoneNumber, order!.id, startsAt, expiresAt]);
      await client.query(
        `INSERT INTO service_entitlements(holding_id,service,starts_at,expires_at,status,source_tx_order_id)
         VALUES($1,$2,$3,$4,'ACTIVE',$5)`, [holding!.id, input.service, startsAt, expiresAt, order!.id]);
      return { data: mapHolding(holding!) };
    });
  }

  async adjustBalance(actorId: string, input: AdjustBalanceInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || actor.kind !== 'ADMIN') throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Only platform administrators can adjust demo balances');
    return this.db.transaction(async client => {
      const existing = await findIdempotentOrder(client, input.idempotencyKey, actorId, 'adjustBalance', input);
      if (existing) {
        if (existing.status !== 'COMPLETED') throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different outcome');
        const { rows: [order] } = await client.query('SELECT * FROM tx_orders WHERE id=$1', [existing.id]);
        return { data: mapTxOrder(order!) };
      }
      const key = ownerKey(input);
      const w = ownerWhere(key);
      const { rows: [account] } = await client.query<{ id: string; currency: string; balance_minor: string }>(
        `SELECT id,currency,balance_minor FROM balance_accounts WHERE ${w.clause} AND currency=$2 FOR UPDATE`, [...w.values, input.currency]);
      if (!account) throw new ApiFailure(404, 'BALANCE_ACCOUNT_NOT_FOUND', 'Balance account does not exist for the target owner');
      const amount = input.amountMinor;
      const delta = input.direction === 'CREDIT' ? amount : -amount;
      const after = Number(account.balance_minor) + delta;
      if (after < 0) throw new ApiFailure(409, 'INSUFFICIENT_BALANCE', 'Balance cannot become negative');
      const { rows: [order] } = await client.query(
        `INSERT INTO tx_orders(order_number,kind,buyer_type,buyer_agent_id,buyer_customer_id,seller_type,recipient_type,recipient_agent_id,recipient_customer_id,pricing_kind,currency,amount_minor,status,idempotency_key,idempotency_actor_id,idempotency_payload,completed_at)
         VALUES($1,'ADJUSTMENT',$2,$3,$4,'PLATFORM',$2,$3,$4,'RETAIL',$5,$6,'COMPLETED',$7,$8,$9::jsonb,now()) RETURNING *`,
        [`LP-A-${randomUUID().toUpperCase()}`, key.ownerType, key.agentId, key.customerId, input.currency, amount, input.idempotencyKey, actorId, JSON.stringify({ operation: 'adjustBalance', input })]);
      await client.query('UPDATE balance_accounts SET balance_minor=$2,version=version+1 WHERE id=$1', [account.id, after]);
      await client.query(
        `INSERT INTO balance_ledger(account_id,type,delta,balance_after,description,tx_order_id)
         VALUES($1,'ADJUSTMENT',$2,$3,$4,$5)`, [account.id, delta, after, input.reason, order!.id]);
      await client.query(
        `INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
         VALUES($1,'BALANCE_ADJUSTMENT',$2,$3,$4,$5)`,
        [actorId, account.id, input.reason, JSON.stringify({ balanceMinor: Number(account.balance_minor) }), JSON.stringify({ balanceMinor: after, direction: input.direction, amountMinor: amount })],
      );
      return { data: mapTxOrder(order!) };
    });
  }

  // ---------- pricing ----------

  async setPrice(actorId: string, input: UpsertPriceRuleInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor || (actor.kind !== 'AGENT' && actor.kind !== 'ADMIN')) throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only administrators and agents can set prices');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'AGENT_NOT_ACTIVE', 'Agent account is not active');
    const sellerAgentId = actor.kind === 'ADMIN' ? input.agentId : actor.agentId;
    if (input.pricingKind === 'WHOLESALE' && !sellerAgentId) throw new ApiFailure(400, 'AGENT_REQUIRED', 'A target agent is required for wholesale pricing');
    if (actor.kind === 'AGENT' && input.agentId && input.agentId !== actor.agentId) throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Agents can only set their own prices');
    if (actor.kind === 'AGENT' && actor.level !== 1 && input.pricingKind === 'WHOLESALE') throw new ApiFailure(403, 'SUBAGENT_MANAGEMENT_REQUIRED', 'Only level 1 agents can set child settlement prices');
    if (input.pricingKind === 'RETAIL' && input.buyerAgentId) throw new ApiFailure(400, 'PRICE_BUYER_INVALID', 'Retail prices cannot target an agent');
    if (input.pricingKind === 'WHOLESALE' && input.buyerAgentId === sellerAgentId) throw new ApiFailure(400, 'PRICE_BUYER_INVALID', 'A price recipient must be a child agent');
    return this.db.transaction(async client => {
      if (actor.kind === 'AGENT' && sellerAgentId) {
        const visible = await this.visibleAgentIds(client, actor.agentId);
        if (!visible.includes(sellerAgentId)) throw new ApiFailure(403, 'OWNER_NOT_VISIBLE', 'Target agent is outside your scope');
      }
      if (input.buyerAgentId) {
        const { rows: [buyer] } = await client.query<{ id: string; parent_agent_id: string | null }>(
          'SELECT id,parent_agent_id FROM agents WHERE id=$1', [input.buyerAgentId]);
        if (!buyer || buyer.parent_agent_id !== sellerAgentId) throw new ApiFailure(400, 'PRICE_BUYER_INVALID', 'Price recipient must be a direct child agent');
      }
      const agentId = input.pricingKind === 'WHOLESALE' ? sellerAgentId : null;
      const { rows: [rule] } = await client.query(
        `INSERT INTO price_rules(pricing_kind,agent_id,buyer_agent_id,seller_agent_id,region_id,service,plan,currency,unit_amount_minor,priority,is_active)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING RETURNING *`,
        [input.pricingKind, agentId, input.buyerAgentId ?? null, input.pricingKind === 'RETAIL' ? sellerAgentId : null,
          input.regionId, input.service, input.plan, input.currency, input.unitAmountMinor, input.priority, input.isActive]);
      if (!rule) {
        const { rows: [updated] } = await client.query(
          `UPDATE price_rules SET currency=$8,unit_amount_minor=$9,priority=$10,is_active=$11
           WHERE pricing_kind=$1 AND agent_id IS NOT DISTINCT FROM $2 AND buyer_agent_id IS NOT DISTINCT FROM $3
             AND seller_agent_id IS NOT DISTINCT FROM $4 AND region_id IS NOT DISTINCT FROM $5 AND service=$6 AND plan=$7 RETURNING *`,
          [input.pricingKind, agentId, input.buyerAgentId ?? null, input.pricingKind === 'RETAIL' ? sellerAgentId : null,
            input.regionId, input.service, input.plan, input.currency, input.unitAmountMinor, input.priority, input.isActive]);
        return { data: mapPriceRule(updated!) };
      }
      return { data: mapPriceRule(rule) };
    });
  }

  async prices(actorId: string) {
    const actor = await this.resolveActor(actorId);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    const { rows } = actor.kind === 'ADMIN'
      ? await this.db.query('SELECT * FROM price_rules ORDER BY service,plan,region_id NULLS FIRST,priority DESC')
      : actor.kind === 'AGENT'
        ? await this.db.query(`SELECT * FROM price_rules WHERE
          (pricing_kind='WHOLESALE' AND (agent_id=$1 OR (agent_id=$2 AND (buyer_agent_id=$1 OR buyer_agent_id IS NULL))))
          OR (pricing_kind='RETAIL' AND (seller_agent_id=$1 OR seller_agent_id IS NULL))
          ORDER BY service,plan,region_id NULLS FIRST,priority DESC`, [actor.agentId, actor.parentAgentId])
        : await this.db.query("SELECT * FROM price_rules WHERE pricing_kind='RETAIL' AND is_active AND (seller_agent_id=$1 OR seller_agent_id IS NULL) ORDER BY service,plan,region_id NULLS FIRST,priority DESC", [actor.agentId]);
    return { data: rows.map(mapPriceRule) };
  }

  // ---------- balance transfer ----------

  async transfer(actorId: string, input: TransferBalanceInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Account is not active');
    return this.db.transaction(async client => {
      const existing = await findIdempotentOrder(client, input.idempotencyKey, actorId, 'transfer', input);
      if (existing) {
        if (existing.status !== 'COMPLETED') throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different outcome');
        const { rows: [order] } = await client.query('SELECT * FROM tx_orders WHERE id=$1', [existing.id]);
        return { data: mapTxOrder(order!) };
      }
      const fromKey = await this.assertVisibleOwner(client, actor, input.fromOwner);
      const toKey = await this.assertVisibleOwner(client, actor, input.toOwner);
      if (actor.kind === 'AGENT') {
        if (fromKey.ownerType !== 'AGENT' || fromKey.agentId !== actor.agentId) {
          throw new ApiFailure(403, 'TRANSFER_SCOPE_INVALID', 'Agents can only transfer from their own balance');
        }
        if (toKey.ownerType === 'AGENT') {
          const { rows: [child] } = await client.query<{ id: string }>(
            'SELECT id FROM agents WHERE id=$1 AND parent_agent_id=$2', [toKey.agentId, actor.agentId]);
          if (!child) throw new ApiFailure(403, 'TRANSFER_SCOPE_INVALID', 'Agents can only transfer to direct child agents');
        } else {
          const { rows: [customer] } = await client.query<{ id: string }>(
            'SELECT id FROM customers WHERE id=$1 AND agent_id=$2', [toKey.customerId, actor.agentId]);
          if (!customer) throw new ApiFailure(403, 'TRANSFER_SCOPE_INVALID', 'Agents can only transfer to their own customers');
        }
      } else if (actor.kind === 'CUSTOMER') {
        throw new ApiFailure(403, 'TRANSFER_SCOPE_INVALID', 'Customers cannot initiate balance transfers');
      }
      if (fromKey.ownerType === toKey.ownerType && fromKey.agentId === toKey.agentId && fromKey.customerId === toKey.customerId) {
        throw new ApiFailure(400, 'TRANSFER_SAME_OWNER', 'Source and target owners must differ');
      }
      if (fromKey.ownerType === 'AGENT' && toKey.ownerType === 'CUSTOMER') {
        const { rows: [customer] } = await client.query<{ agent_id: string | null }>('SELECT agent_id FROM customers WHERE id=$1', [toKey.customerId]);
        if (!customer || !customer.agent_id) throw new ApiFailure(409, 'TRANSFER_SCOPE_INVALID', 'Customer transfers require an owning agent');
        const visible = await this.visibleAgentIds(client, actor.kind === 'AGENT' ? actor.agentId : fromKey.agentId!);
        if (!visible.includes(customer.agent_id)) throw new ApiFailure(409, 'TRANSFER_SCOPE_INVALID', 'Target customer is not under the source agent hierarchy');
      }
      // Lock ordering: deterministic by account id to avoid deadlocks between concurrent transfers.
      const wFrom = ownerWhere(fromKey); const wTo = ownerWhere(toKey);
      const { rows: accounts } = await client.query<{ id: string; owner_type: string; agent_id: string | null; customer_id: string | null; currency: string; balance_minor: string; version: number }>(
        `SELECT id,owner_type,agent_id,customer_id,currency,balance_minor,version FROM balance_accounts
         WHERE (${wFrom.clause} OR ${wTo.clause.replaceAll('$1', '$2')}) AND currency=$3 ORDER BY id FOR UPDATE`,
        [...wFrom.values, ...wTo.values, input.currency]);
      const from = accounts.find(a => a.owner_type === fromKey.ownerType && a.agent_id === fromKey.agentId && a.customer_id === fromKey.customerId);
      const to = accounts.find(a => a.owner_type === toKey.ownerType && a.agent_id === toKey.agentId && a.customer_id === toKey.customerId);
      if (!from || !to) throw new ApiFailure(404, 'BALANCE_ACCOUNT_NOT_FOUND', 'Balance account does not exist for one of the owners');
      const amount = input.amountMinor;
      if (Number(from.balance_minor) < amount) throw new ApiFailure(409, 'INSUFFICIENT_BALANCE', 'Insufficient balance for the transfer');
      const orderNumber = `LP-T-${randomUUID().toUpperCase()}`;
      const { rows: [order] } = await client.query(
        `INSERT INTO tx_orders(order_number,kind,buyer_type,buyer_agent_id,buyer_customer_id,seller_type,seller_agent_id,recipient_type,recipient_agent_id,recipient_customer_id,pricing_kind,currency,amount_minor,status,idempotency_key,idempotency_actor_id,idempotency_payload,completed_at)
         VALUES($1,'TRANSFER',$2,$3,$4,'PLATFORM',NULL,$10,$11,$12,'RETAIL',$5,$6,'COMPLETED',$7,$8,$9::jsonb,now()) RETURNING *`,
        [orderNumber, fromKey.ownerType, fromKey.agentId, fromKey.customerId, input.currency, amount, input.idempotencyKey ?? null, actorId, JSON.stringify({ operation: 'transfer', input }), toKey.ownerType, toKey.agentId, toKey.customerId]);
      const fromAfter = Number(from.balance_minor) - amount;
      const toAfter = Number(to.balance_minor) + amount;
      await client.query('UPDATE balance_accounts SET balance_minor=$2,version=version+1 WHERE id=$1', [from.id, fromAfter]);
      await client.query('UPDATE balance_accounts SET balance_minor=$2,version=version+1 WHERE id=$1', [to.id, toAfter]);
      await client.query(
        `INSERT INTO balance_ledger(account_id,type,delta,balance_after,description,tx_order_id) VALUES
         ($1,'TRANSFER_OUT',$2,$3,$4,$5),($6,'TRANSFER_IN',$7,$8,$4,$5)`,
        [from.id, -amount, fromAfter, input.description ?? `Transfer ${order!.order_number}`, order!.id, to.id, amount, toAfter]);
      return { data: mapTxOrder(order!) };
    });
  }

  // ---------- transaction / purchase skeleton ----------

  async createTxOrder(actorId: string, input: CreateTxOrderInput) {
    const actor = await this.resolveActor(actorId);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    if (actor.status !== 'ACTIVE') throw new ApiFailure(403, 'ACTOR_NOT_ACTIVE', 'Account is not active');
    return this.db.transaction(async client => {
      const buyerKey = await this.assertVisibleOwner(client, actor, input.buyerType === 'AGENT'
        ? { ownerType: 'AGENT', agentId: input.buyerAgentId! }
        : { ownerType: 'CUSTOMER', customerId: input.buyerCustomerId! });
      if (input.kind === 'PURCHASE') {
        // PingCode purchase is not implemented: no documented contract for purchasing/allocation.
        throw new ApiFailure(409, 'PROVIDER_UNAVAILABLE', 'PingCode purchase is not available; no supplier contract is connected');
      }
      const existing = await findIdempotentOrder(client, input.idempotencyKey, actorId, 'createTxOrder', input);
      if (existing) return { data: mapTxOrder(existing) };
      const { rows: [order] } = await client.query(
        `INSERT INTO tx_orders(order_number,kind,buyer_type,buyer_agent_id,buyer_customer_id,pricing_kind,currency,status,idempotency_key,idempotency_actor_id,idempotency_payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10::jsonb) RETURNING *`,
        [`LP-X-${randomUUID().toUpperCase()}`, input.kind, buyerKey.ownerType, buyerKey.agentId, buyerKey.customerId,
          input.pricingKind, input.currency, input.idempotencyKey ?? null, actorId, JSON.stringify({ operation: 'createTxOrder', input })]);
      return { data: mapTxOrder(order!) };
    });
  }
}

async function findIdempotentOrder(client: PoolClient, key: string | undefined, actorId: string, operation: string, input: unknown) {
  if (!key) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  const payload = JSON.stringify({ operation, input });
  const { rows: [existing] } = await client.query<{ id: string; status: string; idempotency_actor_id: string | null; idempotency_payload: unknown }>(
    'SELECT id,status,idempotency_actor_id,idempotency_payload FROM tx_orders WHERE idempotency_key=$1 FOR UPDATE', [key]);
  if (!existing) return null;
  const { rowCount } = await client.query(
    'SELECT 1 FROM tx_orders WHERE id=$1 AND idempotency_actor_id=$2 AND idempotency_payload=$3::jsonb',
    [existing.id, actorId, payload]);
  if (!rowCount) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with different request parameters or actor');
  return existing;
}

function mapAgent(row: AgentRow) {
  return { id: row.id, userId: row.user_id, parentAgentId: row.parent_agent_id, level: row.level,
    name: row.name, status: row.status, createdAt: row.created_at.toISOString() };
}

function mapSubagent(row: AgentRow) {
  const { userId: _userId, ...profile } = mapAgent(row);
  return profile;
}

function mapStock(row: Record<string, unknown>) {
  return {
    id: row.id,
    provider: row.provider,
    platformId: row.platform_id,
    externalProjectId: row.external_project_id,
    externalNumberId: row.external_number_id ?? null,
    phoneNumber: row.phone_number,
    regionId: row.region_id,
    resourceStatus: row.resource_status,
    status: row.status,
    resourceExpiresAt: row.resource_expires_at ? (row.resource_expires_at as Date).toISOString() : null,
    holdingId: row.holding_id ?? null,
    importedAt: (row.imported_at as Date).toISOString(),
  };
}

function mapHolding(row: Record<string, unknown>) {
  return {
    id: row.id, ownerType: row.owner_type, agentId: row.agent_id, customerId: row.customer_id,
    regionId: row.region_id, phoneNumber: row.phone_number, service: row.service ?? null, status: row.status, sourceTxOrderId: row.source_tx_order_id, sourceHoldingId: row.source_holding_id,
    startsAt: (row.starts_at as Date).toISOString(), expiresAt: row.expires_at ? (row.expires_at as Date).toISOString() : null,
    transferredAt: row.transferred_at ? (row.transferred_at as Date).toISOString() : null,
    acquiredAt: (row.acquired_at as Date).toISOString(), createdAt: (row.created_at as Date).toISOString(),
  };
}

function mapTxOrder(row: Record<string, unknown>) {
  return {
    id: row.id, orderNumber: row.order_number, kind: row.kind,
    buyerType: row.buyer_type, buyerAgentId: row.buyer_agent_id, buyerCustomerId: row.buyer_customer_id,
    sellerType: row.seller_type, sellerAgentId: row.seller_agent_id,
    recipientType: row.recipient_type ?? null, recipientAgentId: row.recipient_agent_id ?? null, recipientCustomerId: row.recipient_customer_id ?? null,
    pricingKind: row.pricing_kind,
    currency: row.currency, amountMinor: Number(row.amount_minor),
    quantity: (row.idempotency_payload as { result?: { count?: number } } | null)?.result?.count ?? 1,
    points: row.points ?? null,
    status: row.status, sourceOrderId: row.source_order_id,
    createdAt: (row.created_at as Date).toISOString(), completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
  };
}

function mapPriceRule(row: Record<string, unknown>) {
  return {
    id: row.id, pricingKind: row.pricing_kind, agentId: row.agent_id, buyerAgentId: row.buyer_agent_id ?? null, sellerAgentId: row.seller_agent_id ?? null, regionId: row.region_id,
    service: row.service, plan: row.plan, currency: row.currency,
    unitAmountMinor: Number(row.unit_amount_minor), priority: row.priority, isActive: row.is_active,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
