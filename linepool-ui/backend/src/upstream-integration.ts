import { Injectable } from '@nestjs/common';
import { adminUpstreamStatusSchema } from '@linepool/contracts/admin';
import { Database } from './database.js';
import { Environment } from './environment.js';

@Injectable()
export class UpstreamIntegration {
  constructor(private readonly db: Database, private readonly environment: Environment) {}

  async status() {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [receipts] } = await client.query(`SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE processing_status='IMPORTED'))::int AS imported,
        (count(*) FILTER (WHERE processing_status='PENDING'))::int AS pending,
        (count(*) FILTER (WHERE processing_status='UNMATCHED'))::int AS unmatched,
        max(received_at)::text AS "lastReceivedAt",max(processed_at)::text AS "lastProcessedAt"
        FROM provider_message_receipts WHERE provider='pingcode'`);
      const { rows: [deliveries] } = await client.query(`SELECT count(*)::int AS "eventCount",
        COALESCE(sum(delivery_count),0)::int AS "deliveryCount",
        COALESCE(sum(delivery_count-1),0)::int AS "redeliveryCount"
        FROM provider_event_receipts WHERE provider='pingcode'`);
      return adminUpstreamStatusSchema.parse({
        environment: this.environment.values.NODE_ENV,
        // The current application wires MockNumberProvider; inbound configuration does not enable live procurement.
        providerTransport: 'mock',
        webhook: {
          path: '/api/webhooks/pingcode',
          secretConfigured: Boolean(this.environment.values.PINGCODE_WEBHOOK_SECRET),
          replayWindowSeconds: 300, retryIntervalSeconds: 30,
        },
        receipts: { ...receipts, ...deliveries },
      });
    });
  }
}
