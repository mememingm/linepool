import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';

/** External project id of a LinePool-local platform project. Real PC exposes no platform projects. */
export const localProjectPrefix = 'lp:';
export const localProjectId = (accountId: string, platformId: string) => `${localProjectPrefix}${accountId}:${platformId}`;

/**
 * Real-mode LinePool shop inventory (unified agent model). PinClode application APIs return numbers and messages
 * but no platform projects, so LinePool owns the platform list: every synced number of an ACTIVE shop's agent
 * connection gets one slot per platform, under a local project of that connection. Availability and the
 * existing project/platform flags decide what is sellable; manual sale_enabled choices are never overwritten.
 */
@Injectable()
export class LocalPlatformInventory {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  get enabled() { return this.environment.siteId === 'linepool' && this.environment.pcProvider === 'pingcode'; }

  /**
   * Reconcile every ACTIVE shop connection, or only `connectionId` when it is one, in the caller's
   * transaction or a new one. Returns the number of slots written.
   */
  async reconcile(existing?: PoolClient, connectionId?: string): Promise<number> {
    if (!this.enabled) return 0;
    const run = async (client: PoolClient) => {
      const { rows: accounts } = await client.query<{ id: string }>(`SELECT a.id FROM shops s JOIN upstream_accounts a ON a.id=s.connection_id
        WHERE s.site_id='linepool' AND s.status='ACTIVE' AND a.provider='pingcode' AND NOT a.historical_only
          AND ($1::uuid IS NULL OR a.id=$1::uuid) ORDER BY a.id FOR SHARE OF a`, [connectionId ?? null]);
      let written = 0;
      for (const account of accounts) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lp-local-inventory:${account.id}`]);
        // Typed parameters: $1 is the connection uuid, $2 the text prefix 'lp:<connection>:' of its local project ids.
        const prefix = localProjectId(account.id, '');
        await client.query(`INSERT INTO provider_projects(provider,external_project_id,platform_id,project_name,upstream_account_id,is_active)
          SELECT 'pingcode',$2::text||p.id,p.id,p.name,$1::uuid,p.is_active FROM platforms p
          ON CONFLICT(provider,external_project_id) DO UPDATE SET project_name=EXCLUDED.project_name,is_active=EXCLUDED.is_active,synced_at=now()`,
        [account.id, prefix]);
        const { rowCount } = await client.query(`INSERT INTO number_platforms(number_id,platform_id,provider,external_project_id,is_available)
          SELECT n.id,p.id,'pingcode',$2::text||p.id,
            (NOT n.source_missing AND n.resource_status='ONLINE' AND 'SMS_CODE'=ANY(n.pc_capabilities)
              AND EXISTS(SELECT 1 FROM provider_resource_bindings b WHERE b.number_id=n.id AND b.provider='pingcode'))
          FROM phone_numbers n CROSS JOIN platforms p WHERE n.upstream_account_id=$1::uuid
          ON CONFLICT(number_id,platform_id) DO UPDATE SET is_available=EXCLUDED.is_available,synced_at=now()
          WHERE number_platforms.external_project_id=EXCLUDED.external_project_id
            AND number_platforms.is_available IS DISTINCT FROM EXCLUDED.is_available`, [account.id, prefix]);
        written += rowCount ?? 0;
      }
      return written;
    };
    return existing ? run(existing) : this.db.transaction(run);
  }
}
