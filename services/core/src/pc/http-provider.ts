import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { PcCapability } from '@linepool/contracts';
import { Environment } from '../environment.js';
import { mapPingCodeInbound, normalizePhone, pingCodeNumberSchema, pingCodePageSchema, pingCodeSmsSchema } from '../providers/pingcode-adapter.js';
import type { AuthState, MockSnapshotProgress, MockTokens, PcResource } from './model.js';
import type { PcSmsResult } from './protocol.js';

const time = z.iso.datetime({ offset: true });
const tokensSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: time, refreshExpiresAt: time });
const identitySchema = tokensSchema.extend({ subject: z.string().min(1).max(200), username: z.string().min(1).max(500), applicationCode: z.string() });
const numbersPageSchema = z.object({ data: z.array(pingCodeNumberSchema), page: pingCodePageSchema });
export class PcHttpFailure extends Error {
  constructor(readonly outcome: 'REJECTED' | 'UNKNOWN', readonly reason: string, readonly status?: number) { super(reason); }
}
export class PcHttpSnapshotFailure extends PcHttpFailure {
  constructor(readonly snapshot: MockSnapshotProgress, failure: PcHttpFailure) { super(failure.outcome, failure.reason, failure.status); }
}

/** PinClode application credentials are server-only and never sent through a redirect. */
@Injectable()
export class PcHttpProvider {
  constructor(private readonly environment: Environment) {}
  get capabilities(): PcCapability[] {
    return this.environment.siteId === 'linepool' ? ['SMS_CODE'] : ['NUMBER_LEASE', ...this.environment.values.PC_NUMBER_CAPABILITIES];
  }
  private endpoint(path: string, query?: Record<string, string>) {
    if (this.environment.values.PC_MODE !== 'real' || !this.environment.values.PC_BASE_URL) throw new PcHttpFailure('REJECTED', 'PC_REAL_UNAVAILABLE');
    const url = new URL(`${this.environment.values.PC_BASE_URL.replace(/\/+$/, '')}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return url;
  }
  authorizeUrl(state: string, verifier: string) {
    return this.endpoint('/app-login', { client_id: this.environment.values.PC_APPLICATION_ID,
      redirect_uri: this.environment.values.PC_AUTH_CALLBACK_URL, state,
      code_challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'), code_challenge_method: 'S256' }).toString();
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new PcHttpFailure('UNKNOWN', 'PC_RESPONSE_INVALID');
    return result.data;
  }
  private async request(path: string, options: { token?: string; body?: unknown; query?: Record<string, string>; idempotencyKey?: string; accepted?: number[] } = {}) {
    const url = this.endpoint(path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
      const response = await fetch(url, { method: options.body === undefined ? 'GET' : 'POST', headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), redirect: 'error', signal: controller.signal });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new PcHttpFailure('UNKNOWN', 'PC_RESPONSE_TOO_LARGE', response.status); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new PcHttpFailure('UNKNOWN', 'PC_RESPONSE_INVALID', response.status); }
      if (!(options.accepted ?? [200]).includes(response.status)) {
        const error = z.object({ error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,119}$/) }) }).safeParse(body);
        throw new PcHttpFailure(response.status >= 400 && response.status < 500 ? 'REJECTED' : 'UNKNOWN',
          error.success ? error.data.error.code : 'PC_REQUEST_FAILED', response.status);
      }
      return body;
    } catch (failure) {
      if (failure instanceof PcHttpFailure) throw failure;
      throw new PcHttpFailure('UNKNOWN', 'PC_TRANSPORT_UNKNOWN');
    } finally { clearTimeout(timer); }
  }
  private credentials() { return { clientId: this.environment.values.PC_APPLICATION_ID, clientSecret: this.environment.values.PC_CLIENT_SECRET }; }
  private tokens(value: z.infer<typeof tokensSchema>): MockTokens {
    const accessExpiresAt = new Date(value.expiresAt), refreshExpiresAt = new Date(value.refreshExpiresAt);
    if (accessExpiresAt.getTime() <= Date.now() || refreshExpiresAt.getTime() <= Date.now()) throw new PcHttpFailure('REJECTED', 'PC_TOKEN_EXPIRED');
    return { accessToken: value.accessToken, refreshToken: value.refreshToken, accessExpiresAt, refreshExpiresAt };
  }
  async exchange(state: AuthState, code: string) {
    if (!state.code_verifier) throw new PcHttpFailure('REJECTED', 'PC_PKCE_MISSING');
    const identity = this.parse(identitySchema, await this.request('/api/public/v1/application-sso/exchange', {
      body: { ...this.credentials(), code, redirectUri: state.callback_url, codeVerifier: state.code_verifier } }));
    if (identity.applicationCode !== state.application_id || state.issuer !== this.environment.values.PC_ISSUER) throw new PcHttpFailure('REJECTED', 'PC_IDENTITY_MISMATCH');
    const status = this.parse(z.object({ active: z.boolean() }), await this.request('/api/public/v1/application-sso/status', {
      body: { ...this.credentials(), subject: identity.subject } }));
    if (!status.active) throw new PcHttpFailure('REJECTED', 'PC_APPLICATION_NOT_ENABLED');
    return { fixture: { subject: identity.subject, external_account_id: identity.subject, display_name: identity.username,
      owner_kind: state.purpose === 'SELF_SERVICE' ? 'SELF_SERVICE' as const : 'AGENT' as const, capabilities: this.capabilities }, tokens: this.tokens(identity) };
  }
  async refresh(refreshToken: string) {
    return this.tokens(this.parse(tokensSchema, await this.request('/api/public/v1/application-sso/refresh', {
      body: { ...this.credentials(), refreshToken } })));
  }
  async snapshot(accessToken: string, _externalAccountId: string, extendClaim: () => Promise<void>) {
    const progress: MockSnapshotProgress = { complete: false, pageSize: 100, successfulPages: 0, fetchedCount: 0, failedPage: null, pages: [] };
    const resources: PcResource[] = []; const cursors = new Set<string>(); let cursor: string | null = null;
    try {
      do {
        await extendClaim();
        const page: z.output<typeof numbersPageSchema> = this.parse(numbersPageSchema,
          await this.request('/api/app/v1/numbers', { token: accessToken, query: { limit: '100', ...(cursor ? { cursor } : {}) } }));
        for (const number of page.data) {
          const available = number.status === 'READY' || number.status === 'ACTIVE';
          if (!number.phoneNumber && available) throw new PcHttpFailure('UNKNOWN', 'PC_RESOURCE_PHONE_MISSING');
          resources.push({ external_number_id: String(number.id), phone_number: number.phoneNumber ? normalizePhone(number.phoneNumber) : null,
            region_id: this.environment.values.PC_NUMBER_REGION!, external_project_id: null, platform_id: null,
            capabilities: this.capabilities, source_available: available,
            resource_expires_at: number.expiresAt ? new Date(number.expiresAt) : null });
        }
        const next: string | null = page.page.hasMore ? page.page.nextCursor! : null;
        progress.pages.push({ cursor, nextCursor: next, fetchedCount: page.data.length, status: 'SUCCEEDED' });
        progress.successfulPages++; progress.fetchedCount += page.data.length;
        if (next && cursors.has(next)) throw new PcHttpFailure('UNKNOWN', 'PC_CURSOR_REPEATED');
        if (next) cursors.add(next);
        cursor = next;
      } while (cursor !== null);
      progress.complete = true;
      return { resources, progress };
    } catch (failure) {
      progress.failedPage = progress.successfulPages + 1;
      progress.pages.push({ cursor, nextCursor: null, fetchedCount: 0, status: 'FAILED' });
      throw new PcHttpSnapshotFailure(progress, failure instanceof PcHttpFailure ? failure : new PcHttpFailure('UNKNOWN', 'PC_SNAPSHOT_FAILED'));
    }
  }
  async messages(accessToken: string, input: { cursor?: string; createdAfter?: string }) {
    const result = this.parse(z.object({ data: z.array(pingCodeSmsSchema), page: pingCodePageSchema }),
      await this.request('/api/app/v1/sms', { token: accessToken, query: { limit: '100', direction: 'INBOUND', ...input } }));
    return { messages: result.data.filter(sms => sms.direction === 'INBOUND').map(sms => mapPingCodeInbound(sms)), page: result.page };
  }
  private sms(value: unknown): PcSmsResult {
    const sms = this.parse(pingCodeSmsSchema, value);
    if (sms.direction !== 'OUTBOUND' || sms.status === 'RECEIVED' || !/^OUT-[0-9]+$/.test(sms.id) || !sms.phoneNumber) throw new PcHttpFailure('UNKNOWN', 'PC_OUTBOUND_IDENTITY_INVALID');
    return { providerMessageId: sms.id, status: sms.status, occurredAt: new Date(sms.occurredAt), errorCode: sms.errorCode ?? null,
      externalNumberId: String(sms.numberId), senderNumber: normalizePhone(sms.phoneNumber), recipient: normalizePhone(sms.counterparty), content: sms.content };
  }
  async send(accessToken: string, request: { phoneNumber: string; to: string; content: string }, idempotencyKey: string): Promise<PcSmsResult> {
    if (!idempotencyKey || idempotencyKey.length > 120 || /[\r\n]/.test(idempotencyKey)) throw new PcHttpFailure('REJECTED', 'PC_IDEMPOTENCY_KEY_INVALID');
    const result = this.sms(await this.request('/api/app/v1/sms/send', { token: accessToken, body: request, idempotencyKey, accepted: [202] }));
    if (result.senderNumber !== normalizePhone(request.phoneNumber)
      || result.recipient !== normalizePhone(request.to) || result.content !== request.content) throw new PcHttpFailure('UNKNOWN', 'PC_OUTBOUND_IDENTITY_INVALID');
    return result;
  }
  async lookup(accessToken: string, providerMessageId: string): Promise<PcSmsResult> {
    if (!/^OUT-[0-9]+$/.test(providerMessageId)) throw new PcHttpFailure('REJECTED', 'PC_OUTBOUND_ID_INVALID');
    const result = this.sms(await this.request(`/api/app/v1/sms/outbound/${encodeURIComponent(providerMessageId)}`, { token: accessToken }));
    if (result.providerMessageId !== providerMessageId) throw new PcHttpFailure('UNKNOWN', 'PC_OUTBOUND_IDENTITY_INVALID');
    return result;
  }
}
