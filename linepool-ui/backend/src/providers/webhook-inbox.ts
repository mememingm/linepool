import { createHash } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';

// Internal normalized input. The HTTP adapter verifies the agreed raw-body signature first.
// PC must confirm the proposed project-aware wire contract before live integration.
const inbound = z.object({
  eventId: z.string().trim().min(1).max(200),
  messageId: z.string().trim().min(1).max(200),
  projectId: z.string().trim().min(1).max(200),
  numberId: z.string().trim().min(1).max(200),
  phoneNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  sender: z.string().max(500), content: z.string().max(16000),
  occurredAt: z.string().datetime({ offset: true }),
  rawPayload: z.json().optional(),
});
export type VerifiedPcInbound = z.infer<typeof inbound>;

@Injectable()
export class WebhookInbox implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  /** A committed receipt is sufficient for the HTTP adapter to acknowledge delivery. */
  async recordVerified(input: VerifiedPcInbound) {
    const item = inbound.parse(input);
    const fingerprint = createHash('sha256').update(JSON.stringify([
      item.projectId,item.numberId,item.phoneNumber,item.sender,item.content,Date.parse(item.occurredAt),
    ])).digest('hex');
    return this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`pingcode:event:${item.eventId}`]);
      const { rows: [event] } = await client.query<{ external_message_id: string }>(
        "SELECT external_message_id FROM provider_event_receipts WHERE provider='pingcode' AND event_id=$1", [item.eventId]);
      if (event && event.external_message_id !== item.messageId) throw new ApiFailure(409, 'PROVIDER_EVENT_CONFLICT', 'Event ID was reused');
      await client.query(`INSERT INTO provider_message_receipts(provider,external_message_id,fingerprint,
        external_project_id,external_number_id,raw_payload)
        VALUES('pingcode',$1,$2,$3,$4,$5) ON CONFLICT(provider,external_message_id) DO NOTHING`,
      [item.messageId,fingerprint,item.projectId,item.numberId,JSON.stringify(item)]);
      const { rows: [saved] } = await client.query<{ fingerprint: string; processing_status: string }>(
        "SELECT fingerprint,processing_status FROM provider_message_receipts WHERE provider='pingcode' AND external_message_id=$1 FOR UPDATE", [item.messageId]);
      if (saved!.fingerprint !== fingerprint) throw new ApiFailure(409, 'PROVIDER_MESSAGE_CONFLICT', 'Message ID was reused with different content or project');
      await client.query(`INSERT INTO provider_event_receipts(provider,event_id,external_message_id)
        VALUES('pingcode',$1,$2) ON CONFLICT(provider,event_id) DO UPDATE
        SET delivery_count=provider_event_receipts.delivery_count+1`, [item.eventId,item.messageId]);
      return { received: true as const, messageId: item.messageId, status: saved!.processing_status };
    });
  }

  /** Route by trusted project + number + original reception time, including delayed redelivery. */
  async route(messageId: string) {
    return this.db.transaction(async client => {
      const { rows: [receipt] } = await client.query<{ processing_status: string; raw_payload: unknown }>(
        "SELECT processing_status,raw_payload FROM provider_message_receipts WHERE provider='pingcode' AND external_message_id=$1 FOR UPDATE", [messageId]);
      if (!receipt) throw new ApiFailure(404, 'RECEIPT_NOT_FOUND', 'Receipt not found');
      if (receipt.processing_status === 'IMPORTED') return { status: 'IMPORTED' as const };
      const item = inbound.parse(receipt.raw_payload);
      const { rows } = await client.query<{ id: string; number_id: string; user_id: string; platform_id: string }>(
        `SELECT a.id,a.number_id,a.user_id,a.platform_id FROM provider_projects p
         JOIN number_platforms s ON s.provider=p.provider AND s.external_project_id=p.external_project_id AND s.platform_id=p.platform_id
         JOIN provider_resource_bindings b ON b.provider=p.provider AND b.number_id=s.number_id
         JOIN phone_numbers n ON n.id=b.number_id
         JOIN number_allocations a ON a.number_id=n.id AND a.platform_id=p.platform_id
         WHERE p.provider='pingcode' AND p.external_project_id=$1 AND b.external_number_id=$2 AND n.phone_number=$3
         AND a.assigned_at<=$4::timestamptz AND $4::timestamptz<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))
         AND $4::timestamptz<=now()
         AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))
         FOR SHARE OF a`, [item.projectId,item.numberId,item.phoneNumber,item.occurredAt]);
      if (rows.length !== 1) {
        await client.query(`UPDATE provider_message_receipts SET processing_status='UNMATCHED',
          failure_reason='No unique number/platform service at original reception time',processed_at=now()
          WHERE provider='pingcode' AND external_message_id=$1`, [messageId]);
        return { status: 'UNMATCHED' as const };
      }
      const service = rows[0]!;
      const { rows: [message] } = await client.query<{ id: string }>(
        `INSERT INTO sms_messages(user_id,number_id,allocation_id,platform_id,sender,body,received_at,verification_code)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [service.user_id,service.number_id,service.id,service.platform_id,item.sender,item.content,item.occurredAt,
        item.content.match(/(?<![0-9])[0-9]{4,8}(?![0-9])/)?.[0] ?? null]);
      await client.query(`UPDATE provider_message_receipts SET message_id=$2,allocation_id=$3,
        processing_status='IMPORTED',failure_reason=NULL,processed_at=now()
        WHERE provider='pingcode' AND external_message_id=$1`, [messageId,message!.id,service.id]);
      return { status: 'IMPORTED' as const };
    });
  }

  async retryPending(limit = 100) {
    if (!Number.isInteger(limit) || limit<1 || limit>500) throw new Error('Receipt retry limit must be 1..500');
    const { rows } = await this.db.query<{ external_message_id: string }>(
      `SELECT external_message_id FROM provider_message_receipts WHERE provider='pingcode'
       AND processing_status IN ('PENDING','UNMATCHED')
       ORDER BY processed_at NULLS FIRST,received_at,external_message_id LIMIT $1`, [limit]);
    const outcomes = [];
    for (const row of rows) outcomes.push(await this.route(row.external_message_id));
    return outcomes;
  }

  onApplicationBootstrap() {
    if (!this.environment.values.PINGCODE_WEBHOOK_SECRET) return;
    const tick = () => {
      if (this.running) return;
      this.running = this.retryPending().catch(() => console.error('Webhook inbox retry failed; next scan will retry'))
        .finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
    tick();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
