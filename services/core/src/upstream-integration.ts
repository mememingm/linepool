import { Injectable } from '@nestjs/common';
import { adminUpstreamStatusSchema } from '@linepool/contracts/admin';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure } from './http.js';

@Injectable()
export class UpstreamIntegration {
  constructor(private readonly db: Database, private readonly environment: Environment) {}

  async status() {
    if (this.environment.pcProvider === 'pingcode') throw new ApiFailure(409, 'PC_PLATFORM_PROJECT_UNCONFIRMED', 'Real LinePool self-service requires the documented project metadata protocol');
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const linepoolAccount = await client.query<{ id: string }>(`SELECT id FROM upstream_accounts
        WHERE provider='pingcode-mock' AND external_account_id=$1 AND storefront_id='linepool'`,
      [this.environment.values.PINGCODE_EXTERNAL_ACCOUNT_ID]);
      const accountId = linepoolAccount.rows[0]?.id ?? null;
      const { rows: [receipts] } = await client.query(`SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE processing_status='IMPORTED'))::int AS imported,
        (count(*) FILTER (WHERE processing_status='PENDING'))::int AS pending,
        (count(*) FILTER (WHERE processing_status='UNMATCHED'))::int AS unmatched,
        max(received_at)::text AS "lastReceivedAt",max(processed_at)::text AS "lastProcessedAt"
        FROM provider_message_receipts WHERE upstream_account_id=$1`, [accountId]);
      const { rows: [deliveries] } = await client.query(`SELECT count(*)::int AS "eventCount",
        COALESCE(sum(delivery_count),0)::int AS "deliveryCount",
        COALESCE(sum(delivery_count-1),0)::int AS "redeliveryCount"
        FROM provider_event_receipts WHERE upstream_account_id=$1`, [accountId]);
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
