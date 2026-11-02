import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { safeErrorDetails } from './error-summary.js';

export const syncResourceSchema = z.strictObject({
  externalNumberId: z.string().trim().min(1).max(200),
  phoneNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/).nullable(),
  region: z.enum(['us','gb','ca','sg','de','nl']).optional(),
  status: z.enum(['ONLINE','OFFLINE','ERROR']),
  resourceExpiresAt: z.string().datetime({ offset: true }).nullable(),
});
const snapshotSchema = z.strictObject({ resources: z.array(syncResourceSchema).max(10000), complete: z.boolean() })
  .refine(value => new Set(value.resources.map(r => r.externalNumberId)).size === value.resources.length, 'Duplicate external number IDs');
export type ProviderSyncResource = z.infer<typeof syncResourceSchema>;
export type ProviderSyncMode = 'INCREMENTAL' | 'FULL' | 'MANUAL';
export type SyncProject = { provider: string; externalProjectId: string; platformId: string };

/** Normalized internal contract, not a claimed production PC HTTP API. No credentials or raw responses enter task records. */
export abstract class ProviderInventoryAdapter {
  abstract supports(project: SyncProject): boolean;
  abstract snapshot(project: SyncProject, mode: ProviderSyncMode, signal: AbortSignal): Promise<z.infer<typeof snapshotSchema>>;
}
@Injectable()
export class UnconfiguredInventoryAdapter extends ProviderInventoryAdapter {
  supports(): boolean { return false; }
  async snapshot(): Promise<never> { throw new Error('Inventory adapter is not configured'); }
}
type Task = { id: string; provider: string; external_project_id: string; platform_id: string; mode: ProviderSyncMode; status: string };

@Injectable()
export class ProviderSyncService {
  constructor(private readonly db: Database, @Optional() private readonly adapter: ProviderInventoryAdapter = new UnconfiguredInventoryAdapter()) {}

  async run(provider: string, externalProjectId: string, mode: ProviderSyncMode, actorId?: string, reason?: string) {
    const task = await this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sync:${provider}:${externalProjectId}`]);
      const { rows: [project] } = await client.query<{ platform_id: string; is_active: boolean }>(
        'SELECT platform_id,is_active FROM provider_projects WHERE provider=$1 AND external_project_id=$2 FOR UPDATE', [provider, externalProjectId]);
      if (!project) throw new ApiFailure(404, 'PROVIDER_PROJECT_NOT_FOUND', 'Provider project is not configured');
      if (!project.is_active) throw new ApiFailure(409, 'PROVIDER_PROJECT_DISABLED', 'Provider project is disabled');
      // Reclaim crashed local readers after the bounded adapter call has long expired. No resource mutation occurred yet.
      await client.query(`UPDATE provider_sync_tasks SET status='FAILED',finished_at=now(),error_message='SYNC_WORKER_EXPIRED',failed_count=1
        WHERE provider=$1 AND external_project_id=$2 AND status='RUNNING' AND started_at<now()-interval '5 minutes'`, [provider, externalProjectId]);
      const running = await client.query("SELECT id FROM provider_sync_tasks WHERE provider=$1 AND external_project_id=$2 AND status IN ('PENDING','RUNNING')", [provider, externalProjectId]);
      if (running.rowCount) throw new ApiFailure(409, 'SYNC_ALREADY_RUNNING', 'A sync is already running for this project');
      const { rows: [created] } = await client.query<{ id: string }>(`INSERT INTO provider_sync_tasks(provider,external_project_id,mode,status,started_at)
        VALUES($1,$2,$3,'RUNNING',now()) RETURNING id`, [provider, externalProjectId, mode]);
      await client.query(`UPDATE provider_projects SET sync_status='RUNNING',last_sync_started_at=now(),last_sync_error=NULL
        WHERE provider=$1 AND external_project_id=$2`, [provider, externalProjectId]);
      if (actorId) await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,after_data)
        VALUES($1,'PROVIDER_SYNC',$2,$3,$4)`, [actorId, `${provider}/${externalProjectId}`, reason, { taskId: created!.id, mode }]);
      return { id: created!.id, provider, external_project_id: externalProjectId, platform_id: project.platform_id, mode, status: 'RUNNING' } satisfies Task;
    });
    const project = { provider, externalProjectId, platformId: task.platform_id };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    try {
      if (!this.adapter.supports(project)) return this.finish(task, 'UNSUPPORTED', 'INVENTORY_ADAPTER_NOT_CONNECTED');
      // The committed task is the project lease; never wait for upstream while holding a DB transaction.
      const response = await Promise.race([
        this.adapter.snapshot(project, mode, abort.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('SYNC_TIMEOUT')); }, 30000); }),
      ]);
      const snapshot = snapshotSchema.parse(response);
      if (mode === 'FULL' && !snapshot.complete) throw new Error('INCOMPLETE_FULL_SNAPSHOT');
      return await this.applySnapshot(task, snapshot);
    } catch (error) {
      console.error('Provider inventory sync failed', { taskId: task.id, ...safeErrorDetails(error) });
      // Store a bounded local error code; upstream errors may contain credentials or entire response bodies.
      return this.finish(task, 'FAILED', abort.signal.aborted ? 'SYNC_TIMEOUT' : 'SYNC_ADAPTER_OR_SNAPSHOT_FAILED');
    } finally { if (timer) clearTimeout(timer); }
  }

  private async finish(task: Task, status: 'FAILED' | 'UNSUPPORTED', error: string) {
    return this.db.transaction(async client => {
      const changed = await client.query(`UPDATE provider_sync_tasks SET status=$2,finished_at=now(),error_message=$3,failed_count=$4,
        result=$5 WHERE id=$1 AND status='RUNNING' RETURNING id`, [task.id, status, error, status === 'FAILED' ? 1 : 0, { status, reason: error }]);
      if (changed.rowCount) await client.query(`UPDATE provider_projects SET sync_status=$3,last_sync_finished_at=now(),last_sync_error=$4,
        last_sync_result=$5,consecutive_sync_failures=consecutive_sync_failures+$6 WHERE provider=$1 AND external_project_id=$2`,
        [task.provider, task.external_project_id, status, error, { taskId: task.id, status }, status === 'FAILED' ? 1 : 0]);
      return { taskId: task.id, status, reason: error };
    });
  }

  private async applySnapshot(task: Task, snapshot: z.infer<typeof snapshotSchema>) {
    return this.db.transaction(async client => {
      // Serialize physical resources shared by different projects as well as this project's task lease.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sync-apply:${task.provider}`]);
      const lease = await client.query("SELECT id FROM provider_sync_tasks WHERE id=$1 AND status='RUNNING' FOR UPDATE", [task.id]);
      if (!lease.rowCount) throw new ApiFailure(409, 'SYNC_LEASE_LOST', 'Sync task is no longer running');
      const project = await client.query('SELECT platform_id FROM provider_projects WHERE provider=$1 AND external_project_id=$2 AND is_active FOR SHARE', [task.provider, task.external_project_id]);
      if (!project.rowCount) throw new ApiFailure(409, 'PROVIDER_PROJECT_DISABLED', 'Provider project is disabled');
      const { rows: existing } = await client.query<{ external_number_id: string; number_id: string }>(`SELECT b.external_number_id,s.number_id
        FROM number_platforms s JOIN provider_resource_bindings b ON b.number_id=s.number_id AND b.provider=s.provider
          AND b.external_project_id=s.external_project_id
        WHERE s.provider=$1 AND s.external_project_id=$2`, [task.provider, task.external_project_id]);
      let added = 0, updated = 0, offline = 0, failed = 0, conflicts = 0;
      const seen = new Set(snapshot.resources.map(r => r.externalNumberId));
      for (const resource of [...snapshot.resources].sort((a,b) => a.externalNumberId.localeCompare(b.externalNumberId))) {
        const { rows: [binding] } = await client.query<{ number_id: string; phone_number: string; region_id: string }>(`SELECT b.number_id,n.phone_number,n.region_id
          FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id WHERE b.provider=$1 AND b.external_number_id=$2`,
          [task.provider, resource.externalNumberId]);
        let numberId = binding?.number_id;
        if (binding && ((resource.phoneNumber && resource.phoneNumber !== binding.phone_number) || (resource.region && resource.region !== binding.region_id))) {
          failed++; conflicts += await this.openConflict(client, task, resource.externalNumberId, binding.number_id, 'RESOURCE_UNMAPPED', { reason: 'IDENTITY_MISMATCH' }); continue;
        }
        if (!numberId) {
          if (!resource.phoneNumber || !resource.region) {
            failed++; conflicts += await this.openConflict(client, task, resource.externalNumberId, null, 'RESOURCE_UNMAPPED', { reason: 'PHONE_AND_REGION_REQUIRED' }); continue;
          }
          const collision = await client.query('SELECT id FROM phone_numbers WHERE phone_number=$1', [resource.phoneNumber]);
          if (collision.rowCount) {
            failed++; conflicts += await this.openConflict(client, task, resource.externalNumberId, null, 'RESOURCE_UNMAPPED', { reason: 'PHONE_ALREADY_BOUND_OR_LOCAL' }); continue;
          }
          const { rows: [number] } = await client.query<{ id: string }>(`INSERT INTO phone_numbers(region_id,service,phone_number,resource_status,resource_expires_at)
            VALUES($1,$2,$3,$4,$5) RETURNING id`, [resource.region, task.platform_id, resource.phoneNumber, resource.status, resource.resourceExpiresAt]);
          numberId = number!.id;
          await client.query('INSERT INTO provider_resource_bindings(provider,external_project_id,external_number_id,number_id) VALUES($1,$2,$3,$4)', [task.provider, task.external_project_id, resource.externalNumberId, numberId]);
        }
        const inserted = await client.query(`INSERT INTO number_platforms(number_id,platform_id,provider,external_project_id,sale_enabled,is_available)
          VALUES($1,$2,$3,$4,false,$5) ON CONFLICT(number_id,platform_id) DO NOTHING RETURNING id`,
          [numberId, task.platform_id, task.provider, task.external_project_id, resource.status === 'ONLINE']);
        const slot = await client.query(`SELECT id FROM number_platforms WHERE number_id=$1 AND platform_id=$2 AND provider=$3 AND external_project_id=$4 FOR UPDATE`,
          [numberId, task.platform_id, task.provider, task.external_project_id]);
        if (!slot.rowCount) throw new ApiFailure(409, 'SYNC_MAPPING_CHANGED', 'Number platform mapping changed');
        await client.query('UPDATE phone_numbers SET resource_status=$2,resource_expires_at=$3 WHERE id=$1', [numberId, resource.status, resource.resourceExpiresAt]);
        await client.query('UPDATE number_platforms SET is_available=$3,synced_at=now() WHERE number_id=$1 AND platform_id=$2', [numberId, task.platform_id, resource.status === 'ONLINE']);
        if (inserted.rowCount) added++; else updated++;
        if (resource.status !== 'ONLINE') offline++;
        conflicts += await this.checkResource(client, task, resource.externalNumberId, numberId, resource.status, resource.resourceExpiresAt);
      }
      // Only an explicitly complete FULL snapshot can prove that a previously known resource disappeared.
      if (task.mode === 'FULL' && snapshot.complete) for (const slot of existing) {
        if (seen.has(slot.external_number_id)) continue;
        await client.query('SELECT id FROM number_platforms WHERE number_id=$1 AND platform_id=$2 FOR UPDATE', [slot.number_id, task.platform_id]);
        await client.query("UPDATE phone_numbers SET resource_status='OFFLINE' WHERE id=$1", [slot.number_id]);
        await client.query('UPDATE number_platforms SET is_available=false,synced_at=now() WHERE number_id=$1 AND platform_id=$2', [slot.number_id, task.platform_id]);
        conflicts += await this.checkResource(client, task, slot.external_number_id, slot.number_id, 'OFFLINE', null, true);
        offline++;
      }
      const result = { fetchedCount: snapshot.resources.length, addedCount: added, updatedCount: updated, offlineCount: offline, failedCount: failed, conflictCount: conflicts };
      const status = failed ? 'FAILED' : 'SUCCEEDED';
      await client.query(`UPDATE provider_sync_tasks SET status=$2,finished_at=now(),fetched_count=$3,added_count=$4,updated_count=$5,
        offline_count=$6,failed_count=$7,conflict_count=$8,result=$9,error_message=$10 WHERE id=$1`,
        [task.id, status, snapshot.resources.length, added, updated, offline, failed, conflicts, result, failed ? 'RESOURCE_MAPPING_REQUIRES_REVIEW' : null]);
      await client.query(`UPDATE provider_projects SET sync_status=$3,last_sync_finished_at=now(),last_sync_result=$4,
        synced_at=CASE WHEN $3='SUCCEEDED' THEN now() ELSE synced_at END,
        consecutive_sync_failures=CASE WHEN $3='FAILED' THEN consecutive_sync_failures+1 ELSE 0 END,last_sync_error=$5
        WHERE provider=$1 AND external_project_id=$2`, [task.provider, task.external_project_id, status, result, failed ? 'RESOURCE_MAPPING_REQUIRES_REVIEW' : null]);
      return { taskId: task.id, status, ...result };
    });
  }

  private async checkResource(client: PoolClient, task: Task, externalId: string, numberId: string, status: string, expiresAt: string | null, missing = false) {
    const { rows: allocations } = await client.query<{ id: string; user_id: string; order_id: string | null; expires_at: Date }>(`SELECT id,user_id,order_id,expires_at
      FROM number_allocations WHERE number_id=$1 AND released_at IS NULL AND expires_at>now() ORDER BY id`, [numberId]);
    const affected = allocations.filter(a => status !== 'ONLINE' || !expiresAt || Date.parse(expiresAt) < a.expires_at.getTime());
    const problem = missing ? 'RESOURCE_MISSING' : status !== 'ONLINE' ? 'RESOURCE_UNAVAILABLE'
      : (!expiresAt || Date.parse(expiresAt) < Date.now() + 7 * 86400000 || affected.length) ? 'RESOURCE_EXPIRED' : null;
    if (problem) return this.openConflict(client, task, externalId, numberId, problem, { status, resourceExpiresAt: expiresAt,
      affected: affected.map(a => ({ allocationId: a.id, userId: a.user_id, orderId: a.order_id, expiresAt: a.expires_at.toISOString(),
        shortfallDays: expiresAt ? Math.max(0, Math.ceil((a.expires_at.getTime() - Date.parse(expiresAt)) / 86400000)) : null })) });
    await client.query(`UPDATE provider_sync_conflicts SET status='RESOLVED',resolved_at=now(),resolution='Resource healthy after sync',last_seen_at=now()
      WHERE provider=$1 AND external_project_id=$2 AND external_number_id=$3 AND status='OPEN'`, [task.provider, task.external_project_id, externalId]);
    return 0;
  }
  private async openConflict(client: PoolClient, task: Task, externalId: string, numberId: string | null, type: string, details: unknown) {
    const { rows } = await client.query<{ inserted: boolean }>(`INSERT INTO provider_sync_conflicts(task_id,provider,external_project_id,external_number_id,number_id,conflict_type,details)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider,external_project_id,external_number_id,conflict_type) WHERE status='OPEN'
      DO UPDATE SET task_id=EXCLUDED.task_id,number_id=EXCLUDED.number_id,details=EXCLUDED.details,last_seen_at=now() RETURNING (xmax=0) AS inserted`,
      [task.id, task.provider, task.external_project_id, externalId, numberId, type, details]);
    return rows[0]!.inserted ? 1 : 0;
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
