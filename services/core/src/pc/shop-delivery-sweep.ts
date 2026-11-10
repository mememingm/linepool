import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { safeErrorDetails } from '../error-summary.js';
import { ShopDelivery, deliverSafely, type ShopDeliveryInput } from './shop-delivery.js';

export type ShopDeliveryCandidate = {
  source: 'MISSED' | 'RETRY';
  provider: string;
  externalMessageId: string;
  connectionId: string;
  numberId: string;
  sender: string;
  body: string;
  occurredAt: string;
};

type CandidateRow = {
  source: 'MISSED' | 'RETRY'; provider: string; external_message_id: string; connection_id: string;
  number_id: string; sender: string; body: string; occurred_at: string;
};

/** Candidate query shared by the worker and the rollback replay harness. */
export async function findShopDeliveryCandidates(client: Pick<PoolClient, 'query'>, since: string,
  limit = 50): Promise<ShopDeliveryCandidate[]> {
  const { rows } = await client.query<CandidateRow>(`WITH shop_receipts AS (
      SELECT c.provider,c.external_message_id,c.connection_id,c.number_id,c.ingested_at,
        c.normalized_payload->>'sender' AS sender,c.normalized_payload->>'content' AS body,
        c.normalized_payload->>'occurredAt' AS occurred_at
      FROM provider_message_receipts c
      JOIN shops s ON s.connection_id=c.connection_id AND s.site_id='linepool' AND s.status='ACTIVE'
      WHERE c.provider='pingcode' AND c.processing_status='CONNECTION_IMPORTED'
        AND c.connection_id IS NOT NULL AND c.number_id IS NOT NULL
        AND c.normalized_payload IS NOT NULL AND c.ingested_at IS NOT NULL
    ), candidates AS (
      SELECT 'MISSED'::text AS source,r.* FROM shop_receipts r
      WHERE r.ingested_at < now()-interval '2 minutes'
        AND r.ingested_at >= GREATEST($1::timestamptz, now() - interval '7 days')
        AND NOT EXISTS(SELECT 1 FROM shop_message_deliveries d WHERE d.provider=r.provider AND d.external_message_id=r.external_message_id)
        AND NOT EXISTS(SELECT 1 FROM shop_delivery_attempts a WHERE a.provider=r.provider AND a.external_message_id=r.external_message_id)
      UNION ALL
      SELECT 'RETRY'::text AS source,r.* FROM shop_receipts r
      JOIN shop_delivery_attempts a ON a.provider=r.provider AND a.external_message_id=r.external_message_id
      WHERE a.status='RETRYING' AND a.next_attempt_at<=now()
    )
    SELECT * FROM candidates ORDER BY source,occurred_at,external_message_id LIMIT $2`, [since, limit]);
  return rows.map(row => ({
    source: row.source, provider: row.provider, externalMessageId: row.external_message_id,
    connectionId: row.connection_id, numberId: row.number_id, sender: row.sender,
    body: row.body, occurredAt: row.occurred_at,
  }));
}

/** Processes one candidate inside the caller's transaction. Returns true when a final delivery fact exists. */
export async function processShopDeliveryCandidate(client: PoolClient, candidate: ShopDeliveryCandidate,
  delivery: Pick<ShopDelivery, 'deliver'>): Promise<boolean> {
  const { rows: [receipt] } = await client.query<{
    provider: string; external_message_id: string; connection_id: string | null; number_id: string | null;
    processing_status: string; normalized_payload: { sender?: string; content?: string; occurredAt?: string } | null;
  }>(`SELECT provider,external_message_id,connection_id,number_id,processing_status,normalized_payload
      FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2 FOR UPDATE SKIP LOCKED`,
  [candidate.provider, candidate.externalMessageId]);
  if (!receipt || receipt.processing_status !== 'CONNECTION_IMPORTED'
    || receipt.connection_id !== candidate.connectionId || receipt.number_id !== candidate.numberId
    || !receipt.normalized_payload?.sender || !receipt.normalized_payload.content || !receipt.normalized_payload.occurredAt) {
    return false;
  }
  const input: ShopDeliveryInput = {
    provider: candidate.provider, externalMessageId: candidate.externalMessageId,
    connectionId: candidate.connectionId, numberId: candidate.numberId,
    sender: receipt.normalized_payload.sender, body: receipt.normalized_payload.content,
    occurredAt: receipt.normalized_payload.occurredAt,
  };
  const result = await deliverSafely(client, delivery, input);
  if (!result) return false;
  await client.query('DELETE FROM shop_delivery_attempts WHERE provider=$1 AND external_message_id=$2',
    [candidate.provider, candidate.externalMessageId]);
  return true;
}

/** Worker-only recovery loop. The environment gate keeps historical receipts from being backfilled. */
@Injectable()
export class ShopDeliverySweep implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  constructor(private readonly db: Database, private readonly environment: Environment,
    private readonly delivery: ShopDelivery) {}

  onApplicationBootstrap() {
    if (!this.environment.isWorker || this.environment.siteId !== 'linepool') return;
    const since = this.environment.values.SHOP_DELIVERY_SWEEP_SINCE;
    if (!since) {
      console.warn('SHOP_DELIVERY_SWEEP_SINCE is not set; shop delivery sweep is disabled');
      return;
    }
    console.log(`Shop delivery sweep started since ${since}`);
    this.timer = setInterval(() => this.tick(since), 60000);
    this.timer.unref();
    this.tick(since);
  }

  private tick(since: string) {
    if (this.running) return;
    this.running = this.cycle(since).catch(error => console.error('Shop delivery sweep failed', safeErrorDetails(error)))
      .finally(() => { this.running = undefined; });
  }

  async cycle(since: string) {
    const client = await this.db.pool.connect();
    let candidates;
    try {
      candidates = await findShopDeliveryCandidates(client, since, 50);
    } finally {
      client.release();
    }
    for (const candidate of candidates) {
      try {
        await this.db.transaction(async transaction => {
          await processShopDeliveryCandidate(transaction, candidate, this.delivery);
        });
      } catch (error) {
        console.error('Shop delivery candidate failed', { externalMessageId: candidate.externalMessageId, ...safeErrorDetails(error) });
      }
    }
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
}
