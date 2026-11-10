import { Injectable } from '@nestjs/common';
import type { Lease, PhoneNumber } from '@prisma/client';
import { settings } from './config';

export type PcNumber = {id: number; phoneNumber?: string; status: string; expiresAt?: string};
export type PcAccount = {id: number; username: string; scopes: string[]; expiresAt?: string};
export const pcStatuses = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERABLE', 'FAILED', 'UNCERTAIN'] as const;
export type PcStatus = typeof pcStatuses[number];
export type PcMessage = {
  id: string; numberId: number; phoneNumber?: string; counterparty: string;
  content: string; status: PcStatus; errorCode?: string;
};
export const normalizePhone = (value: string) => value.replace(/[\s()_-]/g, '').replace(/^\+/, '');
export const pcConfigured = () => Boolean(settings.pingcode.baseUrl && settings.pingcode.accountId && settings.pingcode.apiKey);
export function smsCapability(lease: Lease & {phoneNumber: PhoneNumber}, now = new Date()) {
  const phone = lease.phoneNumber;
  const demo = phone.provider === 'demo';
  let reason: string | null = null;
  if (lease.status !== 'ACTIVE' || lease.startedAt > now || lease.expiresAt <= now || lease.endedAt || !phone.occupied || phone.holdReason)
    reason = '当前租约不可发送短信';
  else if (demo) reason = '演示号码不支持真实短信发送';
  else if (!phone.smsEnabled) reason = '号码未开启短信能力';
  else if (!demo && (phone.provider !== 'pingcode' || !pcConfigured() || phone.providerAccountId !== settings.pingcode.accountId))
    reason = '短信发送服务尚未配置';
  else if (!demo && (!phone.providerNumberId || phone.providerStatus !== 'ACTIVE' || !phone.resourceExpiresAt || phone.resourceExpiresAt <= now))
    reason = '上游号码当前不可发送短信';
  return { enabled: !reason, demo, reason };
}
export class PcError extends Error {
  constructor(public code: string, public definitive = false, public retryAfter = 0) { super(code); }
}

@Injectable()
export class PingcodeClient {
  private accountCheck?: {until: number; promise: Promise<PcAccount>};
  resetAccountCheck() { this.accountCheck = undefined; }
  private async call(path: string, options: RequestInit = {}) {
    if (!pcConfigured()) throw new PcError('PC_NOT_CONFIGURED');
    let response: Response;
    try {
      response = await fetch(settings.pingcode.baseUrl + path, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + settings.pingcode.apiKey, Accept: 'application/json', ...options.headers },
      });
    } catch { throw new PcError('PC_REQUEST_UNCERTAIN'); }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)
        ? error.code : 'PC_HTTP_' + response.status;
      throw new PcError(code, response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status),
        Math.min(3600, Math.max(0, Number(response.headers.get('retry-after')) || 0)));
    }
    return body;
  }
  private parse(value: unknown, expected: {from: string; to: string; content: string; numberId: string}) {
    if (!value || typeof value !== 'object') throw new PcError('PC_INVALID_RESPONSE');
    const row = value as Partial<PcMessage>;
    if (typeof row.id !== 'string' || !/^OUT-\d+$/.test(row.id) || !Number.isInteger(row.numberId) || String(row.numberId) !== expected.numberId ||
        typeof row.counterparty !== 'string' || normalizePhone(row.counterparty) !== normalizePhone(expected.to) || row.content !== expected.content ||
        !pcStatuses.includes(row.status as PcStatus) ||
        (row.phoneNumber !== undefined && (typeof row.phoneNumber !== 'string' || normalizePhone(row.phoneNumber) !== normalizePhone(expected.from))))
      throw new PcError('PC_INVALID_RESPONSE');
    return { ...row, errorCode: typeof row.errorCode === 'string' ? row.errorCode.slice(0, 200) : undefined } as PcMessage;
  }
  async verifyAccount(requiredScopes: string[] = []) {
    if (!this.accountCheck || this.accountCheck.until <= Date.now()) {
      const promise = this.call('/me').then(value => {
        const account = value as Partial<PcAccount> | null;
        if (!account || !Number.isSafeInteger(account.id) || typeof account.username !== 'string' ||
            !Array.isArray(account.scopes) || !account.scopes.every(scope => typeof scope === 'string')) throw new PcError('PC_INVALID_ACCOUNT_RESPONSE');
        if (String(account.id) !== settings.pingcode.accountId) throw new PcError('PC_OPERATOR_ACCOUNT_MISMATCH', true);
        return account as PcAccount;
      });
      this.accountCheck = {until: Date.now() + 60000, promise};
      // Concurrent C-end requests share one B-end account verification; failures can retry.
      void promise.catch(() => { if (this.accountCheck?.promise === promise) this.accountCheck = undefined; });
    }
    const account = await this.accountCheck.promise;
    if (requiredScopes.some(scope => !account.scopes.includes(scope))) throw new PcError('PC_OPERATOR_SCOPE_MISSING', true);
    return account;
  }
  async numbers() {
    const result: PcNumber[] = [], identities = new Set<number>(), cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
      const query = new URLSearchParams({limit: '100', ...(cursor ? {cursor} : {})});
      const value = await this.call('/numbers?' + query) as {data?: PcNumber[]; page?: {hasMore?: boolean; nextCursor?: string}} | null;
      if (!value || !Array.isArray(value.data) || !value.page || typeof value.page.hasMore !== 'boolean') throw new PcError('PC_INVALID_NUMBERS_RESPONSE');
      for (const row of value.data) {
        if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || identities.has(row.id) ||
            !['READY', 'ACTIVE', 'UNAVAILABLE', 'EXPIRED', 'DISABLED'].includes(row.status) ||
            (row.phoneNumber !== undefined && !/^\+?[1-9]\d{1,14}$/.test(row.phoneNumber)) ||
            (row.expiresAt !== undefined && (!/(?:Z|[+-]\d{2}:\d{2})$/.test(row.expiresAt) || !Number.isFinite(Date.parse(row.expiresAt)))))
          throw new PcError('PC_INVALID_NUMBERS_RESPONSE');
        identities.add(row.id); result.push(row);
      }
      if (!value.page.hasMore) return result;
      cursor = value.page.nextCursor;
      if (!cursor || typeof cursor !== 'string' || cursors.has(cursor)) throw new PcError('PC_INVALID_NUMBERS_CURSOR');
      cursors.add(cursor);
    }
    throw new PcError('PC_NUMBERS_PAGE_LIMIT');
  }
  async send(id: string, input: {from: string; to: string; content: string; numberId: string}) {
    await this.verifyAccount(['sms:send']);
    const value = await this.call('/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'once-' + id },
      body: JSON.stringify({phoneNumber: normalizePhone(input.from), to: input.to, content: input.content}),
    });
    return this.parse(value, input);
  }
  async lookup(id: string, input: {from: string; to: string; content: string; numberId: string}) {
    await this.verifyAccount();
    const result = this.parse(await this.call('/sms/outbound/' + encodeURIComponent(id)), input);
    if (result.id !== id) throw new PcError('PC_INVALID_RESPONSE');
    return result;
  }
}
