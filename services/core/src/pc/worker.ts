import { randomUUID } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { WebhookInbox } from '../providers/webhook-inbox.js';
import { MockPcFailure, MockPcProvider, MockPcSnapshotFailure } from './mock-provider.js';
import { PcHttpFailure, PcHttpProvider, PcHttpSnapshotFailure } from './http-provider.js';
import { z } from 'zod';
import type { ProviderInbound } from '../providers/pingcode-adapter.js';
import type { ConnectionRow, PcResource, MockSnapshotProgress, PcMessageCheckpoint } from './model.js';
import { ApiFailure } from '../http.js';
import { claimSnapshotTasks, completeSnapshotTasks, failSnapshotTasks, recoverSnapshotTasks, type ExistingSnapshotResource } from './snapshot-tasks.js';
import { linePoolWaitServiceScope } from './connections.js';
import { LocalPlatformInventory } from './local-inventory.js';

/** Database claims fence independent workers; only this explicit worker lifecycle calls the ongoing provider. */
@Injectable()
export class PcWorker implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly db: Database, private readonly environment: Environment,
    private readonly provider: MockPcProvider, private readonly inbox: WebhookInbox,
    private readonly http: PcHttpProvider, private readonly localInventory: LocalPlatformInventory) {}
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  onApplicationBootstrap() {
    if (!this.environment.isWorker || !this.environment.isModuleEnabled(this.environment.product)) return;
    this.timer = setInterval(() => this.schedule(), 1000);
    this.schedule();
  }
  private schedule() {
    if (this.stopping || this.running) return;
    this.running = this.cycle().catch(() => { console.error('PC worker cycle failed; durable claims retained for recovery'); })
      .finally(() => { this.running = undefined; });
  }
  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }
  private get scope() { return [this.environment.siteId, this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]; }
  private async cycle() {
    const connectionIds = this.environment.values.PC_WORKER_CONNECTION_IDS;
    await recoverSnapshotTasks(this.db, this.scope, this.environment.pcProvider, connectionIds);
    // An abandoned single-use refresh cannot be replayed, even if its original access token still appears valid.
    await this.db.query(`UPDATE upstream_accounts SET auth_status='UNKNOWN',problem='REFRESH_RESULT_UNKNOWN',refresh_token=NULL,
      refresh_claim_id=NULL,refresh_claim_deadline=NULL,token_version = (1 + token_version)
      WHERE storefront_id=$1 AND application_id=$2 AND issuer=$3 AND NOT historical_only
        AND provider=$4 AND auth_status='REFRESHING' AND refresh_claim_deadline<=now()
        AND (cardinality($5::uuid[])=0 OR id=ANY($5::uuid[]))`, [...this.scope, this.environment.pcProvider, connectionIds]);
    await this.db.query(`UPDATE upstream_accounts SET auth_status='REAUTH_REQUIRED',problem='REFRESH_DEADLINE_EXPIRED',refresh_token=NULL,
      token_version = (1 + token_version),poll_claim_id=NULL,poll_claim_deadline=NULL,poll_version=poll_version+1
      WHERE storefront_id=$1 AND application_id=$2 AND issuer=$3 AND NOT historical_only AND auth_status='ACTIVE'
        AND provider=$4 AND (refresh_expires_at IS NULL OR refresh_expires_at<=now() OR refresh_token IS NULL)
        AND (cardinality($5::uuid[])=0 OR id=ANY($5::uuid[]))`, [...this.scope, this.environment.pcProvider, connectionIds]);
    // Read-only source calls and inbox writes are idempotent; a lost poll resumes from its last committed cursor.
    await this.db.query(`UPDATE upstream_accounts SET poll_claim_id=NULL,poll_claim_deadline=NULL,poll_version=poll_version+1,next_poll_at=now()
      WHERE storefront_id=$1 AND application_id=$2 AND issuer=$3 AND provider=$4 AND NOT historical_only AND poll_claim_deadline<=now()
        AND (cardinality($5::uuid[])=0 OR id=ANY($5::uuid[]))`, [...this.scope, this.environment.pcProvider, connectionIds]);
    await this.db.query('DELETE FROM pc_wait_demands WHERE waiting_until<=now()');
    for (let index = 0; index < 20 && !this.stopping; index++) {
      const claimId = randomUUID();
      const { rows: [claimed] } = await this.db.query<ConnectionRow>(`WITH candidate AS (
        SELECT id FROM upstream_accounts WHERE storefront_id=$1 AND application_id=$2 AND issuer=$3
          AND provider=$6 AND status='ACTIVE' AND NOT historical_only AND auth_status='ACTIVE'
          AND refresh_claim_id IS NULL AND poll_claim_id IS NULL AND refresh_expires_at>now()
          AND (access_expires_at IS NULL OR access_expires_at<=now()+$4*interval '1 second')
          AND (access_expires_at IS NULL OR access_expires_at<refresh_expires_at)
          AND (cardinality($7::uuid[])=0 OR id=ANY($7::uuid[]))
        ORDER BY access_expires_at NULLS FIRST,id FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE upstream_accounts a SET auth_status='REFRESHING',refresh_claim_id=$5,refresh_claim_deadline=now()+interval '30 seconds',
          token_version = (1 + a.token_version) FROM candidate c WHERE a.id=c.id RETURNING a.*`,
      [...this.scope, this.environment.values.PC_REFRESH_EARLY_SECONDS, claimId, this.environment.pcProvider, connectionIds]);
      if (!claimed) break;
      await this.refresh(claimed);
    }
    for (let index = 0; index < 20 && !this.stopping; index++) {
      const claimId = randomUUID();
      const { rows: [claimed] } = await this.db.query<ConnectionRow>(`WITH candidate AS (
        SELECT id FROM upstream_accounts WHERE storefront_id=$1 AND application_id=$2 AND issuer=$3 AND NOT historical_only
          AND provider=$5 AND status='ACTIVE' AND auth_status='ACTIVE' AND access_expires_at>now()
          AND refresh_claim_id IS NULL AND poll_claim_id IS NULL AND cardinality(enabled_capabilities)>0
          AND (next_poll_at IS NULL OR next_poll_at<=now())
          AND (cardinality($6::uuid[])=0 OR id=ANY($6::uuid[]))
        ORDER BY next_poll_at NULLS FIRST,id FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE upstream_accounts a SET poll_claim_id=$4,poll_claim_deadline=now()+interval '60 seconds',poll_version=a.poll_version+1,next_poll_at=NULL
          FROM candidate c WHERE a.id=c.id RETURNING a.*`, [...this.scope, claimId, this.environment.pcProvider, connectionIds]);
      if (!claimed) break;
      await this.poll(claimed);
    }
  }
  private async refresh(connection: ConnectionRow) {
    try {
      if (!connection.refresh_token) throw new MockPcFailure('REJECTED', 'REFRESH_TOKEN_MISSING');
      const tokens = await (connection.provider === 'pingcode' ? this.http : this.provider).refresh(connection.refresh_token);
      await this.db.query(`UPDATE upstream_accounts SET access_token=$4,refresh_token=$5,access_expires_at=$6,
        refresh_expires_at=LEAST(refresh_expires_at,$7::timestamptz),auth_status='ACTIVE',problem=NULL,
        refresh_claim_id=NULL,refresh_claim_deadline=NULL,token_version = (1 + token_version),next_poll_at=now()
        WHERE id=$1 AND refresh_claim_id=$2 AND token_version=$3 AND auth_status='REFRESHING' AND refresh_claim_deadline>now()`,
      [connection.id, connection.refresh_claim_id, connection.token_version, tokens.accessToken, tokens.refreshToken,
        tokens.accessExpiresAt, tokens.refreshExpiresAt]);
    } catch (failure) {
      const rejected = (failure instanceof MockPcFailure || failure instanceof PcHttpFailure) && failure.outcome === 'REJECTED';
      await this.db.query(`UPDATE upstream_accounts SET auth_status=$4,problem=$5,refresh_token=NULL,
        refresh_claim_id=NULL,refresh_claim_deadline=NULL,token_version = (1 + token_version)
        WHERE id=$1 AND refresh_claim_id=$2 AND token_version=$3 AND auth_status='REFRESHING'`,
      [connection.id, connection.refresh_claim_id, connection.token_version, rejected ? 'REAUTH_REQUIRED' : 'UNKNOWN',
        rejected ? 'REFRESH_REJECTED' : 'REFRESH_RESULT_UNKNOWN']);
    }
  }
  private async liveClaim(client: PoolClient, connection: ConnectionRow) {
    const { rows: [current] } = await client.query<ConnectionRow>(`SELECT * FROM upstream_accounts WHERE id=$1 AND poll_claim_id=$2
      AND poll_version=$3 AND token_version=$4 AND auth_status='ACTIVE' AND status='ACTIVE' AND NOT historical_only
      AND poll_claim_deadline>now() FOR UPDATE`, [connection.id, connection.poll_claim_id, connection.poll_version, connection.token_version]);
    return current;
  }
  private async poll(connection: ConnectionRow) {
    let snapshotProgress: MockSnapshotProgress | null = null;
    try {
      const tasks = await this.db.transaction(async client => {
        if (!await this.liveClaim(client, connection)) return null;
        return claimSnapshotTasks(client, connection);
      });
      if (!tasks) return;
      if (!connection.access_token) throw new MockPcFailure('REJECTED', 'ACCESS_TOKEN_MISSING');
      // Real LinePool: PC returns numbers only; a shop connection's platform slots come from LinePool-local projects.
      const realLinePool = connection.provider === 'pingcode' && this.environment.siteId === 'linepool';
      const localSelfService = realLinePool && connection.owner_kind === 'SELF_SERVICE';
      const snapshot = connection.provider === 'pingcode'
        ? await this.http.snapshot(connection.access_token, connection.external_account_id, () => this.extendClaim(connection))
        : await this.provider.snapshot(connection.access_token, connection.external_account_id);
      snapshotProgress = snapshot.progress;
      if (!snapshot.progress.complete) throw new Error('PC_SNAPSHOT_INCOMPLETE');
      const synced = await this.db.transaction(async client => {
        const current = await this.liveClaim(client, connection);
        if (!current) return false;
        const { rows: before } = await client.query<ExistingSnapshotResource>(`SELECT n.id AS number_id,b.external_number_id,b.external_project_id
          FROM phone_numbers n LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=$2
          WHERE n.upstream_account_id=$1`, [connection.id, connection.provider]);
        const seen: string[] = [];
        for (const source of snapshot.resources) {
          const numberId = await this.persistResource(client, connection, source);
          if (numberId !== null) seen.push(numberId);
        }
        // Disappearance is applied only after the entire successful snapshot has committed its resources.
        await client.query(`UPDATE phone_numbers SET source_missing=true,resource_status='OFFLINE'
          WHERE upstream_account_id=$1 AND NOT(id=ANY($2::uuid[]))`, [connection.id, seen]);
        await client.query(`UPDATE number_platforms SET is_available=false,synced_at=now()
          WHERE number_id IN (SELECT id FROM phone_numbers WHERE upstream_account_id=$1 AND source_missing)`, [connection.id]);
        await client.query(`INSERT INTO pc_connection_issues(connection_id,number_id,kind)
          SELECT $1,id,'SOURCE_MISSING' FROM phone_numbers WHERE upstream_account_id=$1 AND source_missing
          ON CONFLICT(connection_id,number_id,kind) DO UPDATE SET last_seen_at=now(),resolved_at=NULL`, [connection.id]);
        if (realLinePool) await this.localInventory.reconcile(client, connection.id);
        await completeSnapshotTasks(client, connection, tasks, snapshot.resources, before, seen, snapshot.progress);
        await client.query(`UPDATE upstream_accounts SET last_synced_at=now(),poll_claim_deadline=now()+interval '60 seconds'
          WHERE id=$1 AND poll_claim_id=$2 AND poll_version=$3`, [connection.id, connection.poll_claim_id, connection.poll_version]);
        return true;
      });
      if (!synced) return;
      // Self-service code receiving through PC messages is not enabled yet; only agent connections import messages.
      if (connection.provider === 'pingcode') { if (!localSelfService) await this.pollRealMessages(connection); }
      else {
      let cursor = connection.message_cursor;
      // A bounded batch preserves its durable cursor and continues next cadence without dropping later pages.
      for (let page = 0; page < 10 && !this.stopping; page++) {
        const valid = await this.db.query(`SELECT id FROM upstream_accounts WHERE id=$1 AND poll_claim_id=$2 AND poll_version=$3
          AND token_version=$4 AND auth_status='ACTIVE' AND poll_claim_deadline>now()`,
        [connection.id, connection.poll_claim_id, connection.poll_version, connection.token_version]);
        if (!valid.rowCount) return;
        const messages = await this.provider.messages(connection.access_token, connection.external_account_id, cursor);
        for (const item of messages) {
          await this.routeMessage(connection, item.message);
          const saved = await this.db.query(`UPDATE upstream_accounts SET message_cursor=$5,poll_claim_deadline=now()+interval '60 seconds'
            WHERE id=$1 AND poll_claim_id=$2 AND poll_version=$3 AND token_version=$4 AND auth_status='ACTIVE'`,
          [connection.id, connection.poll_claim_id, connection.poll_version, connection.token_version, item.cursor]);
          if (!saved.rowCount) return;
          cursor = item.cursor;
        }
        if (messages.length < 100) break;
      }
      }
      await this.db.query(`UPDATE upstream_accounts c SET poll_claim_id=NULL,poll_claim_deadline=NULL,
        next_poll_at=COALESCE(next_poll_at,CASE WHEN EXISTS(SELECT 1 FROM provider_sync_tasks WHERE upstream_account_id=$1 AND status='PENDING') THEN now()
          ELSE now()+(CASE WHEN EXISTS(SELECT 1 FROM pc_wait_demands d JOIN sessions s ON s.token_hash=d.session_hash
          JOIN users u ON u.id=s.user_id WHERE d.connection_id=$1 AND d.waiting_until>now() AND s.expires_at>now()
          AND (c.owner_kind='AGENT' OR (c.external_account_id=$7 AND ${this.environment.siteId === 'linepool'
            ? `EXISTS(SELECT 1 FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id
              WHERE a.id=d.allocation_id AND n.id=d.number_id AND ${linePoolWaitServiceScope(this.environment.pcProvider)})` : 'false'})))
          THEN $5::integer ELSE $6::integer END)*interval '1 second' END),
        problem=CASE WHEN EXISTS(SELECT 1 FROM pc_connection_issues WHERE connection_id=$1 AND resolved_at IS NULL) THEN 'SOURCE_RESOURCE_ISSUE'
          WHEN EXISTS(SELECT 1 FROM provider_event_receipts WHERE upstream_account_id=$1 AND status='QUARANTINED') THEN 'INBOX_QUARANTINED'
          WHEN EXISTS(SELECT 1 FROM provider_event_receipts WHERE upstream_account_id=$1 AND status='FAILED') THEN 'INBOX_RETRY_PENDING' ELSE NULL END
        WHERE id=$1 AND poll_claim_id=$2 AND poll_version=$3 AND token_version=$4 AND auth_status='ACTIVE'`,
      [connection.id, connection.poll_claim_id, connection.poll_version, connection.token_version,
        this.environment.values.PC_POLL_WAIT_SECONDS, this.environment.values.PC_POLL_IDLE_SECONDS, this.environment.selfServiceExternalAccountId]);
    } catch (failure) {
      const rejected = (failure instanceof MockPcFailure || failure instanceof PcHttpFailure) && failure.outcome === 'REJECTED';
      const refreshAccess = connection.provider === 'pingcode' && failure instanceof PcHttpFailure && failure.status === 401;
      const reason = failure instanceof MockPcSnapshotFailure || failure instanceof PcHttpSnapshotFailure ? failure.reason
        : failure instanceof PcHttpFailure ? failure.reason : rejected ? 'PC_ACCESS_REJECTED' : 'PC_SNAPSHOT_FAILED';
      await this.db.transaction(client => failSnapshotTasks(client, connection, reason,
        failure instanceof MockPcSnapshotFailure || failure instanceof PcHttpSnapshotFailure ? failure.snapshot : snapshotProgress));
      await this.db.query(`UPDATE upstream_accounts SET poll_claim_id=NULL,poll_claim_deadline=NULL,
        next_poll_at=CASE WHEN $7 THEN now() ELSE COALESCE(next_poll_at,now()+$5*interval '1 second') END,
        auth_status=CASE WHEN $6 AND NOT $7 THEN 'REAUTH_REQUIRED' ELSE auth_status END,
        access_expires_at=CASE WHEN $7 THEN now() ELSE access_expires_at END,
        problem=CASE WHEN $7 THEN 'ACCESS_REFRESH_REQUIRED' WHEN $6 THEN 'PROVIDER_ACCESS_REJECTED' ELSE $8 END
        WHERE id=$1 AND poll_claim_id=$2 AND poll_version=$3 AND token_version=$4 AND auth_status='ACTIVE'`,
      [connection.id, connection.poll_claim_id, connection.poll_version, connection.token_version,
        this.environment.values.PC_POLL_IDLE_SECONDS, rejected, refreshAccess, reason]);
    }
  }
  private async extendClaim(connection: ConnectionRow) {
    const changed = await this.db.query(`UPDATE upstream_accounts SET poll_claim_deadline=now()+interval '60 seconds'
      WHERE id=$1 AND poll_claim_id=$2 AND poll_version=$3 AND token_version=$4 AND auth_status='ACTIVE'
        AND status='ACTIVE' AND NOT historical_only AND poll_claim_deadline>now()`,
    [connection.id, connection.poll_claim_id, connection.poll_version, connection.token_version]);
    if (!changed.rowCount) throw new Error('PC_POLL_CLAIM_LOST');
  }
  private async routeMessage(connection: ConnectionRow, message: ProviderInbound) {
    if (connection.provider === 'pingcode') await this.extendClaim(connection);
    const { rows: [binding] } = await this.db.query<{ number_id: string; external_project_id: string | null }>(`SELECT b.number_id,b.external_project_id
      FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id
      WHERE b.provider=$1 AND b.external_number_id=$2 AND n.upstream_account_id=$3`,
    [connection.provider, message.externalNumberId, connection.id]);
    if (!binding && connection.provider !== 'pingcode') throw new Error('PC_MESSAGE_RESOURCE_UNCONFIRMED');
    try {
      if (!binding) {
        const quarantined = await this.inbox.quarantineUnmappedInbound(connection.id, message);
        if (quarantined.status !== 'QUARANTINED') throw new Error('PC_MESSAGE_NOT_DURABLY_ROUTED');
        return;
      }
      const ingested = await this.inbox.ingestTrusted({ connectionId: connection.id, upstreamAccountId: connection.id,
        numberId: binding.number_id, ...(connection.agent_id ? { ownerAgentId: connection.agent_id } : {}),
        ...(binding.external_project_id ? { externalProjectId: binding.external_project_id } : {}) }, message);
      if (!['IMPORTED', 'UNMATCHED', 'IGNORED', 'FAILED', 'QUARANTINED'].includes(ingested.status)) throw new Error('PC_MESSAGE_NOT_DURABLY_ROUTED');
    } catch (failure) {
      const payload = failure instanceof ApiFailure ? failure.getResponse() : null;
      const code = typeof payload === 'object' && payload !== null && 'error' in payload
        && typeof payload.error === 'object' && payload.error !== null && 'code' in payload.error ? payload.error.code : null;
      if (code !== 'PROVIDER_EVENT_CONFLICT' && code !== 'PROVIDER_MESSAGE_CONFLICT') throw failure;
    }
  }
  private async pollRealMessages(connection: ConnectionRow) {
    const timestamp = z.iso.datetime({ offset: true });
    const checkpointSchema = z.object({ version: z.literal(1), completedThrough: timestamp.nullable(),
      scan: z.object({ createdAfter: timestamp.nullable(), cursor: z.string().min(1), headCreatedAt: timestamp.nullable() }).nullable() });
    let checkpoint: PcMessageCheckpoint = connection.message_checkpoint == null
      ? { version: 1, completedThrough: null, scan: null } : checkpointSchema.parse(connection.message_checkpoint);
    const cursors = new Set<string>();
    if (checkpoint.scan) cursors.add(checkpoint.scan.cursor);
    for (let page = 0; page < 10 && !this.stopping; page++) {
      await this.extendClaim(connection);
      // Freeze the lower bound for the entire descending scan. The next scan starts at its head,
      // with a one-millisecond overlap so strict createdAfter filtering cannot drop timestamp ties.
      const createdAfter = checkpoint.scan?.createdAfter ?? (checkpoint.completedThrough
        ? new Date(Date.parse(checkpoint.completedThrough) - 1).toISOString() : null);
      const result = await this.http.messages(connection.access_token!, {
        ...(checkpoint.scan ? { cursor: checkpoint.scan.cursor } : {}), ...(createdAfter ? { createdAfter } : {}) });
      let headCreatedAt = checkpoint.scan?.headCreatedAt ?? null;
      for (const message of result.messages) {
        if (!message.upstreamCreatedAt) throw new Error('PC_MESSAGE_CREATED_AT_MISSING');
        if (!headCreatedAt || Date.parse(message.upstreamCreatedAt) > Date.parse(headCreatedAt)) headCreatedAt = message.upstreamCreatedAt;
        await this.routeMessage(connection, message);
      }
      const nextCursor = result.page.hasMore ? result.page.nextCursor! : null;
      if (nextCursor && cursors.has(nextCursor)) throw new Error('PC_CURSOR_REPEATED');
      const next: PcMessageCheckpoint = { version: 1,
        completedThrough: nextCursor ? checkpoint.completedThrough : headCreatedAt ?? checkpoint.completedThrough,
        scan: nextCursor ? { createdAfter, cursor: nextCursor, headCreatedAt } : null };
      // Every item has a committed durable route before this page cursor can advance.
      const saved = await this.db.query(`UPDATE upstream_accounts SET message_checkpoint=$5::jsonb,poll_claim_deadline=now()+interval '60 seconds'
        WHERE id=$1 AND poll_claim_id=$2 AND poll_version=$3 AND token_version=$4 AND auth_status='ACTIVE' AND poll_claim_deadline>now()`,
      [connection.id, connection.poll_claim_id, connection.poll_version, connection.token_version, JSON.stringify(next)]);
      if (!saved.rowCount) throw new Error('PC_POLL_CLAIM_LOST');
      checkpoint = next;
      if (!nextCursor) break;
      cursors.add(nextCursor);
    }
  }
  private async persistResource(client: PoolClient, account: ConnectionRow, source: PcResource) {
    if (source.resource_expires_at !== null && !Number.isFinite(source.resource_expires_at.getTime())) throw new Error('PC_RESOURCE_EXPIRY_UNCONFIRMED');
    if (this.environment.siteId === 'linepool' && account.provider === 'pingcode-mock') {
      if (!source.external_project_id || !source.platform_id) throw new Error('PC_PLATFORM_PROJECT_UNCONFIRMED');
      await client.query(`INSERT INTO provider_projects(provider,external_project_id,platform_id,project_name,upstream_account_id)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,external_project_id) DO NOTHING`,
      [account.provider, source.external_project_id, source.platform_id, `Mock ${source.platform_id}`, account.id]);
      const project = await client.query(`SELECT external_project_id FROM provider_projects WHERE provider=$1 AND external_project_id=$2
        AND platform_id=$3 AND upstream_account_id=$4`, [account.provider, source.external_project_id, source.platform_id, account.id]);
      if (!project.rowCount) throw new Error('PC_PROJECT_ACCOUNT_CONFLICT');
    } else if (source.external_project_id !== null || source.platform_id !== null) throw new Error('PC_WHOLE_PROJECT_INVALID');
    const { rows: [bound] } = await client.query<{ number_id: string; upstream_account_id: string; phone_number: string; region_id: string;
      external_project_id: string | null }>(`SELECT b.number_id,b.external_project_id,n.upstream_account_id,n.phone_number,n.region_id
      FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id WHERE b.provider=$1 AND b.external_number_id=$2 FOR UPDATE OF n`,
    [account.provider, source.external_number_id]);
    let numberId = bound?.number_id;
    if (bound && (bound.upstream_account_id !== account.id || (source.phone_number !== null && bound.phone_number !== source.phone_number)
      || bound.region_id !== source.region_id || bound.external_project_id !== source.external_project_id)) throw new Error('PC_RESOURCE_ACCOUNT_CONFLICT');
    const available = source.phone_number !== null && source.source_available && (source.resource_expires_at === null || source.resource_expires_at.getTime() > Date.now());
    if (!numberId) {
      // Inactive upstream records can omit a phone; retain existing bindings without inventing a new number.
      if (source.phone_number === null) return null;
      const { rows: [created] } = await client.query<{ id: string; upstream_account_id: string; region_id: string }>(`INSERT INTO phone_numbers
        (upstream_account_id,region_id,phone_number,resource_status,resource_expires_at,pc_capabilities,capability)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(phone_number) DO NOTHING RETURNING id,upstream_account_id,region_id`,
      [account.id, source.region_id, source.phone_number, available ? 'ONLINE' : 'OFFLINE', source.resource_expires_at,
        source.capabilities, source.capabilities.includes('SEND_SMS') ? 'SEND_RECEIVE' : 'RECEIVE']);
      const existing = created ?? (await client.query<{ id: string; upstream_account_id: string; region_id: string }>(
        'SELECT id,upstream_account_id,region_id FROM phone_numbers WHERE phone_number=$1 FOR UPDATE', [source.phone_number])).rows[0];
      if (!existing || existing.upstream_account_id !== account.id || existing.region_id !== source.region_id) throw new Error('PC_PHONE_ACCOUNT_CONFLICT');
      numberId = existing.id;
      await client.query(`INSERT INTO provider_resource_bindings(provider,external_number_id,number_id,external_project_id)
        VALUES($1,$2,$3,$4)`, [account.provider, source.external_number_id, numberId, source.external_project_id]);
    }
    await client.query(`UPDATE phone_numbers SET source_missing=false,resource_status=$2,resource_expires_at=$3,pc_capabilities=$4,
      capability=$5 WHERE id=$1 AND upstream_account_id=$6`, [numberId, available ? 'ONLINE' : 'OFFLINE', source.resource_expires_at,
      source.capabilities, source.capabilities.includes('SEND_SMS') ? 'SEND_RECEIVE' : 'RECEIVE', account.id]);
    if (source.platform_id && source.external_project_id) {
      await client.query(`INSERT INTO number_platforms(number_id,platform_id,provider,external_project_id,is_available)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(number_id,platform_id) DO UPDATE SET is_available=EXCLUDED.is_available,synced_at=now()`,
      [numberId, source.platform_id, account.provider, source.external_project_id, available]);
    }
    await client.query(`UPDATE pc_connection_issues SET resolved_at=now() WHERE connection_id=$1 AND number_id=$2 AND resolved_at IS NULL`, [account.id, numberId]);
    if (!available) {
      await client.query(`INSERT INTO pc_connection_issues(connection_id,number_id,kind) VALUES($1,$2,$3)
        ON CONFLICT(connection_id,number_id,kind) DO UPDATE SET last_seen_at=now(),resolved_at=NULL`,
      [account.id, numberId, source.resource_expires_at !== null && source.resource_expires_at.getTime() <= Date.now() ? 'RESOURCE_EXPIRED' : 'SOURCE_UNAVAILABLE']);
    }
    return numberId;
  }
}
