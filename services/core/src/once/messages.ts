import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { WebhookInbox } from '../providers/webhook-inbox.js';
import { activeMessageAllocation, historyQuerySchema, messageCursor, messagePage, ownedMessageLease, parseInput,
  requireMessageSandbox, smsKey, smsPhone } from './message-access.js';

const demoEventSchema = z.strictObject({ eventId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/), leaseId: z.uuid(),
  providerMessageId: z.string().min(1).max(128), sender: z.string().min(1).max(120), title: z.string().max(200),
  body: z.string().max(12000), code: z.string().max(64).optional(), receivedAt: z.iso.datetime({ offset: true }) });
const adminQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().refine(value => [10,20,50].includes(value)).default(20), search: z.string().max(200).optional(),
  status: z.string().max(40).optional(), eventType: z.string().max(80).optional(),
  from: z.string().refine(value => Number.isFinite(Date.parse(value))).optional(),
  to: z.string().refine(value => Number.isFinite(Date.parse(value))).optional() });
export type OnceMessageRow = { id: string; sender: string; title: string; body: string; code: string | null;
  receivedAt: Date; isRead: boolean; readAt: Date | null; ingestedAt: Date | null };
type InboxEventRow = { id: string; event_id: string; event_kind: string; provider: string; status: string;
  attempts: number; last_error: string | null; processed_at: Date | null; next_attempt_at: Date | null;
  created_at: Date; received_at: Date; number_id: string | null; outbound_id: string | null;
  external_message_id: string | null; provider_message_id: string | null; normalized_payload: Record<string, unknown> | null;
  payload: unknown; conflict_count: number; upstream_account_id: string; historical_only: boolean; import_batch_id: string | null };
const columns = `m.id,m.sender,m.title,m.body,m.verification_code AS code,m.received_at AS "receivedAt",
  m.is_read AS "isRead",m.read_at AS "readAt",m.ingested_at AS "ingestedAt"`;

@Injectable()
export class OnceMessages {
  constructor(private readonly db: Database, private readonly environment: Environment, private readonly inbox: WebhookInbox) {}

  async list(userId: string, leaseId: string) {
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    const { rows } = await this.db.query<OnceMessageRow>(`SELECT ${columns} FROM sms_messages m
      JOIN number_allocations a ON a.id=m.allocation_id AND a.number_id=m.number_id AND a.user_id=m.user_id
      WHERE a.lease_id=$1 AND a.allocation_type='WHOLE_NUMBER' AND m.user_id=$2 ORDER BY m.received_at DESC,m.id ASC LIMIT 200`, [leaseId, userId]);
    return rows;
  }

  async history(userId: string, leaseId: string, input: unknown) {
    const query = parseInput(historyQuerySchema, input);
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    const scope = `messages:${userId}:${leaseId}`, position = messageCursor(query.cursor, scope);
    const { rows } = await this.db.query<OnceMessageRow>(`SELECT ${columns} FROM sms_messages m
      JOIN number_allocations a ON a.id=m.allocation_id AND a.number_id=m.number_id AND a.user_id=m.user_id
      WHERE a.lease_id=$1 AND a.allocation_type='WHOLE_NUMBER' AND m.user_id=$2
        AND ($3::timestamptz IS NULL OR m.received_at<$3 OR (m.received_at=$3 AND m.id>$4::uuid))
      ORDER BY m.received_at DESC,m.id ASC LIMIT $5`, [leaseId, userId, position?.time ?? null, position?.id ?? null, query.limit + 1]);
    return messagePage(rows, query.limit, scope, row => row.receivedAt);
  }

  async simulate(userId: string, leaseId: string) {
    requireMessageSandbox(this.environment);
    const lease = await this.currentDemoLease(userId, leaseId), messageId = `IN-${randomUUID()}`;
    const saved = await this.inbox.recordVerified({ scopeKind: 'ACCOUNT' }, { eventId: `demo-${messageId}`, messageId,
      numberId: lease.external_number_id!, phoneNumber: lease.phone_number, sender: 'ONCE Mock', title: '演示登录验证码',
      content: '你的演示验证码是 739204，当前使用本地模拟短信服务。', code: '739204', occurredAt: new Date().toISOString() });
    await this.inbox.routeEvent(saved.eventId);
    return this.importedMessage(userId, leaseId, messageId);
  }

  private async currentDemoLease(userId: string, leaseId: string) {
    return this.db.transaction(async client => {
      const lease = await ownedMessageLease(client, this.environment, userId, leaseId);
      await client.query('SELECT id FROM upstream_accounts WHERE id=$1 FOR SHARE', [lease.upstream_account_id]);
      await client.query('SELECT id FROM phone_numbers WHERE id=$1 FOR SHARE', [lease.number_id]);
      const current = await ownedMessageLease(client, this.environment, userId, leaseId);
      await activeMessageAllocation(client, current);
      return current;
    });
  }

  async demoReceive(userId: string, leaseId: string, peer: string, key: unknown) {
    requireMessageSandbox(this.environment);
    const sender = smsPhone(peer), idempotencyKey = smsKey(key);
    const lease = await ownedMessageLease(this.db, this.environment, userId, leaseId);
    const identity = createHash('sha256').update(JSON.stringify(['demo-receive',userId,leaseId,idempotencyKey])).digest('hex');
    const messageId = `IN-${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20,32)}`;
    const previous = await this.db.query('SELECT 1 FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2', ['pingcode-mock', messageId]);
    if (!previous.rowCount) await this.currentDemoLease(userId, leaseId);
    const saved = await this.inbox.recordDemoInbound({ scopeKind: 'ACCOUNT' }, { eventId: `demo-${identity}`, messageId,
      numberId: lease.external_number_id!, phoneNumber: lease.phone_number, sender, title: '演示来信',
      content: '你好，这是一条模拟来信。你可以直接回复，也可以切换会话查看未读提醒。' });
    await this.inbox.routeEvent(saved.eventId);
    return { ok: true };
  }

  private async importedMessage(userId: string, leaseId: string, externalId: string) {
    const { rows: [row] } = await this.db.query<OnceMessageRow>(`SELECT ${columns} FROM sms_messages m
      JOIN number_allocations a ON a.id=m.allocation_id JOIN provider_message_receipts r ON r.message_id=m.id
      WHERE a.lease_id=$1 AND m.user_id=$2 AND r.provider='pingcode-mock' AND r.external_message_id=$3`, [leaseId, userId, externalId]);
    if (!row) throw new ApiFailure(409, 'MESSAGE_NOT_IMPORTED', 'The message remains in the inbox for ownership reconciliation');
    return row;
  }

  async demoEvent(userId: string, input: unknown) {
    requireMessageSandbox(this.environment);
    const body = parseInput(demoEventSchema, input), lease = await ownedMessageLease(this.db, this.environment, userId, body.leaseId);
    const historical = await this.db.query(`SELECT id FROM number_allocations WHERE lease_id=$1 AND user_id=$2
      AND assigned_at<=$3::timestamptz AND $3::timestamptz<LEAST(expires_at,COALESCE(released_at,expires_at))`, [body.leaseId, userId, body.receivedAt]);
    if (historical.rowCount !== 1 || !lease.external_number_id || !lease.send_connection) {
      throw new ApiFailure(409, 'EVENT_OUTSIDE_LEASE_WINDOW', 'The message must belong to one original service period');
    }
    const saved = await this.inbox.recordVerified({ scopeKind: 'ACCOUNT' }, { eventId: `demo-${userId}-${body.eventId}`,
      messageId: body.providerMessageId, numberId: lease.external_number_id, phoneNumber: lease.phone_number,
      sender: body.sender, title: body.title, content: body.body, code: body.code, occurredAt: body.receivedAt });
    return this.event(userId, saved.eventId);
  }

  private eventView(row: InboxEventRow, detail = false) {
    const historicalOnly = row.historical_only || row.import_batch_id !== null;
    const retryable = !historicalOnly && row.provider === this.environment.pcProvider
      && row.normalized_payload !== null && ['PENDING','UNMATCHED','FAILED'].includes(row.status);
    return { id: row.id, eventId: row.event_id, eventType: row.event_kind === 'INBOUND' ? 'sms.received' : 'sms.send.status_changed',
      provider: row.provider, status: row.status, attempts: row.attempts, lastError: row.last_error, processedAt: row.processed_at,
      nextAttemptAt: row.next_attempt_at, conflictCount: row.conflict_count, numberId: row.number_id,
      outboundMessageId: row.outbound_id, providerMessageId: row.external_message_id ?? row.provider_message_id,
      occurredAt: row.normalized_payload?.occurredAt ?? null, receivedAt: row.received_at, upstreamAccountId: row.upstream_account_id,
      historicalOnly, retryable, retryExhausted: retryable && row.attempts >= 20,
      ...(detail ? { payload: row.payload, normalizedPayload: row.normalized_payload } : {}) };
  }

  async event(userId: string, id: string) {
    const { rows: [row] } = await this.db.query<InboxEventRow>(`SELECT e.*,u.historical_only,
      (SELECT count(*)::int FROM provider_event_conflicts c WHERE c.event_id=e.id) AS conflict_count
      FROM provider_event_receipts e JOIN upstream_accounts u ON u.id=e.upstream_account_id
      WHERE e.id=$1 AND u.storefront_id='once' AND u.owner_kind='SELF_SERVICE' AND (
        EXISTS(SELECT 1 FROM outbound_messages o WHERE o.id=e.outbound_id AND o.user_id=$2)
        OR (e.import_batch_id IS NOT NULL AND EXISTS(SELECT 1 FROM once_import_entities source_event
          JOIN once_import_entities source_lease ON source_lease.batch_id=source_event.batch_id
            AND source_lease.source_system=source_event.source_system AND source_lease.entity_type='Lease'
            AND source_lease.source_id::text=COALESCE(source_event.source_payload#>>'{source,leaseId}',
              source_event.source_payload#>>'{source,payload,leaseId}')
          JOIN leases original_lease ON original_lease.id=source_lease.target_id
          WHERE source_event.batch_id=e.import_batch_id AND source_event.entity_type='WebhookEvent' AND source_event.target_id=e.id
            AND original_lease.user_id=$2 AND (e.number_id IS NULL OR original_lease.number_id=e.number_id)))
        OR EXISTS(SELECT 1 FROM number_allocations a JOIN leases l ON l.id=a.lease_id
          JOIN provider_resource_bindings b ON b.number_id=a.number_id AND b.provider=e.provider
          WHERE l.user_id=$2 AND a.user_id=$2 AND b.external_number_id=e.normalized_payload->>'externalNumberId'
            AND a.assigned_at<=(e.normalized_payload->>'occurredAt')::timestamptz
            AND (e.normalized_payload->>'occurredAt')::timestamptz<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))))`, [id, userId]);
    if (!row) throw new ApiFailure(404, 'EVENT_NOT_FOUND', 'Event not found');
    return this.eventView(row, true);
  }

  async retry(userId: string, id: string) {
    requireMessageSandbox(this.environment);
    const event = await this.event(userId, id);
    if (!event.retryable) throw new ApiFailure(409, event.historicalOnly ? 'HISTORICAL_EVENT_READ_ONLY' : 'EVENT_NOT_RETRYABLE', 'This event is read-only');
    await this.inbox.routeEvent(id);
    return this.event(userId, id);
  }

  async adminEvents(input: unknown = {}) {
    const query = parseInput(adminQuerySchema, input);
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) throw new ApiFailure(400, 'INVALID_DATE_RANGE', 'Start must precede end');
    const kind = query.eventType === 'sms.received' ? 'INBOUND' : query.eventType === 'sms.send.status_changed' ? 'OUTBOUND' : query.eventType;
    const params = [query.search ? `%${query.search}%` : null, query.status || null, kind || null, query.from ?? null, query.to ?? null];
    const filter = `FROM provider_event_receipts e JOIN upstream_accounts a ON a.id=e.upstream_account_id
      JOIN storefronts f ON f.id=a.storefront_id WHERE a.storefront_id='once' AND f.product='NUMBER_LEASE'
      AND ($1::text IS NULL OR e.event_id ILIKE $1 OR e.external_message_id ILIKE $1 OR e.provider_message_id ILIKE $1)
      AND ($2::text IS NULL OR e.status=$2) AND ($3::text IS NULL OR e.event_kind=$3)
      AND ($4::timestamptz IS NULL OR e.received_at>=$4) AND ($5::timestamptz IS NULL OR e.received_at<=$5)`;
    const count = await this.db.query<{ total: number }>(`SELECT count(*)::int AS total ${filter}`, params);
    const totalItems = count.rows[0]!.total, totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize)), page = Math.min(query.page, totalPages);
    const { rows } = await this.db.query<InboxEventRow>(`SELECT e.*,a.historical_only,(SELECT count(*)::int FROM provider_event_conflicts c WHERE c.event_id=e.id) AS conflict_count
      ${filter} ORDER BY e.received_at DESC,e.id ASC LIMIT $6 OFFSET $7`, [...params, query.pageSize, (page - 1) * query.pageSize]);
    return { items: rows.map(row => this.eventView(row)), page, pageSize: query.pageSize, totalItems, totalPages };
  }

  async adminEventSummary() {
    const { rows } = await this.db.query<{ status: string; count: number; exhausted: number }>(`SELECT e.status,count(*)::int AS count,
      count(*) FILTER(WHERE NOT a.historical_only AND e.import_batch_id IS NULL AND e.provider=$1 AND e.normalized_payload IS NOT NULL
        AND e.attempts>=20 AND e.status IN ('PENDING','UNMATCHED','FAILED'))::int AS exhausted
      FROM provider_event_receipts e JOIN upstream_accounts a ON a.id=e.upstream_account_id
      JOIN storefronts f ON f.id=a.storefront_id WHERE a.storefront_id='once' AND f.product='NUMBER_LEASE' GROUP BY e.status`, [this.environment.pcProvider]);
    return { counts: Object.fromEntries(rows.map(row => [row.status,row.count])), retryExhausted: rows.reduce((sum,row) => sum + row.exhausted, 0) };
  }

  async adminEvent(id: string) {
    const { rows: [event] } = await this.db.query<InboxEventRow>(`SELECT e.*,a.historical_only,
      (SELECT count(*)::int FROM provider_event_conflicts c WHERE c.event_id=e.id) AS conflict_count
      FROM provider_event_receipts e JOIN upstream_accounts a ON a.id=e.upstream_account_id JOIN storefronts f ON f.id=a.storefront_id
      WHERE e.id=$1 AND a.storefront_id='once' AND f.product='NUMBER_LEASE'`, [id]);
    if (!event) throw new ApiFailure(404, 'EVENT_NOT_FOUND', 'Event not found');
    const [attempts, conflicts] = await Promise.all([
      this.db.query('SELECT * FROM provider_event_attempts WHERE event_id=$1 ORDER BY created_at,id', [id]),
      this.db.query('SELECT * FROM provider_event_conflicts WHERE event_id=$1 ORDER BY created_at,id', [id]),
    ]);
    return { event: this.eventView(event, true), attempts: attempts.rows, conflicts: conflicts.rows };
  }

  async adminRetry(actorId: string, id: string, reason: string) {
    const detail = await this.adminEvent(id);
    if (!detail.event.retryable) throw new ApiFailure(409, detail.event.historicalOnly ? 'HISTORICAL_EVENT_READ_ONLY' : 'EVENT_NOT_RETRYABLE', 'This event is read-only');
    await this.inbox.routeEvent(id, { actorId, reason });
    return this.adminEvent(id);
  }
}
