import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database.js';
import { ProviderSyncService } from '../provider-sync.js';
import { OnceAdminOperations, adminReason, conflict, parse } from './admin-operations.js';

const latestSyncSql = `SELECT id AS "taskId",mode,status,fetched_count AS fetched,added_count AS imported,
  updated_count AS refreshed,offline_count AS unavailable,conflict_count AS conflicts,error_message AS "errorCode",
  created_at AS "createdAt",finished_at AS "finishedAt" FROM provider_sync_tasks
  WHERE scope_kind='ACCOUNT' AND upstream_account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`;

/** Administration reads local facts; only the worker fetches upstream inventory. */
@Injectable()
export class OnceIntegration {
  constructor(private readonly db: Database, private readonly operations: OnceAdminOperations,
    private readonly syncService: ProviderSyncService) {}

  async overview() {
    const account = await this.operations.findAccount();
    if (!account) return {
      provider: this.operations.provider, name: this.operations.provider === 'pingcode' ? 'PinClode' : 'ONCE Mock',
      configured: false, enabled: false, accountId: null, authorizationStatus: 'UNAUTHORIZED', authorized: false,
      accessExpiresAt: null, problem: 'ONCE_ACCOUNT_UNAVAILABLE', demoMode: this.operations.provider === 'pingcode-mock',
      transport: this.operations.provider === 'pingcode' ? 'application-api' : 'database-mock', receivingMode: 'worker-polling',
      mappedNumbers: 0, receiveUrl: '/api/once/webhooks/pingcode/receive', sendUrl: '/api/once/webhooks/pingcode/send',
      credentialsEditable: false, apiKeyConfigured: false, receiveSecretConfigured: false, sendSecretConfigured: false,
      publicHttps: false, lastEvent: null, lastSync: null, lastCheck: null,
      capabilities: { numbers: false, receiveSms: false, sendSms: false,
        sendStatus: this.operations.provider === 'pingcode' ? 'upstream-task-polling' : 'durable-mock', purchase: false, renew: false },
      enabledCapabilities: [],
      deliveryNote: 'Configure and authorize the separate platform self-service connection before synchronizing inventory. Existing users and history remain available.',
    };
    const authorized=account.status==='ACTIVE'&&account.auth_status==='ACTIVE'
      &&account.access_expires_at!==null&&account.access_expires_at.getTime()>Date.now();
    const [mapped, lastSync, lastCheck, lastEvent] = await Promise.all([
      this.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM phone_numbers n
        JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=$2 AND b.external_project_id IS NULL
        WHERE n.upstream_account_id=$1`, [account.id, account.provider]),
      this.db.query(latestSyncSql, [account.id]),
      this.db.query(`SELECT after_data AS result,created_at AS "checkedAt" FROM admin_audit
        WHERE action='ONCE_INTEGRATION_CHECK' AND target_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [account.id]),
      this.db.query(`SELECT status,received_at AS "receivedAt" FROM provider_event_receipts
        WHERE upstream_account_id=$1 AND provider=$2 ORDER BY received_at DESC,id DESC LIMIT 1`, [account.id, account.provider]),
    ]);
    return {
      provider: account.provider, name: account.provider === 'pingcode' ? 'PinClode' : 'ONCE Mock', configured: true, enabled: account.status === 'ACTIVE',
      accountId: account.external_account_id, authorizationStatus:account.auth_status, authorized,
      accessExpiresAt:account.access_expires_at, problem:account.problem,
      demoMode: account.provider === 'pingcode-mock', transport: account.provider === 'pingcode' ? 'application-api' : 'database-mock', receivingMode: 'worker-polling',
      mappedNumbers: mapped.rows[0]!.count, receiveUrl: '/api/once/webhooks/pingcode/receive',
      sendUrl: '/api/once/webhooks/pingcode/send', credentialsEditable: false,
      apiKeyConfigured: false, receiveSecretConfigured: false, sendSecretConfigured: false, publicHttps: false,
      lastEvent: lastEvent.rows[0] ?? null, lastSync: lastSync.rows[0] ?? null,
      lastCheck: lastCheck.rows[0]?.result ?? null,
      capabilities: { numbers: true, receiveSms: account.capabilities.includes('NUMBER_LEASE'), sendSms: account.capabilities.includes('SEND_SMS'), sendStatus: account.provider === 'pingcode' ? 'upstream-task-polling' : 'durable-mock', purchase: false, renew: false },
      enabledCapabilities:account.enabled_capabilities,
      deliveryNote: account.provider === 'pingcode' ? 'The worker synchronizes connected PinClode inventory. Local rentals require confirmed resource coverage; PC resource purchases, renewals and transfers remain in PinClode.' : 'Local database Mock only. The worker processes queued syncs; resource purchases, upstream renewals and transfers happen in PC.',
    };
  }

  save(actorId: string, body: unknown, key: unknown) {
    this.operations.requireMock();
    const input = parse(z.strictObject({ enabled: z.boolean(), reason: adminReason }), body);
    return this.operations.mutate(actorId, 'ONCE_INTEGRATION_CONFIG_UPDATED', 'pingcode-mock', input, key, async client => {
      const account = await this.operations.account(client);
      await client.query('UPDATE upstream_accounts SET status=$2 WHERE id=$1', [account.id, input.enabled ? 'ACTIVE' : 'INACTIVE']);
      return { provider: 'pingcode-mock', enabled: input.enabled, credentialsEditable: false, transport: 'database-mock' };
    });
  }

  check(actorId: string, body: unknown, key: unknown) {
    const input = parse(z.strictObject({ reason: adminReason }), body);
    return this.operations.mutate(actorId, 'ONCE_INTEGRATION_CHECK', this.operations.provider, input, key, async client => {
      const account = await this.operations.account(client);
      const { rows: [state] } = await client.query<{ resourceCount: number; invalidResources: number }>(`SELECT count(*)::int AS "resourceCount",
        count(*) FILTER(WHERE b.external_number_id IS NULL OR b.external_project_id IS NOT NULL
          OR n.resource_expires_at IS NULL OR NOT isfinite(n.resource_expires_at)
          OR n.capability NOT IN ('RECEIVE','SEND_RECEIVE'))::int AS "invalidResources"
        FROM phone_numbers n LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=$2
        WHERE n.upstream_account_id=$1`, [account.id, account.provider]);
      const authorized=account.auth_status==='ACTIVE'&&account.access_expires_at!==null&&account.access_expires_at.getTime()>Date.now();
      const localReady = account.status === 'ACTIVE' && authorized && state!.invalidResources === 0;
      const result = { ok: localReady, connected: localReady, connectionKind: account.provider === 'pingcode' ? 'PERSISTED_APPLICATION_CONNECTION' : 'LOCAL_MOCK', liveConnectionVerified: false,
        authorizationStatus:account.auth_status,transport: account.provider === 'pingcode' ? 'application-api' : 'database-mock', checkedAt: new Date().toISOString(), ...state,
        code: account.status !== 'ACTIVE' ? 'ONCE_ACCOUNT_INACTIVE' : !authorized ? 'PC_REAUTH_REQUIRED' : state!.invalidResources ? 'PC_RESOURCE_INVALID' : null,
        message: 'Checked persisted connection and resource bindings. No provider request was made.' };
      await this.operations.audit(client, actorId, 'ONCE_INTEGRATION_CHECK', account.id, input.reason, null, result);
      return result;
    }, false);
  }

  async numbers() {
    const account = await this.operations.account();
    const { rows } = await this.db.query(`SELECT n.id,n.phone_number AS "phoneNumber",b.external_number_id AS "providerNumberId",
      n.resource_status AS status,n.resource_expires_at AS "resourceExpiresAt",n.region_id AS region,
      n.display_metadata->>'regionId' AS "regionId",n.display_metadata->>'regionName' AS "regionName",
      (b.external_number_id IS NOT NULL AND b.external_project_id IS NULL) AS imported
      FROM phone_numbers n LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=$2
      WHERE n.upstream_account_id=$1 ORDER BY n.phone_number,n.id`, [account.id, account.provider]);
    return { items: rows, total: rows.length, source: 'LOCAL_DATABASE', transport: account.provider === 'pingcode' ? 'application-api' : 'database-mock' };
  }

  sync(actorId: string, body: unknown, key: unknown) {
    const input = parse(z.strictObject({ mode: z.enum(['INCREMENTAL', 'FULL', 'MANUAL']).default('FULL'), reason: adminReason }), body);
    return this.operations.mutate(actorId, 'ONCE_INTEGRATION_SYNC', this.operations.provider, input, key, async client => {
      const account = await this.operations.account(client);
      if (account.status !== 'ACTIVE') throw conflict('ONCE_ACCOUNT_UNAVAILABLE', 'Trusted ONCE account is inactive');
      if(account.auth_status!=='ACTIVE'||account.access_expires_at===null||account.access_expires_at.getTime()<=Date.now()) {
        throw conflict('PC_REAUTH_REQUIRED','Authorize the configured connection before requesting a sync');
      }
      return this.syncService.enqueue({ scopeKind: 'ACCOUNT', provider: this.operations.provider,
        upstreamAccountId: account.id }, input.mode, actorId, input.reason, client);
    });
  }
}
