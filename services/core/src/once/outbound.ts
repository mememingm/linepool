import { randomUUID } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { safeErrorDetails } from '../error-summary.js';
import { MockSmsSender, type MockSmsRequest, type MockSmsResult } from '../providers/mock-sms-sender.js';
import { PcSmsSender, PcSmsNotSubmitted } from '../providers/pc-sms-sender.js';
import { PcHttpFailure } from '../pc/http-provider.js';
import { WebhookInbox } from '../providers/webhook-inbox.js';
import { activeMessageAllocation, mockSmsScenarioSchema, outboundInputSchema, ownedMessageLease, parseInput,
  requireMessageSandbox, smsKey, smsPhone, type MockSmsScenario } from './message-access.js';
import { outboundView, terminalOutbound, type OutboundRow } from './message-state.js';

@Injectable()
export class OnceOutbound {
  constructor(private readonly db: Database, private readonly environment: Environment,
    private readonly sender: MockSmsSender, private readonly inbox: WebhookInbox, private readonly realSender: PcSmsSender) {}

  async send(userId: string, leaseId: string, input: unknown, key: unknown, scenario?: MockSmsScenario) {
    const body = parseInput(outboundInputSchema, input), idempotencyKey = smsKey(key);
    if (scenario !== undefined) requireMessageSandbox(this.environment);
    const request = this.environment.pcProvider === 'pingcode-mock'
      ? { leaseId, to: smsPhone(body.to), content: body.content, scenario: parseInput(mockSmsScenarioSchema, scenario ?? 'SUCCESS') }
      : { leaseId, to: smsPhone(body.to), content: body.content };
    const saved = await this.db.transaction(async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const lease = await ownedMessageLease(client, this.environment, userId, leaseId);
      const { rows: [existing] } = await client.query<OutboundRow & { same: boolean }>(`SELECT *,request_payload=$3::jsonb AS same
        FROM outbound_messages WHERE lease_id=$1 AND idempotency_key=$2 FOR UPDATE`, [leaseId, idempotencyKey, JSON.stringify(request)]);
      if (existing) {
        if (!existing.same) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for a different SMS');
        return existing;
      }
      const active = await client.query("SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE'", [userId]);
      if (!active.rowCount) throw new ApiFailure(403, 'ACCOUNT_DISABLED', 'Account is disabled');
      await client.query('SELECT id FROM upstream_accounts WHERE id=$1 FOR SHARE', [lease.upstream_account_id]);
      await client.query('SELECT id FROM phone_numbers WHERE id=$1 FOR UPDATE', [lease.number_id]);
      const current = await ownedMessageLease(client, this.environment, userId, leaseId);
      const allocationId = await activeMessageAllocation(client, current);
      const { rows: [row] } = await client.query<OutboundRow>(`INSERT INTO outbound_messages(lease_id,allocation_id,user_id,
        number_id,upstream_account_id,provider,external_number_id,sender_number,recipient,content,request_payload,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$12,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [leaseId, allocationId, userId, current.number_id, current.upstream_account_id, current.external_number_id,
        current.phone_number, request.to, request.content, JSON.stringify(request), idempotencyKey, this.environment.pcProvider]);
      return row!;
    });
    return outboundView(saved);
  }

  async list(userId: string, leaseId: string) {
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    const { rows } = await this.db.query<OutboundRow>('SELECT * FROM outbound_messages WHERE lease_id=$1 AND user_id=$2 ORDER BY created_at DESC,id LIMIT 200', [leaseId, userId]);
    return rows.map(outboundView);
  }

  async detail(userId: string, leaseId: string, id: string) {
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    const { rows: [row] } = await this.db.query<OutboundRow>('SELECT * FROM outbound_messages WHERE id=$1 AND lease_id=$2 AND user_id=$3', [id, leaseId, userId]);
    if (!row) throw new ApiFailure(404, 'SMS_NOT_FOUND', 'SMS not found');
    return outboundView(row);
  }

  private async row(id: string) {
    const { rows: [row] } = await this.db.query<OutboundRow>('SELECT * FROM outbound_messages WHERE id=$1', [id]);
    if (!row) throw new ApiFailure(404, 'SMS_NOT_FOUND', 'SMS not found');
    return row;
  }

  private async observe(row: OutboundRow, result: MockSmsResult, token?: string) {
    const saved = await this.db.transaction(async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.user_id]);
      const { rows: [current] } = await client.query<OutboundRow>('SELECT * FROM outbound_messages WHERE id=$1 FOR UPDATE', [row.id]);
      if (!current) throw new Error('OUTBOUND_NOT_FOUND');
      if (token && (current.claim_token !== token || !current.claim_deadline || current.claim_deadline.getTime() <= Date.now())) return false;
      if (!token && current.claim_token && current.claim_deadline && current.claim_deadline.getTime() > Date.now()) return false;
      if (current.provider_message_id && current.provider_message_id !== result.providerMessageId) throw new ApiFailure(409, 'OUTBOUND_PROVIDER_ID_CONFLICT', 'Upstream operation identity changed');
      await client.query(`UPDATE outbound_messages SET provider_message_id=$2,claim_token=NULL,claim_deadline=NULL,
        last_checked_at=now(),updated_at=now() WHERE id=$1`, [row.id, result.providerMessageId]);
      return true;
    });
    if (saved) {
      const event = await this.inbox.recordOutbound({ eventId: `${row.provider === 'pingcode' ? 'pc' : 'mock'}-status-${row.id}-${result.occurredAt.getTime()}-${result.status}`,
        provider: row.provider as 'pingcode' | 'pingcode-mock', connectionId: row.provider === 'pingcode' ? row.upstream_account_id : undefined,
        providerMessageId: result.providerMessageId, numberId: row.external_number_id, phoneNumber: row.sender_number,
        recipient: row.recipient, status: result.status as 'QUEUED' | 'SENDING' | 'SENT' | 'UNCERTAIN' | 'DELIVERED' | 'UNDELIVERABLE' | 'FAILED',
        occurredAt: result.occurredAt.toISOString(), errorCode: result.errorCode });
      await this.inbox.routeEvent(event.eventId);
      await this.inbox.matchOutbound(result.providerMessageId, row.provider as 'pingcode' | 'pingcode-mock');
    }
    return this.row(row.id);
  }

  private async dispatch(id: string) {
    let row = await this.row(id);
    if (row.import_batch_id || terminalOutbound[row.status] || row.provider !== this.environment.pcProvider) return row;
    const real = row.provider === 'pingcode';
    if (row.claim_token && row.claim_deadline && row.claim_deadline.getTime() > Date.now()) return row;
    if (row.claim_token) {
      await this.db.query(`UPDATE outbound_messages SET status=CASE WHEN status='SUBMITTING' THEN 'UNCERTAIN' ELSE status END,
        claim_token=NULL,claim_deadline=NULL,error_message='SMS_CLAIM_EXPIRED',updated_at=now()
        WHERE id=$1 AND claim_token=$2 AND claim_deadline<=now()`, [id, row.claim_token]);
      row = await this.row(id);
    }
    if (row.last_checked_at && row.last_checked_at.getTime() > Date.now() - 15000) return row;
    if (real && row.attempts > 0 && !row.provider_message_id) {
      await this.db.query(`UPDATE outbound_messages SET status='UNCERTAIN',last_checked_at=now(),
        error_message='PC_SMS_TASK_ID_UNKNOWN',updated_at=now() WHERE id=$1 AND provider_message_id IS NULL
        AND status NOT IN ('DELIVERED','UNDELIVERABLE','FAILED')`, [id]);
      return this.row(id);
    }
    if (row.attempts > 0 || row.provider_message_id) {
      try {
        const result = real ? await this.realSender.lookup(row) : await this.sender.lookup(id);
        if (result) return await this.observe(row, result);
        if (real || row.provider_message_id) {
          await this.db.query("UPDATE outbound_messages SET last_checked_at=now(),error_message=$2,updated_at=now() WHERE id=$1", [id, real ? 'PC_SMS_LOOKUP_NOT_FOUND' : 'MOCK_LOOKUP_NOT_FOUND']);
          return this.row(id);
        }
      } catch (error) {
        console.error('SMS lookup unavailable', { outboundId: id, ...safeErrorDetails(error) });
        await this.db.query("UPDATE outbound_messages SET last_checked_at=now(),error_message=$2,updated_at=now() WHERE id=$1", [id, real ? 'PC_SMS_LOOKUP_UNAVAILABLE' : 'MOCK_LOOKUP_UNAVAILABLE']);
        return this.row(id);
      }
    }
    // Only Mock can resume after positive durable absence; real sends have one automatic submission.
    const claimed = await this.db.transaction(async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.user_id]);
      const { rows: [current] } = await client.query<OutboundRow>('SELECT * FROM outbound_messages WHERE id=$1 FOR UPDATE', [id]);
      if (!current || terminalOutbound[current.status] || current.provider_message_id || current.attempts !== row.attempts
        || current.provider !== this.environment.pcProvider || (real && current.attempts > 0)
        || (current.claim_deadline && current.claim_deadline.getTime() > Date.now())) return null;
      if (current.attempts >= 20 || (current.attempts > 0 && current.created_at.getTime() < Date.now() - 86400000)) {
        await client.query("UPDATE outbound_messages SET status='UNCERTAIN',error_message='SMS_RETRY_LIMIT',last_checked_at=now(),updated_at=now() WHERE id=$1", [id]);
        return null;
      }
      await client.query('SELECT id FROM upstream_accounts WHERE id=$1 FOR SHARE', [current.upstream_account_id]);
      await client.query('SELECT id FROM phone_numbers WHERE id=$1 FOR UPDATE', [current.number_id]);
      const lease = await ownedMessageLease(client, this.environment, current.user_id, current.lease_id);
      let active = false;
      const user = await client.query("SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE'", [current.user_id]);
      try {
        const allocationId = await activeMessageAllocation(client, lease);
        active = Boolean(user.rowCount) && allocationId === current.allocation_id && lease.number_id === current.number_id
          && lease.upstream_account_id === current.upstream_account_id && lease.phone_number === current.sender_number
          && lease.external_number_id === current.external_number_id && lease.provider === current.provider;
      } catch (error) { if (!(error instanceof ApiFailure)) throw error; }
      if (!active) {
        await client.query(`UPDATE outbound_messages SET status=$2,error_message='LEASE_OR_SENDER_UNAVAILABLE',
          last_checked_at=now(),claim_token=NULL,claim_deadline=NULL,updated_at=now() WHERE id=$1`, [id, current.attempts ? 'UNCERTAIN' : 'FAILED']);
        return null;
      }
      const token = randomUUID();
      const { rows: [submitted] } = await client.query<OutboundRow>(`UPDATE outbound_messages SET status='SUBMITTING',attempts=attempts+1,claim_token=$2,
        claim_deadline=now()+CASE WHEN provider='pingcode' THEN interval '60 seconds' ELSE interval '15 seconds' END,last_checked_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [id, token]);
      return { token, row: submitted! };
    });
    if (!claimed) return this.row(id);
    try {
      const result = real ? await this.realSender.send(claimed.row) : await this.sender.send(id, claimed.row.request_payload as MockSmsRequest);
      return await this.observe(claimed.row, result, claimed.token);
    } catch (error) {
      const notSubmitted = real && error instanceof PcSmsNotSubmitted;
      const rejected = real && error instanceof PcHttpFailure && error.outcome === 'REJECTED'
        && error.status !== undefined && error.status >= 400 && error.status < 500
        && !['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_CONFLICT'].includes(error.reason);
      console.error('SMS submission observation failed', { outboundId: id, ...safeErrorDetails(error) });
      await this.db.query(`UPDATE outbound_messages SET status=$3,claim_token=NULL,claim_deadline=NULL,
        attempts=CASE WHEN $5::boolean THEN attempts-1 ELSE attempts END,
        error_message=$4,last_checked_at=now(),updated_at=now()
        WHERE id=$1 AND claim_token=$2 AND status='SUBMITTING'`,
        [id, claimed.token, notSubmitted ? 'PENDING' : rejected ? 'FAILED' : 'UNCERTAIN',
          notSubmitted ? 'PC_SMS_CONNECTION_UNAVAILABLE' : rejected ? error.reason : real ? 'PC_SMS_RESPONSE_UNKNOWN' : 'MOCK_SMS_RESPONSE_UNKNOWN', notSubmitted]);
      return this.row(id);
    }
  }

  async recover() {
    if (!this.environment.isWorker || this.environment.siteId !== 'once') return;
    const { rows } = await this.db.query<{ id: string }>(`SELECT o.id FROM outbound_messages o
      JOIN upstream_accounts a ON a.id=o.upstream_account_id WHERE o.provider=$2 AND a.provider=o.provider AND o.import_batch_id IS NULL
      AND a.external_account_id=$1 AND a.storefront_id='once' AND a.owner_kind='SELF_SERVICE' AND a.agent_id IS NULL AND NOT a.historical_only
      AND o.status IN ('PENDING','SUBMITTING','QUEUED','SENDING','SENT','UNCERTAIN')
      AND (o.last_checked_at IS NULL OR o.last_checked_at<now()-interval '15 seconds')
      ORDER BY o.last_checked_at NULLS FIRST,o.created_at,o.id LIMIT 25`, [this.environment.selfServiceExternalAccountId, this.environment.pcProvider]);
    for (const row of rows) {
      try { await this.dispatch(row.id); }
      catch (error) { console.error('SMS recovery failed', { outboundId: row.id, ...safeErrorDetails(error) }); }
    }
  }
}

@Injectable()
export class OnceMessagingWorker implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly outbound: OnceOutbound, private readonly environment: Environment) {}
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  onApplicationBootstrap() {
    if (!this.environment.isWorker || this.environment.siteId !== 'once' || !this.environment.isModuleEnabled('NUMBER_LEASE')) return;
    const tick = () => {
      if (this.running) return;
      this.running = this.outbound.recover().catch(error => console.error('Outbound recovery failed', safeErrorDetails(error)))
        .finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick();
  }
  async onModuleDestroy() { clearInterval(this.timer); await this.running; }
}
