import { createHash } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { safeErrorDetails } from '../error-summary.js';
import { outboundTransition, type OutboundRow } from '../once/message-state.js';
import { normalizePhone, type ProviderInbound } from './pingcode-adapter.js';
import { requireMessageSandbox } from '../once/message-access.js';
import { LinePoolReceiving } from '../linepool-receiving.js';
import { ShopDelivery, deliverSafely } from '../pc/shop-delivery.js';

const id = z.string().trim().min(1).max(200);
const phone = z.string().regex(/^\+[1-9][0-9]{1,14}$/);
const inbound = z.object({ eventId: id, messageId: id, numberId: id, phoneNumber: phone,
  sender: z.string().max(500), content: z.string().max(16000), title: z.string().max(200).default(''),
  code: z.string().max(64).nullable().optional(), occurredAt: z.iso.datetime({ offset: true }), rawPayload: z.unknown().optional() });
const outbound = z.object({ eventId: id, providerMessageId: id, numberId: id, phoneNumber: phone,
  recipient: phone, status: z.enum(['QUEUED', 'SENDING', 'SENT', 'UNCERTAIN', 'DELIVERED', 'UNDELIVERABLE', 'FAILED']),
  errorCode: z.string().max(200).nullable().default(null), occurredAt: z.iso.datetime({ offset: true }), rawPayload: z.unknown().optional() });
export type VerifiedPcInbound = z.input<typeof inbound>;
export type VerifiedPcOutbound = z.input<typeof outbound> & { provider?: 'pingcode-mock' | 'pingcode'; connectionId?: string };
export type MockInboxContext = { scopeKind: 'PROJECT'; externalProjectId: string } | { scopeKind: 'ACCOUNT' };
export type TrustedInboxContext = { connectionId: string; upstreamAccountId: string; numberId: string;
  ownerAgentId?: string; externalProjectId?: string };
type InboundPayload = { kind: 'INBOUND'; provider: string; upstreamAccountId: string; externalProjectId: string | null;
  externalMessageId: string; externalNumberId: string; phoneNumber: string; sender: string; title: string; content: string; code: string | null;
  occurredAt: string; connectionId?: string; ownerAgentId?: string };
type UnmappedInboundPayload = Omit<InboundPayload, 'phoneNumber' | 'connectionId' | 'ownerAgentId'> & {
  phoneNumber: string | null; sourceConnectionId: string; upstreamCreatedAt: string | null;
  quarantineReason: 'PC_MESSAGE_RESOURCE_UNCONFIRMED' };
type OutboundPayload = { kind: 'OUTBOUND'; provider: string; upstreamAccountId: string; externalNumberId: string;
  phoneNumber: string; providerMessageId: string; recipient: string; status: z.infer<typeof outbound>['status']; errorCode: string | null; occurredAt: string };
type EventRow = { id: string; event_id: string; provider: string; event_kind: 'INBOUND' | 'OUTBOUND';
  external_message_id: string | null; provider_message_id: string | null; upstream_account_id: string | null;
  number_id: string | null; outbound_id: string | null; status: string; attempts: number;
  normalized_payload: InboundPayload | UnmappedInboundPayload | OutboundPayload | null; payload: unknown; import_batch_id: string | null };
type Connection = { id: string; provider: string; owner_kind: 'SELF_SERVICE' | 'AGENT'; agent_id: string | null };

/** Canonical observations derive source and ownership from the trusted connection. Real ingress is pull-only. */
@Injectable()
export class WebhookInbox implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly db: Database, private readonly environment: Environment,
    private readonly receiving: LinePoolReceiving, private readonly delivery: ShopDelivery) {}
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  private async configuredAccount(client: PoolClient, context: MockInboxContext, provider = 'pingcode-mock') {
    if (provider !== this.environment.pcProvider) throw new ApiFailure(409, 'PROVIDER_MODE_MISMATCH', 'Message source does not match the configured provider');
    if ((context.scopeKind === 'ACCOUNT') !== (this.environment.siteId === 'once')) {
      throw new ApiFailure(404, 'WEBHOOK_ACCOUNT_NOT_CONFIGURED', 'The configured message scope is unavailable');
    }
    const { rows: [account] } = await client.query<Connection>(`SELECT a.id,a.provider,a.owner_kind,a.agent_id FROM upstream_accounts a
      JOIN storefronts f ON f.id=a.storefront_id WHERE a.provider=$5 AND a.external_account_id=$1
      AND a.status='ACTIVE' AND NOT a.historical_only AND a.owner_kind='SELF_SERVICE' AND a.storefront_id=$2 AND f.product=$3
      AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM provider_projects p WHERE p.provider=a.provider
        AND p.external_project_id=$4 AND p.upstream_account_id=a.id AND p.is_active))`,
    [this.environment.selfServiceExternalAccountId, this.environment.siteId, this.environment.product,
      context.scopeKind === 'PROJECT' ? context.externalProjectId : null, provider]);
    if (!account) throw new ApiFailure(503, 'WEBHOOK_ACCOUNT_NOT_CONFIGURED', 'The trusted provider connection is unavailable');
    return account;
  }

  private normalize(accountId: string, projectId: string | null, item: z.output<typeof inbound>, provider = 'pingcode-mock'): InboundPayload {
    return { kind: 'INBOUND', provider, upstreamAccountId: accountId, externalProjectId: projectId,
      externalMessageId: item.messageId, externalNumberId: item.numberId, phoneNumber: normalizePhone(item.phoneNumber),
      sender: item.sender, title: item.title, content: item.content,
      code: item.code ?? item.content.match(/(?<![0-9])[0-9]{4,8}(?![0-9])/)?.[0] ?? null,
      occurredAt: new Date(item.occurredAt).toISOString() };
  }

  private time(occurredAt: string) {
    if (!Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) > Date.now()) {
      throw new ApiFailure(400, 'WEBHOOK_TIME_INVALID', 'Message occurrence time cannot be in the future');
    }
  }

  private result(saved: { id: string; status: string; conflict: string | null }, messageId?: string) {
    if (saved.conflict) throw new ApiFailure(409, saved.conflict, 'Provider identity was reused with conflicting content; evidence is quarantined');
    return { received: true as const, eventId: saved.id, messageId, status: saved.status };
  }

  async recordVerified(context: MockInboxContext, input: VerifiedPcInbound) {
    const item = inbound.parse(input); this.time(item.occurredAt);
    const saved = await this.db.transaction(async client => {
      const account = await this.configuredAccount(client, context);
      const normalized = this.normalize(account.id, context.scopeKind === 'PROJECT' ? context.externalProjectId : null, item);
      return this.record(client, item.eventId, normalized, item.rawPayload ?? item);
    });
    return this.result(saved, item.messageId);
  }

  async recordDemoInbound(context: MockInboxContext, input: Omit<VerifiedPcInbound, 'occurredAt'>) {
    requireMessageSandbox(this.environment);
    const saved = await this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`mock-demo:${input.eventId}`]);
      const { rows: [previous] } = await client.query<{ occurred_at: string | null }>(`SELECT normalized_payload->>'occurredAt' AS occurred_at
        FROM provider_event_receipts WHERE provider='pingcode-mock' AND event_id=$1`, [input.eventId]);
      const item = inbound.parse({ ...input, occurredAt: previous?.occurred_at ?? new Date().toISOString() });
      const account = await this.configuredAccount(client, context);
      return this.record(client, item.eventId,
        this.normalize(account.id, context.scopeKind === 'PROJECT' ? context.externalProjectId : null, item), item);
    });
    return this.result(saved, input.messageId);
  }

  /** Worker ingress: the connection owns the number; a caller cannot choose another agent's ownership. */
  async ingestConnectionInbound(upstreamAccountId: string, numberId: string, message: ProviderInbound) {
    return this.ingestTrusted({ connectionId: upstreamAccountId, upstreamAccountId, numberId }, message);
  }

  /** Delivered source history can outlive the current number list; preserve it without claiming a local number or owner. */
  async quarantineUnmappedInbound(connectionId: string, message: ProviderInbound) {
    const source = z.object({ externalMessageId: z.string().regex(/^IN-[0-9a-f-]{36}$/i),
      externalNumberId: z.string().regex(/^[0-9]+$/), phoneNumber: z.string().nullable(), sender: z.string(), body: z.string(),
      receivedAt: z.iso.datetime({ offset: true }), upstreamCreatedAt: z.iso.datetime({ offset: true }).nullable() }).parse(message);
    this.time(source.receivedAt);
    const saved = await this.db.transaction(async client => {
      const trusted = await client.query(`SELECT a.id FROM upstream_accounts a JOIN storefronts f ON f.id=a.storefront_id
        WHERE a.id=$1 AND a.provider='pingcode' AND a.provider=$2 AND a.storefront_id=$3 AND f.product=$4
          AND a.application_id=$5 AND a.issuer=$6 AND a.status='ACTIVE' AND a.auth_status='ACTIVE' AND NOT a.historical_only FOR SHARE OF a`,
      [connectionId, this.environment.pcProvider, this.environment.siteId, this.environment.product,
        this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]);
      if (!trusted.rowCount) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'The original real source connection is unavailable');
      const mapped = await client.query(`SELECT n.id FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id
        WHERE b.provider='pingcode' AND b.external_number_id=$1 AND n.upstream_account_id=$2`, [source.externalNumberId, connectionId]);
      if (mapped.rowCount) throw new ApiFailure(409, 'PROVIDER_ROUTE_CHANGED', 'The source now has a confirmed number binding and must use normal routing');
      const normalized: UnmappedInboundPayload = { kind: 'INBOUND', provider: 'pingcode', upstreamAccountId: connectionId,
        sourceConnectionId: connectionId, externalProjectId: null, externalMessageId: `${connectionId}:${source.externalMessageId}`,
        externalNumberId: source.externalNumberId, phoneNumber: source.phoneNumber, sender: source.sender, title: '', content: source.body,
        code: source.body.match(/(?<![0-9])[0-9]{4,8}(?![0-9])/)?.[0] ?? null, occurredAt: source.receivedAt,
        upstreamCreatedAt: source.upstreamCreatedAt, quarantineReason: 'PC_MESSAGE_RESOURCE_UNCONFIRMED' };
      const eventId = `pull-${createHash('sha256').update(`${connectionId}:${source.externalMessageId}`).digest('hex')}`;
      const recorded = await this.record(client, eventId, normalized, message);
      if (recorded.conflict) return recorded;
      const { rows: [event] } = await client.query<EventRow>('SELECT * FROM provider_event_receipts WHERE id=$1 FOR UPDATE', [recorded.id]);
      if (!event) throw new Error('EVENT_NOT_SAVED');
      if (event.status !== 'QUARANTINED') await this.transition(client, event, 'QUARANTINED', normalized.quarantineReason);
      return { ...recorded, status: 'QUARANTINED' };
    });
    return this.result(saved, source.externalMessageId);
  }

  async ingestTrusted(context: TrustedInboxContext, message: ProviderInbound, eventId?: string) {
    const saved = await this.db.transaction(async client => {
      const { rows: resources } = await client.query<Connection & { phone_number: string; external_project_id: string | null; external_number_id: string }>(
        `SELECT a.id,a.provider,a.owner_kind,a.agent_id,n.phone_number,b.external_project_id,b.external_number_id
         FROM upstream_accounts a JOIN storefronts f ON f.id=a.storefront_id
         JOIN phone_numbers n ON n.upstream_account_id=a.id JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=a.provider
         WHERE a.id=$1 AND a.provider=$6 AND a.status='ACTIVE' AND NOT a.historical_only AND a.storefront_id=$2 AND f.product=$3
           AND n.id=$4 AND b.external_number_id=$5
           AND (a.provider='pingcode-mock' OR (a.application_id=$7 AND a.issuer=$8 AND a.auth_status='ACTIVE')) FOR SHARE OF a,n,b`,
      [context.upstreamAccountId, this.environment.siteId, this.environment.product, context.numberId, message.externalNumberId,
        this.environment.pcProvider, this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]);
      const resource = resources.length === 1 ? resources[0] : undefined;
      if (!resource || context.connectionId !== context.upstreamAccountId
        || (context.ownerAgentId !== undefined && resource.agent_id !== context.ownerAgentId)
        || (resource.owner_kind === 'AGENT' && !resource.agent_id)
        || (context.externalProjectId !== undefined && resource.external_project_id !== context.externalProjectId)
        || (resource.provider === 'pingcode' && !/^IN-[0-9a-f-]{36}$/i.test(message.externalMessageId))
        || (message.phoneNumber !== null && normalizePhone(message.phoneNumber) !== normalizePhone(resource.phone_number))) {
        throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Message does not match its trusted connection and number');
      }
      if (resource.owner_kind === 'SELF_SERVICE') {
        const configured = await this.configuredAccount(client, resource.external_project_id === null
          ? { scopeKind: 'ACCOUNT' } : { scopeKind: 'PROJECT', externalProjectId: resource.external_project_id }, resource.provider);
        if (configured.id !== resource.id) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Self-service connection changed');
      }
      const messageId = resource.provider === 'pingcode' ? `${resource.id}:${message.externalMessageId}` : message.externalMessageId;
      const observedEventId = resource.provider === 'pingcode'
        ? `pull-${createHash('sha256').update(`${resource.id}:${eventId ?? message.externalMessageId}`).digest('hex')}`
        : eventId ?? `pull-${createHash('sha256').update(messageId).digest('hex')}`;
      const item = inbound.parse({ eventId: observedEventId, messageId,
        numberId: message.externalNumberId, phoneNumber: resource.phone_number, sender: message.sender,
        content: message.body, occurredAt: message.receivedAt, rawPayload: message });
      this.time(item.occurredAt);
      const normalized = this.normalize(resource.id, resource.external_project_id, item, resource.provider);
      if (resource.owner_kind === 'AGENT') {
        normalized.connectionId = resource.id;
        normalized.ownerAgentId = resource.agent_id!;
      }
      return this.record(client, item.eventId, normalized, message,
        resource.owner_kind === 'AGENT' ? { connectionId: resource.id, numberId: context.numberId, agentId: resource.agent_id! } : undefined);
    });
    const result = this.result(saved, message.externalMessageId);
    const routed = await this.routeEvent(result.eventId);
    return { ...result, status: routed.status };
  }

  async recordOutbound(input: VerifiedPcOutbound) {
    const item = outbound.parse(input); this.time(item.occurredAt);
    const saved = await this.db.transaction(async client => {
      const provider = input.provider ?? 'pingcode-mock';
      let account: Connection;
      if (provider === 'pingcode') {
        if (this.environment.pcProvider !== provider || !input.connectionId) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Real observations require the trusted connection');
        const { rows } = await client.query<Connection>(`SELECT a.id,a.provider,a.owner_kind,a.agent_id FROM upstream_accounts a
          JOIN phone_numbers n ON n.upstream_account_id=a.id JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=a.provider
          WHERE a.id=$1 AND a.provider=$2 AND a.storefront_id=$3 AND a.owner_kind='SELF_SERVICE' AND a.status='ACTIVE' AND NOT a.historical_only
            AND a.external_account_id=$4 AND a.application_id=$5 AND a.issuer=$6 AND b.external_number_id=$7 AND n.phone_number=$8 FOR SHARE OF a,n,b`,
        [input.connectionId, provider, this.environment.siteId, this.environment.selfServiceExternalAccountId,
          this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER, item.numberId, item.phoneNumber]);
        if (rows.length !== 1 || !/^OUT-[0-9]+$/.test(item.providerMessageId)) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Outbound observation does not match its trusted connection and number');
        account = rows[0]!;
      } else account = await this.configuredAccount(client, { scopeKind: 'ACCOUNT' });
      const normalized: OutboundPayload = { kind: 'OUTBOUND', provider, upstreamAccountId: account.id,
        externalNumberId: item.numberId, phoneNumber: item.phoneNumber, providerMessageId: item.providerMessageId,
        recipient: item.recipient, status: item.status, errorCode: item.errorCode, occurredAt: new Date(item.occurredAt).toISOString() };
      const eventId = provider === 'pingcode' ? `out-${createHash('sha256').update(`${account.id}:${item.eventId}`).digest('hex')}` : item.eventId;
      return this.record(client, eventId, normalized, item.rawPayload ?? item);
    });
    return this.result(saved);
  }

  private async record(client: PoolClient, eventId: string, normalized: InboundPayload | UnmappedInboundPayload | OutboundPayload, payload: unknown,
    agent?: { connectionId: string; numberId: string; agentId: string }) {
    if (this.environment.siteId === 'linepool') await this.receiving.lockSource(client, normalized.upstreamAccountId);
    await client.query(`INSERT INTO provider_event_receipts(provider,event_id,event_kind,external_message_id,
      provider_message_id,upstream_account_id,payload,normalized_payload,status)
      VALUES($7,$1,$2,NULL,$3,$4,$5::jsonb,$6::jsonb,'PENDING') ON CONFLICT(provider,event_id) DO NOTHING`,
    [eventId, normalized.kind, normalized.kind === 'OUTBOUND' ? normalized.providerMessageId : null,
      normalized.upstreamAccountId, JSON.stringify(payload), JSON.stringify(normalized), normalized.provider]);
    const { rows: [event] } = await client.query<EventRow & { same: boolean }>(`SELECT *,normalized_payload=$2::jsonb AS same
      FROM provider_event_receipts WHERE provider=$3 AND event_id=$1 FOR UPDATE`, [eventId, JSON.stringify(normalized), normalized.provider]);
    if (!event) throw new Error('EVENT_NOT_SAVED');
    if (!event.import_batch_id) await client.query('UPDATE provider_event_receipts SET delivery_count=delivery_count+1,updated_at=now() WHERE id=$1', [event.id]);
    if (!event.same || event.upstream_account_id !== normalized.upstreamAccountId || event.event_kind !== normalized.kind) {
      await this.conflict(client, event.id, payload, normalized, 'PROVIDER_EVENT_CONFLICT');
      return { id: event.id, status: event.status, conflict: 'PROVIDER_EVENT_CONFLICT' };
    }
    if (event.import_batch_id) return { id: event.id, status: event.status, conflict: null };
    if (normalized.kind === 'INBOUND') {
      await client.query(`INSERT INTO provider_message_receipts(provider,external_message_id,external_project_id,
        external_number_id,raw_payload,normalized_payload,upstream_account_id,ingested_at,
        connection_id,owner_agent_id,number_id,processing_status)
        VALUES($11,$1,$2,$3,$4::jsonb,$5::jsonb,$6,now(),$7,$8,$9,$10)
        ON CONFLICT(provider,external_message_id) DO NOTHING`,
      [normalized.externalMessageId, normalized.externalProjectId, normalized.externalNumberId, JSON.stringify(payload),
        JSON.stringify(normalized), normalized.upstreamAccountId, agent?.connectionId ?? null, agent?.agentId ?? null,
        agent?.numberId ?? null, agent ? 'CONNECTION_IMPORTED' : 'PENDING', normalized.provider]);
      const { rows: [receipt] } = await client.query<{ same: boolean; upstream_account_id: string; processing_status: string;
        connection_id: string | null; owner_agent_id: string | null; number_id: string | null }>(`SELECT normalized_payload=$2::jsonb AS same,
        upstream_account_id,processing_status,connection_id,owner_agent_id,number_id FROM provider_message_receipts
        WHERE provider=$3 AND external_message_id=$1 FOR UPDATE`, [normalized.externalMessageId, JSON.stringify(normalized), normalized.provider]);
      if (!receipt?.same || receipt.upstream_account_id !== normalized.upstreamAccountId
        || receipt.connection_id !== (agent?.connectionId ?? null) || receipt.owner_agent_id !== (agent?.agentId ?? null)
        || receipt.number_id !== (agent?.numberId ?? null)) {
        await this.conflict(client, event.id, payload, normalized, 'PROVIDER_MESSAGE_CONFLICT');
        if (event.status !== 'IMPORTED') await this.transition(client, event, 'QUARANTINED', 'PROVIDER_MESSAGE_CONFLICT');
        return { id: event.id, status: 'QUARANTINED', conflict: 'PROVIDER_MESSAGE_CONFLICT' };
      }
      await client.query('UPDATE provider_event_receipts SET external_message_id=$2,updated_at=now() WHERE id=$1', [event.id, normalized.externalMessageId]);
    }
    return { id: event.id, status: event.status, conflict: null };
  }

  private async conflict(client: PoolClient, eventId: string, payload: unknown, normalized: unknown, reason: string) {
    await client.query(`INSERT INTO provider_event_conflicts(event_id,payload,normalized_payload,reason,status)
      VALUES($1,$2::jsonb,$3::jsonb,$4,'QUARANTINED')`, [eventId, JSON.stringify(payload), JSON.stringify(normalized), reason]);
  }

  private async transition(client: PoolClient, event: EventRow, status: string, reason: string | null, retry?: { actorId: string; reason: string }) {
    await client.query(`UPDATE provider_event_receipts SET status=$2,attempts=attempts+1,last_error=$3,
      next_attempt_at=CASE WHEN $2 IN ('UNMATCHED','FAILED') AND attempts<19 THEN now()+interval '30 seconds' ELSE NULL END,
      processed_at=CASE WHEN $2 IN ('IMPORTED','IGNORED') THEN now() ELSE processed_at END,updated_at=now() WHERE id=$1`, [event.id, status, reason]);
    if (event.event_kind === 'INBOUND' && ['FAILED','QUARANTINED'].includes(status)) {
      await client.query(`UPDATE provider_message_receipts SET processing_status=$3,last_error=$4,failure_reason=$4,
        attempts=attempts+1,next_attempt_at=CASE WHEN $3='FAILED' AND attempts<19 THEN now()+interval '30 seconds' ELSE NULL END,
        processed_at=now() WHERE provider=$1 AND external_message_id=$2 AND normalized_payload=$5::jsonb
        AND import_batch_id IS NULL AND processing_status IN ('PENDING','UNMATCHED','FAILED','QUARANTINED')`,
      [event.provider, event.external_message_id, status, reason, JSON.stringify(event.normalized_payload)]);
    }
    await client.query('INSERT INTO provider_event_attempts(event_id,from_status,to_status,reason) VALUES($1,$2,$3,$4)',
      [event.id, event.status, status, retry ? `ADMIN_RETRY: ${retry.reason}; ${reason ?? status}` : reason ?? status]);
    if (retry) await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
      VALUES($1,'WEBHOOK_RETRY',$2,$3,$4::jsonb,$5::jsonb)`, [retry.actorId, event.id, retry.reason,
      JSON.stringify({ status: event.status }), JSON.stringify({ status })]);
    return { status };
  }

  async route(messageId: string, retry?: { actorId: string; reason: string }) {
    const { rows } = await this.db.query<{ id: string }>(`SELECT id FROM provider_event_receipts
      WHERE provider=$2 AND import_batch_id IS NULL AND event_kind='INBOUND' AND external_message_id=$1 ORDER BY created_at,id`, [messageId, this.environment.pcProvider]);
    if (!rows.length) throw new ApiFailure(404, 'RECEIPT_NOT_FOUND', 'Receipt not found');
    let result = { status: 'PENDING' };
    for (const row of rows) result = await this.routeEvent(row.id, retry);
    return result;
  }

  async routeEvent(id: string, retry?: { actorId: string; reason: string }) {
    try {
      return await this.db.transaction(async client => {
        if (this.environment.siteId === 'linepool') await this.receiving.prepareEvent(client, id);
        if (retry) {
          if (!retry.reason.trim()) throw new ApiFailure(400, 'REASON_REQUIRED', 'A retry reason is required');
          const actor = await client.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' FOR SHARE", [retry.actorId]);
          if (!actor.rowCount) throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Administrator access is required');
        }
        const { rows: [event] } = await client.query<EventRow>('SELECT * FROM provider_event_receipts WHERE id=$1 FOR UPDATE', [id]);
        if (!event) throw new ApiFailure(404, 'EVENT_NOT_FOUND', 'Event not found');
        if (event.import_batch_id) {
          if (retry) throw new ApiFailure(409, 'HISTORICAL_EVENT_READ_ONLY', 'Imported event facts are read-only');
          return { status: event.status };
        }
        if (['IMPORTED', 'IGNORED', 'QUARANTINED'].includes(event.status)) {
          if (retry) return this.transition(client, event, event.status, 'TERMINAL_OR_QUARANTINED_EVENT_PRESERVED', retry);
          return { status: event.status };
        }
        const item = event.normalized_payload;
        if (!item || event.provider !== this.environment.pcProvider || item.provider !== event.provider || item.upstreamAccountId !== event.upstream_account_id || item.kind !== event.event_kind) {
          return this.transition(client, event, 'QUARANTINED', 'UNTRUSTED_OR_HISTORICAL_EVENT_REQUIRES_PREFLIGHT', retry);
        }
        const source = await client.query<Connection>(`SELECT a.id,a.provider,a.owner_kind,a.agent_id FROM upstream_accounts a JOIN storefronts f ON f.id=a.storefront_id
          WHERE a.id=$1 AND a.provider=$2 AND a.storefront_id=$3 AND f.product=$4 AND NOT a.historical_only`,
        [item.upstreamAccountId, item.provider, this.environment.siteId, this.environment.product]);
        if (!source.rows[0] || !Number.isFinite(Date.parse(item.occurredAt)) || Date.parse(item.occurredAt) > Date.now()) {
          return this.transition(client, event, 'QUARANTINED', 'SOURCE_OR_OCCURRENCE_CONFLICT', retry);
        }
        if ('quarantineReason' in item) return this.transition(client, event, 'QUARANTINED', item.quarantineReason, retry);
        return item.kind === 'INBOUND' ? this.routeInbound(client, event, item, source.rows[0], retry) : this.routeOutbound(client, event, item, retry);
      });
    } catch (error) {
      if (error instanceof ApiFailure && [400, 403, 404, 409].includes(error.getStatus())) throw error;
      console.error('Webhook event processing failed', { eventId: id, ...safeErrorDetails(error) });
      return this.db.transaction(async client => {
        const { rows: [event] } = await client.query<EventRow>('SELECT * FROM provider_event_receipts WHERE id=$1 FOR UPDATE', [id]);
        if (!event) throw error;
        if (event.import_batch_id || ['IMPORTED', 'IGNORED', 'QUARANTINED'].includes(event.status)) return { status: event.status };
        return this.transition(client, event, 'FAILED', 'EVENT_PROCESSING_FAILED', retry);
      });
    }
  }

  private async routeInbound(client: PoolClient, event: EventRow, item: InboundPayload, account: Connection, retry?: { actorId: string; reason: string }) {
    const { rows: [receipt] } = await client.query<{ processing_status: string; message_id: string | null; same: boolean;
      connection_id: string | null; owner_agent_id: string | null; number_id: string | null; import_batch_id: string | null }>(`SELECT *,normalized_payload=$2::jsonb AS same
      FROM provider_message_receipts WHERE provider=$3 AND external_message_id=$1 FOR UPDATE`, [item.externalMessageId, JSON.stringify(item), item.provider]);
    if (!receipt?.same) {
      await this.conflict(client, event.id, event.payload, item, 'RECEIPT_CONTENT_CONFLICT');
      return this.transition(client, event, 'QUARANTINED', 'RECEIPT_CONTENT_CONFLICT', retry);
    }
    if (receipt.import_batch_id) {
      if (retry) throw new ApiFailure(409, 'HISTORICAL_EVENT_READ_ONLY', 'Imported receipt facts are read-only');
      return this.transition(client, event, 'IGNORED', 'HISTORICAL_RECEIPT_PRESERVED');
    }
    if (account.owner_kind === 'AGENT') {
      const resource = await client.query(`SELECT n.id FROM phone_numbers n JOIN provider_resource_bindings b ON b.number_id=n.id
        WHERE n.id=$1 AND n.upstream_account_id=$2 AND n.phone_number=$3 AND b.provider=$4 AND b.external_number_id=$5`,
      [receipt.number_id, account.id, item.phoneNumber, item.provider, item.externalNumberId]);
      if (receipt.processing_status !== 'CONNECTION_IMPORTED' || receipt.connection_id !== account.id
        || item.connectionId !== account.id || item.ownerAgentId !== account.agent_id
        || receipt.owner_agent_id !== account.agent_id || !resource.rowCount) {
        return this.transition(client, event, 'QUARANTINED', 'CONNECTION_OWNERSHIP_CONFLICT', retry);
      }
      await client.query('UPDATE provider_event_receipts SET number_id=$2 WHERE id=$1', [event.id, receipt.number_id]);
      const imported = await this.transition(client, event, 'IMPORTED', 'CONNECTION_MESSAGE_IMPORTED', retry);
      if (this.environment.siteId === 'linepool' && this.environment.values.PC_MODE === 'real'
        && item.provider === this.environment.pcProvider) {
        await deliverSafely(client, this.delivery, {
          provider: item.provider, externalMessageId: item.externalMessageId, connectionId: account.id,
          numberId: receipt.number_id!, occurredAt: item.occurredAt, sender: item.sender, body: item.content,
        });
      }
      return imported;
    }
    if (receipt.connection_id !== null || receipt.owner_agent_id !== null || receipt.number_id !== null
      || item.connectionId !== undefined || item.ownerAgentId !== undefined) {
      return this.transition(client, event, 'QUARANTINED', 'MESSAGE_SCOPE_CONFLICT', retry);
    }
    if (receipt.processing_status === 'IMPORTED') return this.transition(client, event, 'IMPORTED', 'DUPLICATE_MESSAGE', retry);
    if (receipt.processing_status === 'QUARANTINED') return this.transition(client, event, 'QUARANTINED', 'RECEIPT_QUARANTINED', retry);
    const { rows } = await client.query<{ id: string; number_id: string; user_id: string; platform_id: string | null;
      receiving_mode: 'HOSTED' | 'ONE_TIME'; receiving_status: string | null; code_rule_snapshot: unknown }>(`SELECT a.id,a.number_id,a.user_id,a.platform_id,
      ${this.environment.siteId === 'linepool' ? 'a.receiving_mode,a.receiving_status,a.code_rule_snapshot'
        : "'HOSTED'::text AS receiving_mode,NULL::text AS receiving_status,NULL::jsonb AS code_rule_snapshot"}
      FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id JOIN upstream_accounts u ON u.id=n.upstream_account_id
      JOIN number_allocations a ON a.number_id=n.id
      WHERE b.provider=$1 AND b.external_number_id=$2 AND n.upstream_account_id=$3 AND n.phone_number=$4
        AND b.external_project_id IS NOT DISTINCT FROM $5::text AND u.provider=$1 AND u.owner_kind='SELF_SERVICE'
        AND u.external_account_id=$7 AND u.storefront_id=$8
        AND (($5::text IS NULL AND a.allocation_type='WHOLE_NUMBER' AND a.platform_id IS NULL AND a.lease_id IS NOT NULL)
          OR ($5::text IS NOT NULL AND a.allocation_type='PLATFORM' AND EXISTS(SELECT 1 FROM provider_projects p
            JOIN number_platforms s ON s.number_id=n.id AND s.platform_id=p.platform_id AND s.provider=p.provider AND s.external_project_id=p.external_project_id
            WHERE p.provider=b.provider AND p.external_project_id=$5 AND p.upstream_account_id=u.id AND a.platform_id=p.platform_id)))
        AND a.assigned_at<=$6::timestamptz AND $6::timestamptz<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))
        AND $6::timestamptz<=now() AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id
          AND ${this.environment.siteId === 'linepool'
            ? "(o.fulfillment_status='COMPLETED' OR (o.receiving_mode='ONE_TIME' AND a.receiving_status='WAITING'))"
            : "o.fulfillment_status='COMPLETED'"}))
      ORDER BY a.id FOR UPDATE OF a`, [item.provider, item.externalNumberId, item.upstreamAccountId, item.phoneNumber,
      item.externalProjectId, item.occurredAt, this.environment.selfServiceExternalAccountId, this.environment.siteId]);
    if (rows.length !== 1) {
      await client.query(`UPDATE provider_message_receipts SET processing_status='UNMATCHED',attempts=attempts+1,
        next_attempt_at=CASE WHEN attempts<19 THEN now()+interval '30 seconds' ELSE NULL END,last_error='NO_UNIQUE_HISTORICAL_SERVICE',
        failure_reason='No unique service at original occurrence time',processed_at=now() WHERE provider=$1 AND external_message_id=$2`, [item.provider, item.externalMessageId]);
      return this.transition(client, event, 'UNMATCHED', 'NO_UNIQUE_HISTORICAL_SERVICE', retry);
    }
    const service = rows[0]!;
    let verificationCode = item.code;
    if (service.receiving_mode === 'ONE_TIME') {
      verificationCode = this.receiving.code(service.code_rule_snapshot, item.sender, item.content);
      if (service.receiving_status !== 'WAITING' || !verificationCode) {
        const reason = service.receiving_status === 'SUCCESS' ? 'ONE_TIME_FIRST_MESSAGE_PRESERVED'
          : service.receiving_status === 'FAILED' && verificationCode ? 'ONE_TIME_REVIEW_CONTRADICTED' : 'ONE_TIME_NO_VALID_PLATFORM_CODE';
        await client.query(`UPDATE provider_message_receipts SET processing_status=$3,attempts=attempts+1,
          next_attempt_at=NULL,last_error=$4,failure_reason=$4,processed_at=now() WHERE provider=$1 AND external_message_id=$2`,
        [item.provider, item.externalMessageId, reason === 'ONE_TIME_REVIEW_CONTRADICTED' ? 'QUARANTINED' : 'UNMATCHED', reason]);
        return this.transition(client, event, reason === 'ONE_TIME_REVIEW_CONTRADICTED' ? 'QUARANTINED' : 'IGNORED', reason, retry);
      }
    }
    const { rows: [message] } = await client.query<{ id: string }>(`INSERT INTO sms_messages(user_id,number_id,allocation_id,platform_id,
      sender,title,body,received_at,ingested_at,verification_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) RETURNING id`,
    [service.user_id, service.number_id, service.id, service.platform_id, item.sender, item.title, item.content, item.occurredAt, verificationCode]);
    await client.query(`UPDATE provider_message_receipts SET message_id=$3,allocation_id=$4,processing_status='IMPORTED',
      attempts=attempts+1,next_attempt_at=NULL,last_error=NULL,failure_reason=NULL,processed_at=now()
      WHERE provider=$1 AND external_message_id=$2`, [item.provider, item.externalMessageId, message!.id, service.id]);
    await client.query('UPDATE provider_event_receipts SET number_id=$2 WHERE id=$1', [event.id, service.number_id]);
    if (service.receiving_mode === 'ONE_TIME') await this.receiving.succeed(client, service.id, message!.id);
    return this.transition(client, event, 'IMPORTED', 'MESSAGE_IMPORTED', retry);
  }

  private async routeOutbound(client: PoolClient, event: EventRow, item: OutboundPayload, retry?: { actorId: string; reason: string }) {
    const { rows: [row] } = await client.query<OutboundRow>(`SELECT * FROM outbound_messages WHERE provider=$1 AND provider_message_id=$2 FOR UPDATE`, [item.provider, item.providerMessageId]);
    if (!row) return this.transition(client, event, 'UNMATCHED', 'OUTBOUND_NOT_YET_MATCHED', retry);
    if (row.upstream_account_id !== item.upstreamAccountId || row.external_number_id !== item.externalNumberId
      || row.sender_number !== item.phoneNumber || row.recipient !== item.recipient) {
      await this.conflict(client, event.id, event.payload, item, 'OUTBOUND_IDENTITY_CONFLICT');
      return this.transition(client, event, 'QUARANTINED', 'OUTBOUND_IDENTITY_CONFLICT', retry);
    }
    await client.query('UPDATE provider_event_receipts SET outbound_id=$2,number_id=$3 WHERE id=$1', [event.id, row.id, row.number_id]);
    const decision = outboundTransition(row, item.status, new Date(item.occurredAt));
    if (decision === 'CONFLICT') {
      await this.conflict(client, event.id, event.payload, item, 'CONTRADICTORY_TERMINAL_STATUS');
      return this.transition(client, event, 'QUARANTINED', 'CONTRADICTORY_TERMINAL_STATUS', retry);
    }
    if (decision === 'APPLY') await client.query(`UPDATE outbound_messages SET status=$2,error_message=$3,last_event_at=$4,
      updated_at=now() WHERE id=$1`, [row.id, item.status, item.errorCode, item.occurredAt]);
    return this.transition(client, event, decision === 'IGNORE' ? 'IGNORED' : 'IMPORTED', decision === 'IGNORE' ? 'OLDER_OR_REDUNDANT_STATUS' : 'OUTBOUND_STATUS_APPLIED', retry);
  }

  async matchOutbound(providerMessageId: string, provider: string = this.environment.pcProvider) {
    const { rows } = await this.db.query<{ id: string }>(`SELECT id FROM provider_event_receipts WHERE provider=$2
      AND import_batch_id IS NULL AND event_kind='OUTBOUND' AND provider_message_id=$1 AND status IN ('PENDING','UNMATCHED','FAILED')
      ORDER BY (normalized_payload->>'occurredAt')::timestamptz,created_at,id LIMIT 100`, [providerMessageId, provider]);
    for (const row of rows) await this.routeEvent(row.id);
  }

  async retryPending(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Receipt retry limit must be 1..500');
    const { rows } = await this.db.query<{ id: string }>(`SELECT e.id FROM provider_event_receipts e
      JOIN upstream_accounts a ON a.id=e.upstream_account_id WHERE e.provider=$3 AND a.provider=e.provider AND a.storefront_id=$2 AND NOT a.historical_only
      AND e.import_batch_id IS NULL AND e.normalized_payload IS NOT NULL AND e.status IN ('PENDING','UNMATCHED','FAILED') AND e.attempts<20
      AND (e.next_attempt_at IS NULL OR e.next_attempt_at<=now()) ORDER BY e.created_at,e.id LIMIT $1`, [limit, this.environment.siteId, this.environment.pcProvider]);
    const outcomes = [];
    for (const row of rows) outcomes.push(await this.routeEvent(row.id));
    return outcomes;
  }

  onApplicationBootstrap() {
    if (!this.environment.isWorker || !this.environment.isModuleEnabled(this.environment.product)) return;
    const tick = () => {
      if (this.running) return;
      this.running = this.retryPending().catch(error => console.error('Webhook inbox recovery failed', safeErrorDetails(error)))
        .finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 30000); this.timer.unref(); tick();
  }
  async onModuleDestroy() { clearInterval(this.timer); await this.running; }
}
