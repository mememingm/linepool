import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure } from './http.js';

// Historical adapter contracts remain for reviewing the tracked pre-v4.2 adapter source.
// Runtime inventory is fetched and applied exclusively by PcWorker's connection poll.
export const syncResourceSchema = z.strictObject({
  externalNumberId: z.string().trim().min(1).max(200),
  phoneNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/).nullable(),
  region: z.enum(['us','gb','ca','sg','de','nl']).optional(),
  status: z.enum(['ONLINE','OFFLINE','ERROR']),
  resourceExpiresAt: z.string().datetime({ offset: true }).nullable(),
});
export type ProviderSyncResource = z.infer<typeof syncResourceSchema>;
export type ProviderSyncMode = 'INCREMENTAL' | 'FULL' | 'MANUAL';
export type ProviderSyncSnapshot = { resources: ProviderSyncResource[]; complete: boolean };
export type ProviderSyncContext =
  | { scopeKind: 'PROJECT'; provider: string; externalProjectId: string }
  | { scopeKind: 'ACCOUNT'; provider: string; upstreamAccountId: string };
export type ProviderSyncScope =
  | { scopeKind: 'PROJECT'; provider: string; externalProjectId: string; platformId: string; upstreamAccountId: string; externalAccountId: string }
  | { scopeKind: 'ACCOUNT'; provider: string; upstreamAccountId: string; externalAccountId: string };
export abstract class ProviderInventoryAdapter {
  abstract supports(scope: ProviderSyncScope): boolean;
  abstract snapshot(scope: ProviderSyncScope, mode: ProviderSyncMode, signal: AbortSignal): Promise<ProviderSyncSnapshot>;
}

/** User/admin actions enqueue a connection poll; they never copy local inventory into a successful sync. */
@Injectable()
export class ProviderSyncService {
  constructor(private readonly db: Database, private readonly environment: Environment) {}

  private async resolveScope(client: PoolClient, context: ProviderSyncContext): Promise<ProviderSyncScope> {
    if (context.provider !== this.environment.pcProvider) throw new ApiFailure(409, 'PROVIDER_MODE_MISMATCH', 'Sync must use the configured provider');
    if (context.scopeKind === 'PROJECT' && this.environment.pcProvider === 'pingcode') {
      throw new ApiFailure(409, 'PC_PLATFORM_PROJECT_UNCONFIRMED', 'Real LinePool self-service requires the documented project metadata protocol');
    }
    if (context.scopeKind === 'ACCOUNT') {
      if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'PROVIDER_ACCOUNT_NOT_FOUND', 'Account inventory is unavailable on this site');
      const { rows: [account] } = await client.query<{ id: string; external_account_id: string }>(`SELECT a.id,a.external_account_id
        FROM upstream_accounts a JOIN storefronts f ON f.id=a.storefront_id
        WHERE a.id=$1 AND a.provider=$2 AND a.external_account_id=$3
          AND a.owner_kind='SELF_SERVICE' AND NOT a.historical_only AND a.auth_status='ACTIVE' AND a.access_expires_at>now()
          AND $4=ANY(a.enabled_capabilities) AND a.application_id=$5 AND a.issuer=$6
          AND a.storefront_id='once' AND f.product='NUMBER_LEASE' AND a.status='ACTIVE' FOR UPDATE OF a`,
        [context.upstreamAccountId, context.provider, this.environment.selfServiceExternalAccountId, this.environment.product,
          this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]);
      if (!account) throw new ApiFailure(404, 'PROVIDER_ACCOUNT_NOT_FOUND', 'The authorized whole-number account is unavailable');
      return { scopeKind: 'ACCOUNT', provider: context.provider, upstreamAccountId: account.id, externalAccountId: account.external_account_id };
    }
    if (this.environment.siteId !== 'linepool') throw new ApiFailure(404, 'PROVIDER_PROJECT_NOT_FOUND', 'Project inventory is unavailable on this site');
    const { rows: [account] } = await client.query<{ id: string; external_account_id: string }>(`SELECT a.id,a.external_account_id
      FROM upstream_accounts a JOIN provider_projects p ON p.upstream_account_id=a.id AND p.provider=a.provider
      WHERE p.provider=$1 AND p.external_project_id=$2 AND a.status='ACTIVE' AND a.provider=p.provider
        AND a.owner_kind='SELF_SERVICE' AND NOT a.historical_only AND a.auth_status='ACTIVE' AND a.access_expires_at>now()
        AND $4=ANY(a.enabled_capabilities) AND a.application_id=$5 AND a.issuer=$6
        AND a.storefront_id='linepool' AND a.external_account_id=$3 FOR UPDATE OF a`,
      [context.provider, context.externalProjectId, this.environment.selfServiceExternalAccountId, this.environment.product,
        this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]);
    if (!account) throw new ApiFailure(404, 'PROVIDER_PROJECT_NOT_FOUND', 'The authorized provider project is unavailable');
    const { rows: [project] } = await client.query<{ platform_id: string; is_active: boolean }>(`SELECT platform_id,is_active
      FROM provider_projects WHERE provider=$1 AND external_project_id=$2 AND upstream_account_id=$3 FOR UPDATE`,
      [context.provider, context.externalProjectId, account.id]);
    if (!project) throw new ApiFailure(409, 'SYNC_ACCOUNT_CHANGED', 'Project account changed during sync');
    if (!project.is_active) throw new ApiFailure(409, 'PROVIDER_PROJECT_DISABLED', 'Provider project is disabled');
    return { scopeKind: 'PROJECT', provider: context.provider, externalProjectId: context.externalProjectId,
      platformId: project.platform_id, upstreamAccountId: account.id, externalAccountId: account.external_account_id };
  }

  async enqueue(context: ProviderSyncContext, mode: ProviderSyncMode, actorId?: string, reason?: string, client?: PoolClient) {
    const save = async (connection: PoolClient) => {
      const scope = await this.resolveScope(connection, context);
      const projectId = scope.scopeKind === 'PROJECT' ? scope.externalProjectId : null;
      const identity = [scope.provider, scope.scopeKind, scope.upstreamAccountId, projectId];
      const running = await connection.query(`SELECT id FROM provider_sync_tasks WHERE provider=$1 AND scope_kind=$2
        AND upstream_account_id=$3 AND external_project_id IS NOT DISTINCT FROM $4 AND status IN ('PENDING','RUNNING')`, identity);
      if (running.rowCount) throw new ApiFailure(409, 'SYNC_ALREADY_RUNNING', 'A sync is already queued for this scope');
      const { rows: [created] } = await connection.query<{ id: string }>(`INSERT INTO provider_sync_tasks(provider,scope_kind,upstream_account_id,external_project_id,mode,status)
        VALUES($1,$2,$3,$4,$5,'PENDING') RETURNING id`, [...identity, mode]);
      await connection.query('UPDATE upstream_accounts SET next_poll_at=now() WHERE id=$1', [scope.upstreamAccountId]);
      if (actorId) await connection.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,after_data)
        VALUES($1,'PROVIDER_SYNC',$2,$3,$4)`, [actorId, `${scope.provider}/${projectId ?? scope.upstreamAccountId}`, reason,
        { taskId: created!.id, mode, scopeKind: scope.scopeKind, upstreamAccountId: scope.upstreamAccountId }]);
      return { taskId: created!.id, status: 'PENDING' as const };
    };
    return client ? save(client) : this.db.transaction(save);
  }

  async resolveConflict(actorId: string, id: string, reason: string) {
    return this.db.transaction(async client => {
      const { rows: [before] } = await client.query('SELECT * FROM provider_sync_conflicts WHERE id=$1 FOR UPDATE', [id]);
      if (!before) throw new ApiFailure(404, 'SYNC_CONFLICT_NOT_FOUND', 'Sync conflict not found');
      if (before.status === 'RESOLVED') return { changed: false };
      await client.query("UPDATE provider_sync_conflicts SET status='RESOLVED',resolved_at=now(),resolved_by=$2,resolution=$3 WHERE id=$1", [id, actorId, reason]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1,'SYNC_CONFLICT_RESOLVE',$2,$3,$4,$5)`, [actorId, id, reason, before, { status: 'RESOLVED' }]);
      return { changed: true };
    });
  }
}
