import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import type { ConnectionRow, PcResource, MockSnapshotProgress } from './model.js';

export type SnapshotTask = { id: string; scope_kind: 'PROJECT' | 'ACCOUNT'; external_project_id: string | null };
export type ExistingSnapshotResource = { number_id: string; external_number_id: string | null; external_project_id: string | null };

/** Called under the owning connection row lock, before the provider request leaves the transaction. */
export async function claimSnapshotTasks(client: PoolClient, connection: ConnectionRow) {
  const { rows } = await client.query<SnapshotTask>(`UPDATE provider_sync_tasks SET status='RUNNING',started_at=now(),pc_poll_claim_id=$3,
    error_message=NULL WHERE upstream_account_id=$1 AND provider=$2 AND status='PENDING' RETURNING id,scope_kind,external_project_id`,
  [connection.id, connection.provider, connection.poll_claim_id]);
  for (const task of rows) if (task.scope_kind === 'PROJECT') {
    await client.query(`UPDATE provider_projects SET sync_status='RUNNING',last_sync_started_at=now(),last_sync_error=NULL
      WHERE provider=$1 AND external_project_id=$2 AND upstream_account_id=$3`, [connection.provider, task.external_project_id, connection.id]);
  }
  return rows;
}

export async function completeSnapshotTasks(client: PoolClient, connection: ConnectionRow, tasks: SnapshotTask[],
  sources: PcResource[], before: ExistingSnapshotResource[], observedNumberIds: string[], snapshot: MockSnapshotProgress) {
  const observed = new Set(observedNumberIds);
  for (const task of tasks) {
    const resources = task.scope_kind === 'ACCOUNT' ? sources : sources.filter(source => source.external_project_id === task.external_project_id);
    const previous = task.scope_kind === 'ACCOUNT' ? before : before.filter(row => row.external_project_id === task.external_project_id);
    const priorIds = new Set(previous.map(row => row.external_number_id));
    let added = 0, updated = 0, unmapped = 0;
    for (const source of resources) {
      if (priorIds.has(source.external_number_id)) updated++;
      else if (source.phone_number !== null) added++;
      else unmapped++;
    }
    const missing = previous.filter(row => !observed.has(row.number_id));
    const offline = resources.filter(source => !source.source_available || (source.resource_expires_at !== null && source.resource_expires_at.getTime() <= Date.now())).length + missing.length;
    const { rows: issues } = await client.query<{ number_id: string; kind: string; external_number_id: string | null; resource_expires_at: Date | null }>(
      `SELECT i.number_id,i.kind,b.external_number_id,n.resource_expires_at FROM pc_connection_issues i JOIN phone_numbers n ON n.id=i.number_id
       LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=$2
       WHERE i.connection_id=$1 AND i.resolved_at IS NULL AND ($3::text IS NULL OR b.external_project_id=$3)`,
    [connection.id, connection.provider, task.external_project_id]);
    for (const issue of issues) {
      if (!issue.external_number_id) continue;
      const conflictType = issue.kind === 'SOURCE_MISSING' ? 'RESOURCE_MISSING' : issue.kind === 'RESOURCE_EXPIRED' ? 'RESOURCE_EXPIRED' : 'RESOURCE_UNAVAILABLE';
      const target = task.scope_kind === 'PROJECT'
        ? "(provider,external_project_id,external_number_id,conflict_type) WHERE scope_kind='PROJECT' AND status='OPEN'"
        : "(provider,external_number_id,conflict_type) WHERE scope_kind='ACCOUNT' AND status='OPEN'";
      await client.query(`INSERT INTO provider_sync_conflicts(task_id,provider,scope_kind,upstream_account_id,external_project_id,
        external_number_id,number_id,conflict_type,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        ON CONFLICT ${target} DO UPDATE SET last_seen_at=now(),details=EXCLUDED.details`,
      [task.id, connection.provider, task.scope_kind, connection.id, task.external_project_id, issue.external_number_id,
        issue.number_id, conflictType, JSON.stringify({ source: connection.provider === 'pingcode' ? 'PC_REAL_SNAPSHOT' : 'PC_MOCK_SNAPSHOT', resourceExpiresAt: issue.resource_expires_at?.toISOString() ?? null })]);
    }
    const failed = issues.filter(issue => !issue.external_number_id).length;
    const status = failed ? 'FAILED' : 'SUCCEEDED';
    const result = { source: connection.provider === 'pingcode' ? 'PC_REAL_SNAPSHOT' : 'PC_MOCK_SNAPSHOT', complete: true, fetchedCount: resources.length, addedCount: added,
      updatedCount: updated, unmappedCount: unmapped, offlineCount: offline, failedCount: failed, conflictCount: issues.length, snapshot };
    const changed = await client.query(`UPDATE provider_sync_tasks SET status=$3,finished_at=now(),fetched_count=$4,added_count=$5,updated_count=$6,
      offline_count=$7,failed_count=$8,conflict_count=$9,result=$10::jsonb,error_message=$11
      WHERE id=$1 AND pc_poll_claim_id=$2 AND status='RUNNING'`, [task.id, connection.poll_claim_id, status, result.fetchedCount,
      result.addedCount, result.updatedCount, offline, failed, issues.length, JSON.stringify(result), failed ? 'UNMAPPED_LOCAL_RESOURCE' : null]);
    if (changed.rowCount && task.scope_kind === 'PROJECT') {
      await client.query(`UPDATE provider_projects SET sync_status=$3,last_sync_finished_at=now(),last_sync_result=$4::jsonb,
        synced_at=CASE WHEN $3='SUCCEEDED' THEN now() ELSE synced_at END,last_sync_error=$5,
        consecutive_sync_failures=CASE WHEN $3='SUCCEEDED' THEN 0 ELSE consecutive_sync_failures+1 END
        WHERE provider=$1 AND external_project_id=$2 AND upstream_account_id=$6`,
      [connection.provider, task.external_project_id, status, JSON.stringify(result), failed ? 'UNMAPPED_LOCAL_RESOURCE' : null, connection.id]);
    }
  }
}

export async function failSnapshotTasks(client: PoolClient, connection: ConnectionRow, reason: string, snapshot: MockSnapshotProgress | null) {
  await client.query('SELECT id FROM upstream_accounts WHERE id=$1 FOR UPDATE', [connection.id]);
  const result = JSON.stringify({ status: 'FAILED', reason, snapshot });
  const { rows } = await client.query<SnapshotTask>(`UPDATE provider_sync_tasks SET status='FAILED',finished_at=now(),failed_count=1,
    error_message=$3,result=$4::jsonb
    WHERE upstream_account_id=$1 AND pc_poll_claim_id=$2 AND status='RUNNING' RETURNING id,scope_kind,external_project_id`,
  [connection.id, connection.poll_claim_id, reason, result]);
  for (const task of rows) if (task.scope_kind === 'PROJECT') {
    await client.query(`UPDATE provider_projects SET sync_status='FAILED',last_sync_finished_at=now(),last_sync_error=$3,
      last_sync_result=$4::jsonb,consecutive_sync_failures=consecutive_sync_failures+1
      WHERE provider=$1 AND external_project_id=$2 AND upstream_account_id=$5`,
    [connection.provider, task.external_project_id, reason, JSON.stringify({ taskId: task.id, status: 'FAILED', reason, snapshot }), connection.id]);
  }
}

/** A superseded or expired poll cannot later complete its queued admin tasks. */
export async function recoverSnapshotTasks(db: Database, scope: string[], provider: string, connectionIds: string[]) {
  await db.transaction(async client => {
    const { rows: accounts } = await client.query<{ id: string }>(`SELECT a.id FROM upstream_accounts a WHERE a.storefront_id=$1
      AND a.provider=$2 AND EXISTS(SELECT 1 FROM provider_sync_tasks t WHERE t.upstream_account_id=a.id AND t.provider=a.provider AND t.status IN ('PENDING','RUNNING'))
      AND (cardinality($3::uuid[])=0 OR a.id=ANY($3::uuid[]))
      ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT 100`, [scope[0], provider, connectionIds]);
    if (!accounts.length) return;
    const { rows } = await client.query<SnapshotTask & { provider: string; upstream_account_id: string }>(`UPDATE provider_sync_tasks t
      SET status='FAILED',finished_at=now(),failed_count=1,error_message='PC_POLL_UNAVAILABLE',
        result=jsonb_build_object('status','FAILED','reason','PC_POLL_UNAVAILABLE') FROM upstream_accounts a
      WHERE a.id=t.upstream_account_id AND a.storefront_id=$1 AND t.provider=$5 AND a.provider=t.provider AND t.status IN ('PENDING','RUNNING')
        AND a.id=ANY($4::uuid[])
        AND ((t.status='RUNNING' AND (t.pc_poll_claim_id IS NULL OR a.poll_claim_id IS DISTINCT FROM t.pc_poll_claim_id OR a.poll_claim_deadline<=now()))
          OR a.historical_only OR a.status<>'ACTIVE' OR a.auth_status IN ('UNAUTHORIZED','UNKNOWN','REAUTH_REQUIRED')
          OR a.application_id IS DISTINCT FROM $2 OR a.issuer IS DISTINCT FROM $3 OR cardinality(a.enabled_capabilities)=0)
      RETURNING t.id,t.scope_kind,t.external_project_id,t.provider,t.upstream_account_id`, [...scope, accounts.map(account => account.id), provider]);
    for (const task of rows) if (task.scope_kind === 'PROJECT') {
      await client.query(`UPDATE provider_projects SET sync_status='FAILED',last_sync_finished_at=now(),last_sync_error='PC_POLL_UNAVAILABLE',
        last_sync_result=jsonb_build_object('taskId',$3::text,'status','FAILED','reason','PC_POLL_UNAVAILABLE'),
        consecutive_sync_failures=consecutive_sync_failures+1 WHERE provider=$1 AND external_project_id=$2 AND upstream_account_id=$4`,
      [task.provider, task.external_project_id, task.id, task.upstream_account_id]);
    }
  });
}
