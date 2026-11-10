import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { platformCodeRuleShapeSchema, type PlatformCodeRule, type PlatformCodeRuleInput, type PlatformCodeRuleShape,
  type ReceivingReviewInput, type ReceivingReviewView, type ReceivingReviewResult } from '@linepool/contracts';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure } from './http.js';
import { lockPointAccount, settleOrderPoints } from './points-wallet.js';

type RuleRow = { platform_id: PlatformCodeRule['platformId']; enabled: boolean; version: number; rule: PlatformCodeRuleShape; updated_at: Date };
type ReceivingRow = { id: string; user_id: string; order_id: string; number_id: string; platform_id: ReceivingReviewView['scope']['platformId'];
  assigned_at: Date; expires_at: Date; receiving_status: 'WAITING' | 'SUCCESS' | 'FAILED'; first_message_id: string | null; receiving_review_id: string | null;
  code_rule_snapshot: { version: number; rule: PlatformCodeRuleShape }; source_scope: {
    provider: 'pingcode' | 'pingcode-mock'; connectionId: string; externalNumberId: string; externalProjectId: string; phoneNumber: string } };
const viewRule = (row: RuleRow): PlatformCodeRule => ({ platformId: row.platform_id, enabled: row.enabled,
  version: row.version, rule: row.rule, updatedAt: row.updated_at.toISOString() });

/** No upstream calls: receiving success uses trusted routed observations; failure requires an explicit external review. */
@Injectable()
export class LinePoolReceiving {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  async rule(platformId: string) {
    const { rows: [row] } = await this.db.query<RuleRow>('SELECT * FROM lp_platform_code_rules WHERE platform_id=$1', [platformId]);
    return row ? viewRule(row) : null;
  }
  async saveRule(actorId: string, platformId: string, input: PlatformCodeRuleInput) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      const platform = await client.query('SELECT id FROM platforms WHERE id=$1 FOR SHARE', [platformId]);
      if (!platform.rowCount) throw new ApiFailure(404, 'PLATFORM_NOT_FOUND', 'Platform not found');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lp-code-rule:${platformId}`]);
      const { rows: [before] } = await client.query<RuleRow>('SELECT * FROM lp_platform_code_rules WHERE platform_id=$1 FOR UPDATE', [platformId]);
      const { rows: [after] } = await client.query<RuleRow>(`INSERT INTO lp_platform_code_rules(platform_id,enabled,rule,updated_by)
        VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(platform_id) DO UPDATE SET enabled=EXCLUDED.enabled,rule=EXCLUDED.rule,
          version=lp_platform_code_rules.version+1,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [platformId, input.enabled, JSON.stringify(input.rule), actorId]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1,'LP_CODE_RULE',$2,$3,$4::jsonb,$5::jsonb)`, [actorId, platformId, input.reason, JSON.stringify(before ?? null), JSON.stringify(after)]);
      return viewRule(after!);
    });
  }
  async ruleForPurchase(client: PoolClient, platformId: string) {
    const { rows: [row] } = await client.query<RuleRow>('SELECT * FROM lp_platform_code_rules WHERE platform_id=$1 AND enabled FOR SHARE', [platformId]);
    if (!row) throw new ApiFailure(409, 'PLATFORM_CODE_RULE_REQUIRED', 'Configure an enabled platform-specific code rule before one-time receiving can be sold');
    return { version: row.version, rule: platformCodeRuleShapeSchema.parse(row.rule) };
  }
  code(snapshot: unknown, sender: string, body: string) {
    const parsed = platformCodeRuleShapeSchema.safeParse((snapshot as { rule?: unknown } | null)?.rule);
    if (!parsed.success) return null;
    const rule = parsed.data;
    if (!rule.senderAllowlist.some(value => value.trim().toLowerCase() === sender.trim().toLowerCase())) return null;
    if (body.length !== rule.bodyPrefix.length + rule.codeLength + rule.bodySuffix.length
      || !body.startsWith(rule.bodyPrefix) || !body.endsWith(rule.bodySuffix)) return null;
    const code = body.slice(rule.bodyPrefix.length, rule.bodyPrefix.length + rule.codeLength);
    return /^[0-9]+$/.test(code) ? code : null;
  }
  /** Taken by both ingress and review; a successful review cannot race a newly recorded local candidate. */
  async lockSource(client: PoolClient, connectionId: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lp-receiving:${connectionId}`]);
  }
  /** Wallet precedes event/receipt/allocation locks, matching checkout and controlled review. */
  async prepareEvent(client: PoolClient, eventId: string) {
    const { rows } = await client.query<{ user_id: string; order_id: string; connection_id: string }>(`SELECT DISTINCT a.user_id,a.order_id,
      a.source_scope->>'connectionId' AS connection_id FROM provider_event_receipts e JOIN number_allocations a
        ON a.receiving_mode='ONE_TIME' AND a.receiving_status='WAITING'
        AND a.source_scope->>'connectionId'=e.upstream_account_id::text
        AND a.source_scope->>'provider'=e.provider
        AND a.source_scope->>'externalNumberId'=e.normalized_payload->>'externalNumberId'
        AND a.source_scope->>'externalProjectId'=e.normalized_payload->>'externalProjectId'
        AND a.assigned_at<=lp_receiving_occurrence(e.normalized_payload)
        AND lp_receiving_occurrence(e.normalized_payload)<a.expires_at
      WHERE e.id=$1 AND e.event_kind='INBOUND' ORDER BY a.user_id,a.order_id`, [eventId]);
    for (const userId of [...new Set(rows.map(row => row.user_id))]) await lockPointAccount(client, userId, true);
    for (const orderId of [...new Set(rows.map(row => row.order_id))].sort()) await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
    const { rows: [event] } = await client.query<{ upstream_account_id: string | null }>('SELECT upstream_account_id FROM provider_event_receipts WHERE id=$1', [eventId]);
    if (event?.upstream_account_id) await this.lockSource(client, event.upstream_account_id);
  }
  async succeed(client: PoolClient, allocationId: string, messageId: string) {
    const original = await this.allocation(client, allocationId);
    const account = await lockPointAccount(client, original.user_id, true);
    const { rows: [order] } = await client.query<{ point_reservation_id: string }>('SELECT point_reservation_id FROM orders WHERE id=$1 FOR UPDATE', [original.order_id]);
    await this.lockSource(client, original.source_scope.connectionId);
    const allocation = await this.allocation(client, allocationId, true);
    if (allocation.receiving_status !== 'WAITING') throw new ApiFailure(409, 'RECEIVING_STATE_CHANGED', 'One-time receiving is no longer waiting');
    await settleOrderPoints(client, account, order!.point_reservation_id, 'CAPTURED');
    await client.query(`UPDATE number_allocations SET receiving_status='SUCCESS',first_message_id=$2 WHERE id=$1 AND receiving_status='WAITING'`, [allocationId, messageId]);
  }
  private async actor(client: PoolClient, actorId: string) {
    if (this.environment.siteId !== 'linepool') throw new ApiFailure(404, 'NOT_FOUND', 'Platform receiving is unavailable on this site');
    const result = await client.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' FOR SHARE", [actorId]);
    if (!result.rowCount) throw new ApiFailure(403, 'ADMIN_REQUIRED', 'An active administrator is required');
  }
  private async allocation(client: PoolClient, id: string, lock = false) {
    const { rows: [row] } = await client.query<ReceivingRow>(`SELECT a.* FROM number_allocations a JOIN orders o ON o.id=a.order_id
      WHERE a.id=$1 AND a.receiving_mode='ONE_TIME' AND o.product_type='SMS_CODE' AND o.sales_storefront_id='linepool'
      ${lock ? 'FOR UPDATE OF a' : ''}`, [id]);
    if (!row) throw new ApiFailure(404, 'RECEIVING_NOT_FOUND', 'One-time receiving allocation not found');
    return row;
  }
  private async evidence(client: PoolClient, allocation: ReceivingRow): Promise<ReceivingReviewView> {
    const source = allocation.source_scope;
    const values = [source.connectionId, source.provider, source.externalNumberId, source.phoneNumber, allocation.assigned_at, allocation.expires_at];
    // Include unresolved source observations conservatively: a missing resource/project/occurrence cannot prove an empty window.
    const candidate = (alias: string) => `${alias}.upstream_account_id=$1 AND ${alias}.provider=$2 AND
      (${alias}.normalized_payload->>'externalNumberId'=$3 OR ${alias}.normalized_payload->>'phoneNumber'=$4
        OR ${alias}.normalized_payload IS NULL OR ${alias}.normalized_payload->>'externalNumberId' IS NULL)
      AND (lp_receiving_occurrence(${alias}.normalized_payload) IS NULL OR
        (lp_receiving_occurrence(${alias}.normalized_payload)>=$5 AND lp_receiving_occurrence(${alias}.normalized_payload)<$6))`;
    const events = await client.query<{ id: string; status: string; reason: string | null; payload: unknown }>(`SELECT e.id,e.status,e.last_error AS reason,
      COALESCE(e.normalized_payload,e.payload) AS payload FROM provider_event_receipts e WHERE e.event_kind='INBOUND' AND ${candidate('e')} ORDER BY e.id`, values);
    const receipts = await client.query<{ id: string; status: string; reason: string | null; payload: unknown }>(`SELECT c.external_message_id AS id,
      c.processing_status AS status,c.failure_reason AS reason,COALESCE(c.normalized_payload,c.raw_payload) AS payload FROM provider_message_receipts c
      WHERE ${candidate('c')} ORDER BY c.external_message_id`, values);
    const conflicts = await client.query<{ id: string; reason: string; payload: unknown }>(`SELECT f.id,f.reason,
      jsonb_build_object('original',e.normalized_payload,'conflicting',f.normalized_payload,'raw',f.payload) AS payload
      FROM provider_event_conflicts f JOIN provider_event_receipts e ON e.id=f.event_id
      WHERE e.event_kind='INBOUND' AND (${candidate('e')} OR (f.normalized_payload->>'upstreamAccountId'=$1::text
        AND f.normalized_payload->>'provider'=$2 AND (f.normalized_payload->>'externalNumberId'=$3 OR f.normalized_payload->>'phoneNumber'=$4))) ORDER BY f.id`, values);
    const blockers: string[] = [];
    for (const event of events.rows) if (!['IMPORTED', 'IGNORED'].includes(event.status)) blockers.push(`EVENT:${event.id}:${event.status}`);
    for (const receipt of receipts.rows) if (receipt.status !== 'IMPORTED' && !events.rows.some(event =>
      event.status === 'IGNORED' && (event.payload as { externalMessageId?: string } | null)?.externalMessageId === receipt.id)) blockers.push(`RECEIPT:${receipt.id}:${receipt.status}`);
    for (const conflict of conflicts.rows) blockers.push(`CONFLICT:${conflict.id}`);
    if (allocation.receiving_status === 'WAITING') for (const item of [...events.rows, ...receipts.rows]) {
      const payload = item.payload as { sender?: string; content?: string } | null;
      if (payload && typeof payload.sender === 'string' && typeof payload.content === 'string'
        && this.code(allocation.code_rule_snapshot, payload.sender, payload.content)) blockers.push(`VALID_CODE_REQUIRES_RECONCILIATION:${item.id}`);
    }
    const valid = await client.query<{ id: string }>(`SELECT id FROM sms_messages WHERE allocation_id=$1 ORDER BY received_at,id`, [allocation.id]);
    if (valid.rowCount && allocation.receiving_status === 'WAITING') blockers.push('LOCAL_MESSAGE_REQUIRES_RECONCILIATION');
    const scope = { allocationId: allocation.id, orderId: allocation.order_id, connectionId: source.connectionId, provider: source.provider,
      externalNumberId: source.externalNumberId, externalProjectId: source.externalProjectId, phoneNumber: source.phoneNumber,
      platformId: allocation.platform_id, windowStart: allocation.assigned_at.toISOString(), windowEnd: allocation.expires_at.toISOString() };
    const localEvidenceDigest = createHash('sha256').update(JSON.stringify({ scope, rule: allocation.code_rule_snapshot,
      events: events.rows, receipts: receipts.rows, conflicts: conflicts.rows, messages: valid.rows })).digest('hex');
    return { scope, receivingStatus: allocation.receiving_status, firstMessageId: allocation.first_message_id,
      localEvidenceDigest, localEvents: events.rows, localReceipts: receipts.rows, localConflicts: conflicts.rows, blockers };
  }
  async reviewView(actorId: string, id: string) {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      const original = await this.allocation(client, id);
      await this.lockSource(client, original.source_scope.connectionId);
      return this.evidence(client, await this.allocation(client, id));
    });
  }
  async review(actorId: string, id: string, input: ReceivingReviewInput): Promise<ReceivingReviewResult> {
    return this.db.transaction(async client => {
      await this.actor(client, actorId);
      const original = await this.allocation(client, id);
      const account = await lockPointAccount(client, original.user_id, true);
      const { rows: [order] } = await client.query<{ point_reservation_id: string }>('SELECT point_reservation_id FROM orders WHERE id=$1 FOR UPDATE', [original.order_id]);
      await this.lockSource(client, original.source_scope.connectionId);
      const allocation = await this.allocation(client, id, true);
      const result = { allocationId: id, receivingStatus: allocation.receiving_status, firstMessageId: allocation.first_message_id, reviewId: allocation.receiving_review_id };
      if (allocation.receiving_status !== 'WAITING') return result;
      const view = await this.evidence(client, allocation);
      const sameScope = Object.entries(view.scope).every(([key, value]) => input.scope[key as keyof typeof input.scope] === value);
      if (!sameScope) throw new ApiFailure(409, 'RECEIVING_REVIEW_SCOPE_CHANGED', 'Review must identify the original connection, resource, platform and exact reception window');
      if (input.localEvidenceDigest !== view.localEvidenceDigest) throw new ApiFailure(409, 'RECEIVING_EVIDENCE_CHANGED', 'Local observations changed; review the current candidates before confirming');
      if (allocation.expires_at.getTime() > Date.now() || Date.parse(input.reviewedAt) < allocation.expires_at.getTime() || Date.parse(input.reviewedAt) > Date.now()) {
        throw new ApiFailure(409, 'RECEIVING_WINDOW_NOT_REVIEWED', 'The complete receiving window must end before the external review');
      }
      if ((input.source === 'MOCK_SOURCE_REVIEW') !== (allocation.source_scope.provider === 'pingcode-mock')) {
        throw new ApiFailure(409, 'RECEIVING_REVIEW_SOURCE_MISMATCH', 'Use the original source for the complete window review');
      }
      if (view.blockers.length) throw new ApiFailure(409, 'RECEIVING_LOCAL_EVENTS_UNRESOLVED', 'Resolve the local pending or quarantined observations before confirming failure', { blockers: view.blockers });
      const { rows: [review] } = await client.query<{ id: string }>(`INSERT INTO lp_receiving_reviews(allocation_id,actor_id,source,source_reference,
        reviewed_at,scope,local_evidence_digest,local_evidence,reason,complete_window_reviewed,no_valid_code_confirmed)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11) RETURNING id`,
      [id, actorId, input.source, input.sourceReference, input.reviewedAt, JSON.stringify(view.scope), view.localEvidenceDigest,
        JSON.stringify(view), input.reason, input.completeWindowReviewed, input.noValidCodeConfirmed]);
      await settleOrderPoints(client, account, order!.point_reservation_id, 'RELEASED');
      await client.query(`UPDATE number_allocations SET receiving_status='FAILED',receiving_review_id=$2,released_at=expires_at,release_reason='RECEIVING_FAILED'
        WHERE id=$1 AND receiving_status='WAITING'`, [id, review!.id]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1,'LP_RECEIVING_REVIEW',$2,$3,$4::jsonb,$5::jsonb)`, [actorId, id, input.reason,
        JSON.stringify(view), JSON.stringify({ receivingStatus: 'FAILED', reviewId: review!.id, source: input.source, sourceReference: input.sourceReference })]);
      return { allocationId: id, receivingStatus: 'FAILED', firstMessageId: null, reviewId: review!.id };
    });
  }
}
