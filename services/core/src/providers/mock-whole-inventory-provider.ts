import { Injectable } from '@nestjs/common';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { ProviderInventoryAdapter, type ProviderSyncMode, type ProviderSyncResource, type ProviderSyncScope, type ProviderSyncSnapshot } from '../provider-sync.js';

type InventoryRow = {
  external_number_id: string | null;
  phone_number: string;
  region_id: NonNullable<ProviderSyncResource['region']>;
  resource_status: ProviderSyncResource['status'];
  resource_expires_at: Date | null;
};

/** Historical local-projection adapter, retained for source review only.
 * Never register this adapter: PcWorker owns all authoritative connection snapshots and sync tasks.
 */
@Injectable()
export class MockWholeInventoryProvider extends ProviderInventoryAdapter {
  constructor(private readonly db: Database, private readonly environment: Environment) { super(); }

  supports(scope: ProviderSyncScope): boolean {
    return this.environment.siteId === 'once' && scope.scopeKind === 'ACCOUNT' && scope.provider === 'pingcode-mock'
      && scope.externalAccountId === this.environment.selfServiceExternalAccountId;
  }

  async snapshot(scope: ProviderSyncScope, _mode: ProviderSyncMode, signal: AbortSignal): Promise<ProviderSyncSnapshot> {
    if (scope.scopeKind !== 'ACCOUNT' || !this.supports(scope)) {
      throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'The configured Mock whole-number account is required');
    }
    signal.throwIfAborted();
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const account = await client.query(`SELECT id FROM upstream_accounts
        WHERE id=$1 AND provider=$2 AND external_account_id=$3 AND owner_kind='SELF_SERVICE' AND NOT historical_only
          AND auth_status='ACTIVE' AND access_expires_at>now() AND storefront_id='once' AND status='ACTIVE'`,
      [scope.upstreamAccountId, scope.provider, scope.externalAccountId]);
      if (!account.rowCount) throw new ApiFailure(409, 'PROVIDER_ACCOUNT_UNAVAILABLE', 'The configured Mock account is unavailable');
      const { rows } = await client.query<InventoryRow>(`SELECT b.external_number_id,n.phone_number,n.region_id,n.resource_status,n.resource_expires_at
        FROM phone_numbers n LEFT JOIN provider_resource_bindings b
          ON b.number_id=n.id AND b.provider=$2 AND b.external_project_id IS NULL
        WHERE n.upstream_account_id=$1 AND NOT n.source_missing ORDER BY n.id LIMIT 10001`, [scope.upstreamAccountId, scope.provider]);
      signal.throwIfAborted();
      if (rows.length > 10000) throw new ApiFailure(409, 'PROVIDER_SNAPSHOT_LIMIT', 'Mock inventory exceeds the supported complete snapshot size');
      const resources: ProviderSyncResource[] = rows.map(row => {
        if (!row.external_number_id) throw new ApiFailure(409, 'PROVIDER_BINDING_REQUIRED', 'A whole-number resource is missing its trusted external binding');
        if (!row.resource_expires_at) throw new ApiFailure(409, 'PROVIDER_RESOURCE_EXPIRY_REQUIRED', 'A Mock whole-number resource requires a confirmed finite expiry');
        return { externalNumberId: row.external_number_id, phoneNumber: row.phone_number, region: row.region_id,
          status: row.resource_status, resourceExpiresAt: row.resource_expires_at.toISOString() };
      });
      return { resources, complete: true };
    });
  }
}
