import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { normalizePhone, type ProviderInbound, type ProviderNumber } from './pingcode-adapter.js';
import { ReceivingProvider } from './receiving-provider.js';
import { WebhookInbox, type TrustedInboxContext } from './webhook-inbox.js';

const provider = 'pingcode-mock';
const messageSchema = z.object({
  externalMessageId: z.string().regex(/^IN-[0-9a-f-]{36}$/i), externalNumberId: z.string().min(1).max(200),
  phoneNumber: z.string().nullable(), sender: z.string(), body: z.string(), receivedAt: z.iso.datetime(),
  upstreamCreatedAt: z.iso.datetime().nullable(),
});
/** Explicit trusted Mock routing context. The supplied PingCode document has no platform field. */
export type MockInboundRoute = { numberId: string; allocationId: string; service: string };

@Injectable()
export class ReceivingSync {
  constructor(private readonly db: Database, private readonly receiving: ReceivingProvider,
    private readonly environment: Environment, private readonly inbox: WebhookInbox) {}
  async pullMock(route: MockInboundRoute) {
    if (!this.environment.isWorker) throw new ApiFailure(409, 'WORKER_REQUIRED', 'Message pulls run in the worker');
    this.requireMock();
    const binding = await this.routeResource(route);
    let cursor: string | undefined;
    const seen = new Set<string>();
    const result = { imported: 0, duplicates: 0 };
    for (let page = 0; page < 100; page++) {
      const batch = await this.receiving.reader.messages({ phoneNumber: binding.phone_number, cursor });
      for (const message of batch.data) {
        const previous = await this.db.query('SELECT message_id FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2 AND message_id IS NOT NULL',
          [provider, message.externalMessageId]);
        const saved = await this.inbox.ingestConnectionInbound(binding.upstream_account_id, route.numberId, message);
        if (saved.status === 'IMPORTED') { if (previous.rowCount) result.duplicates++; else result.imported++; }
      }
      if (!batch.page.hasMore) return result;
      cursor = batch.page.nextCursor!;
      if (seen.has(cursor)) throw new ApiFailure(502, 'PROVIDER_CURSOR_REPEATED', 'Provider returned a repeated cursor');
      seen.add(cursor);
    }
    throw new ApiFailure(502, 'PROVIDER_PAGE_LIMIT', 'Mock sync exceeded the page limit');
  }
  ingestTrusted(context: TrustedInboxContext, message: ProviderInbound, eventId?: string) {
    return this.inbox.ingestTrusted(context, message, eventId);
  }
  ingestConnectionInbound(upstreamAccountId: string, numberId: string, message: ProviderInbound) {
    return this.inbox.ingestConnectionInbound(upstreamAccountId, numberId, message);
  }
  // Internal Mock helpers retain explicit number/allocation/platform routing.
  async bindMockNumber(numberId: string, resource: ProviderNumber) {
    this.requireMock();
    if (!resource.phoneNumber) throw new ApiFailure(409, 'PROVIDER_NUMBER_WITHOUT_PHONE', 'Number is not ready for binding');
    return this.db.transaction(async client => {
      const { rows: [number] } = await client.query<{ phone_number: string; upstream_account_id: string }>(
        `SELECT n.phone_number,n.upstream_account_id FROM phone_numbers n
         JOIN upstream_accounts u ON u.id=n.upstream_account_id JOIN storefronts f ON f.id=u.storefront_id
         WHERE n.id=$1 AND u.provider=$2 AND u.external_account_id=$3 AND u.status='ACTIVE'
           AND u.owner_kind='SELF_SERVICE' AND u.storefront_id='linepool' AND f.product='SMS_CODE' FOR UPDATE OF n`,
        [numberId, provider, this.environment.selfServiceExternalAccountId]);
      if (!number || normalizePhone(number.phone_number) !== normalizePhone(resource.phoneNumber!)) {
        throw new ApiFailure(409, 'PROVIDER_NUMBER_MISMATCH', 'Explicit number mapping is required');
      }
      const { rows: slots } = await client.query<{ platform_id: string; external_project_id: string }>(
        `SELECT s.platform_id,s.external_project_id FROM number_platforms s
         JOIN provider_projects p ON p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id
         WHERE s.number_id=$1 AND s.provider=$2 AND p.upstream_account_id=$3 AND p.is_active FOR UPDATE OF s`,
        [numberId, provider, number.upstream_account_id]);
      const slot = slots.length === 1 ? slots[0] : undefined;
      if (!slot) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Number requires one unambiguous active project in its trusted Mock account');
      await client.query(`INSERT INTO provider_resource_bindings(provider,external_project_id,external_number_id,number_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(provider,external_number_id) DO NOTHING`, [provider, slot.external_project_id, resource.externalNumberId, numberId]);
      const { rows: [binding] } = await client.query<{ number_id: string }>(
        `SELECT b.number_id FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id
         WHERE b.provider=$1 AND b.external_number_id=$2 AND b.external_project_id=$3 AND n.upstream_account_id=$4`,
        [provider, resource.externalNumberId, slot.external_project_id, number.upstream_account_id]);
      if (binding?.number_id !== numberId) throw new ApiFailure(409, 'PROVIDER_NUMBER_MISMATCH', 'External number is already bound in another account');
    });
  }
  async receiveMock(route: MockInboundRoute, input: ProviderInbound, event?: { eventId: string; test: boolean }) {
    this.requireMock();
    const message = messageSchema.parse(input);
    const resource = await this.routeResource(route, message.externalNumberId);
    if (message.phoneNumber !== null && normalizePhone(message.phoneNumber) !== normalizePhone(resource.phone_number)) {
      throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Message number does not match its trusted Mock binding');
    }
    const received = Date.parse(message.receivedAt);
    if (received < resource.assigned_at.getTime() || received >= resource.service_end.getTime() || received > Date.now()) {
      throw new ApiFailure(409, 'PROVIDER_ALLOCATION_INACTIVE', 'Message is outside its historical service period');
    }
    if (event?.test) return { status: 'TEST_IGNORED' as const, messageId: null };
    const { rows: [previous] } = await this.db.query<{ message_id: string | null }>(
      'SELECT message_id FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2',
      [provider, message.externalMessageId]);
    const saved = await this.inbox.recordVerified({ scopeKind: 'PROJECT', externalProjectId: resource.external_project_id }, {
      eventId: event?.eventId ?? `pull-${randomUUID()}`, messageId: message.externalMessageId,
      numberId: message.externalNumberId, phoneNumber: normalizePhone(resource.phone_number),
      sender: message.sender, content: message.body, occurredAt: message.receivedAt, rawPayload: input,
    });
    const result = await this.inbox.routeEvent(saved.eventId);
    const { rows: [receipt] } = await this.db.query<{ message_id: string | null }>(
      'SELECT message_id FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2',
      [provider, message.externalMessageId]);
    return { status: result.status === 'IMPORTED' && previous?.message_id ? 'DUPLICATE' : result.status,
      messageId: receipt?.message_id ?? null };
  }

  private requireMock() {
    if (this.environment.pcProvider !== 'pingcode-mock') throw new ApiFailure(409, 'PC_MOCK_UNAVAILABLE', 'Mock receiving is disabled in real provider mode');
  }
  private async routeResource(route: MockInboundRoute, externalNumberId?: string) {
    const { rows } = await this.db.query<{ phone_number: string; external_project_id: string; upstream_account_id: string;
      assigned_at: Date; service_end: Date }>(`SELECT n.phone_number,b.external_project_id,n.upstream_account_id,a.assigned_at,
        LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at)) AS service_end
      FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id
      JOIN upstream_accounts u ON u.id=n.upstream_account_id JOIN storefronts f ON f.id=u.storefront_id
      JOIN provider_projects p ON p.provider=b.provider AND p.external_project_id=b.external_project_id
        AND p.upstream_account_id=u.id AND p.platform_id=$3 AND p.is_active
      JOIN number_platforms s ON s.number_id=n.id AND s.provider=p.provider
        AND s.external_project_id=p.external_project_id AND s.platform_id=p.platform_id
      JOIN number_allocations a ON a.number_id=n.id AND a.id=$4 AND a.platform_id=p.platform_id AND a.allocation_type='PLATFORM'
      WHERE b.provider=$1 AND n.id=$2 AND u.provider=$1 AND u.external_account_id=$5 AND u.status='ACTIVE'
        AND u.owner_kind='SELF_SERVICE' AND u.storefront_id='linepool' AND f.product='SMS_CODE' AND ($6::text IS NULL OR b.external_number_id=$6)`,
    [provider, route.numberId, route.service, route.allocationId, this.environment.selfServiceExternalAccountId, externalNumberId ?? null]);
    if (rows.length !== 1) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Number, allocation and project must match the trusted Mock account');
    return rows[0]!;
  }
}
