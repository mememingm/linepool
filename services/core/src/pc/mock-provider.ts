import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { PcCapability } from '@linepool/contracts';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import type { ProviderInbound } from '../providers/pingcode-adapter.js';
import { digest, type AuthState, type MockFixture, type MockResource, type MockSnapshotProgress, type MockTokens } from './model.js';

const opaque = () => randomBytes(32).toString('hex');
export class MockPcFailure extends Error {
  constructor(readonly outcome: 'REJECTED' | 'UNKNOWN', readonly reason: string) { super(reason); }
}
export class MockPcSnapshotFailure extends MockPcFailure {
  constructor(readonly snapshot: MockSnapshotProgress) { super('UNKNOWN', 'PC_MOCK_SNAPSHOT_PAGE_FAILED'); }
}
/** Entirely local provider facts. Authorization is an explicit sandbox action, never a live endpoint. */
@Injectable()
export class MockPcProvider {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  requireSandbox() {
    if (this.environment.values.PC_MODE !== 'mock' || this.environment.values.NODE_ENV === 'production' || !this.environment.values.LOCAL_SANDBOX) {
      throw new ApiFailure(503, 'PC_MOCK_UNAVAILABLE', 'Local Mock PinClode authorization requires the isolated local sandbox');
    }
  }
  get scope() { return [this.environment.siteId, this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]; }
  async ensureFixtures(client: PoolClient) {
    this.requireSandbox();
    const suffix = digest(this.scope.join(':')).slice(0, 12);
    const capabilities: PcCapability[] = this.environment.siteId === 'linepool' ? ['SMS_CODE'] : ['NUMBER_LEASE', 'SEND_SMS'];
    for (const [key, name, enabled] of [['agent-a', 'Mock Agent A', true], ['agent-b', 'Mock Agent B', true],
      ['not-enabled', 'Mock application not enabled', false], ['self-service', `${this.environment.siteName} Mock self-service`, true]] as const) {
      await client.query(`INSERT INTO pc_mock_fixtures(site_id,application_id,issuer,fixture_key,subject,external_account_id,
        display_name,application_enabled,owner_kind,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(site_id,application_id,issuer,fixture_key) DO NOTHING`, [...this.scope, key, `mock:${key}`,
        key === 'self-service' ? this.environment.selfServiceExternalAccountId : `pc-mock:${suffix}:${key}`,
        name, enabled, key === 'self-service' ? 'SELF_SERVICE' : 'AGENT', capabilities]);
    }
  }
  async choices(state: AuthState) {
    this.requireSandbox();
    const { rows } = await this.db.query<MockFixture>(`SELECT * FROM pc_mock_fixtures WHERE site_id=$1 AND application_id=$2 AND issuer=$3
      AND owner_kind=$4 ORDER BY fixture_key`, [...this.scope, state.purpose === 'SELF_SERVICE' ? 'SELF_SERVICE' : 'AGENT']);
    return rows;
  }
  async authorize(client: PoolClient, state: AuthState, fixtureKey: string) {
    this.requireSandbox();
    const { rows: [fixture] } = await client.query<MockFixture>(`SELECT * FROM pc_mock_fixtures
      WHERE site_id=$1 AND application_id=$2 AND issuer=$3 AND fixture_key=$4`, [...this.scope, fixtureKey]);
    if (!fixture || fixture.owner_kind !== (state.purpose === 'SELF_SERVICE' ? 'SELF_SERVICE' : 'AGENT')) {
      throw new ApiFailure(400, 'PC_FIXTURE_INVALID', 'Choose one of the configured Mock consent accounts');
    }
    const code = opaque();
    const result = await client.query(`INSERT INTO pc_mock_codes(code_hash,state_hash,fixture_key,expires_at)
      VALUES($1,$2,$3,LEAST($4::timestamptz,now()+interval '2 minutes')) ON CONFLICT(state_hash) DO NOTHING`,
    [digest(code), state.state_hash, fixture.fixture_key, state.expires_at]);
    if (!result.rowCount) throw new ApiFailure(409, 'PC_CODE_ALREADY_ISSUED', 'This consent request has already issued its one-time code');
    return code;
  }
  async exchange(client: PoolClient, state: AuthState, code: string) {
    this.requireSandbox();
    const { rows: [issued] } = await client.query<{ fixture_key: string }>(`UPDATE pc_mock_codes SET consumed_at=now()
      WHERE code_hash=$1 AND state_hash=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING fixture_key`, [digest(code), state.state_hash]);
    if (!issued) throw new ApiFailure(401, 'PC_CODE_INVALID', 'The authorization code is expired, used, or belongs to a different request');
    const { rows: [fixture] } = await client.query<MockFixture>(`SELECT * FROM pc_mock_fixtures
      WHERE site_id=$1 AND application_id=$2 AND issuer=$3 AND fixture_key=$4 FOR SHARE`, [...this.scope, issued.fixture_key]);
    if (!fixture) throw new ApiFailure(401, 'PC_CODE_INVALID', 'Mock authorization account is unavailable');
    if ((state.purpose === 'SELF_SERVICE') !== (fixture.owner_kind === 'SELF_SERVICE')
      || (state.expected_subject !== null && state.expected_subject !== fixture.subject)
      || (state.expected_external_account_id !== null && state.expected_external_account_id !== fixture.external_account_id)) {
      throw new ApiFailure(401, 'PC_IDENTITY_MISMATCH', 'Reauthorization must use the original account and subject');
    }
    if (!fixture.application_enabled) return { fixture, tokens: null };
    await client.query(`UPDATE pc_mock_grants SET revoked_at=now() WHERE site_id=$1 AND application_id=$2 AND issuer=$3
      AND subject=$4 AND revoked_at IS NULL`, [...this.scope, fixture.subject]);
    const tokens = await this.createGrant(client, fixture.subject, fixture.external_account_id);
    await this.ensureResources(client, fixture);
    return { fixture, tokens };
  }
  private async createGrant(client: PoolClient, subject: string, externalAccountId: string, parent?: { id: string; refresh_expires_at: Date }): Promise<MockTokens> {
    const accessToken = opaque(), refreshToken = opaque();
    const { rows: [grant] } = await client.query<{ access_expires_at: Date; refresh_expires_at: Date }>(`INSERT INTO pc_mock_grants
      (site_id,application_id,issuer,subject,external_account_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at,parent_grant_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,LEAST(now()+interval '1 hour',COALESCE($8::timestamptz,now()+interval '7 days')),
        COALESCE($8::timestamptz,now()+interval '7 days'),$9) RETURNING access_expires_at,refresh_expires_at`,
    [...this.scope, subject, externalAccountId, digest(accessToken), digest(refreshToken), parent?.refresh_expires_at ?? null, parent?.id ?? null]);
    if (!grant) throw new Error('MOCK_GRANT_NOT_SAVED');
    return { accessToken, refreshToken, accessExpiresAt: grant.access_expires_at, refreshExpiresAt: grant.refresh_expires_at };
  }
  async refresh(refreshToken: string) {
    this.requireSandbox();
    const result = await this.db.transaction(async client => {
      const { rows: [grant] } = await client.query<{ id: string; subject: string; external_account_id: string; refresh_expires_at: Date }>(
        `UPDATE pc_mock_grants SET refresh_consumed_at=now() WHERE refresh_hash=$1 AND site_id=$2 AND application_id=$3 AND issuer=$4
          AND refresh_consumed_at IS NULL AND revoked_at IS NULL AND refresh_expires_at>now()
          RETURNING id,subject,external_account_id,refresh_expires_at`, [digest(refreshToken), ...this.scope]);
      if (!grant) return { outcome: 'REJECTED' as const, tokens: null };
      if (this.environment.values.PC_MOCK_REFRESH_MODE === 'REJECTED') {
        await client.query('UPDATE pc_mock_grants SET revoked_at=now() WHERE id=$1', [grant.id]);
        return { outcome: 'REJECTED' as const, tokens: null };
      }
      const tokens = await this.createGrant(client, grant.subject, grant.external_account_id, grant);
      // UNKNOWN deliberately loses a committed rotation response. The consumer must never replay the old token.
      return { outcome: this.environment.values.PC_MOCK_REFRESH_MODE, tokens };
    });
    if (result.outcome !== 'SUCCESS' || !result.tokens) throw new MockPcFailure(result.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'REJECTED',
      result.outcome === 'UNKNOWN' ? 'MOCK_REFRESH_RESPONSE_UNKNOWN' : 'MOCK_REFRESH_REJECTED');
    return result.tokens;
  }
  private async assertAccess(client: PoolClient, accessToken: string, externalAccountId: string) {
    const result = await client.query(`SELECT id FROM pc_mock_grants WHERE access_hash=$1 AND site_id=$2 AND application_id=$3 AND issuer=$4
      AND external_account_id=$5 AND access_expires_at>now() AND revoked_at IS NULL`, [digest(accessToken), ...this.scope, externalAccountId]);
    if (!result.rowCount) throw new MockPcFailure('REJECTED', 'MOCK_ACCESS_REJECTED');
  }
  private async ensureResources(client: PoolClient, fixture: MockFixture) {
    // Two fixed source facts per named account, retained across consent and process restarts. No rolling resource renewal.
    const prefix = digest([...this.scope, fixture.external_account_id].join(':')).slice(0, 20);
    let project: { external_project_id: string; platform_id: string } | undefined;
    if (this.environment.siteId === 'linepool') {
      const { rows: [configured] } = await client.query<{ external_project_id: string; platform_id: string }>(`SELECT p.external_project_id,p.platform_id
        FROM provider_projects p JOIN upstream_accounts a ON a.id=p.upstream_account_id
        WHERE a.external_account_id=$1 AND a.provider='pingcode-mock' AND a.storefront_id=$2 AND NOT a.historical_only
        AND p.is_active ORDER BY p.external_project_id LIMIT 1`, [fixture.external_account_id, this.environment.siteId]);
      // The declared Mock Telegram fixture is a real persisted provider project, not an invented ONCE platform.
      project = configured ?? { external_project_id: `pc-mock-project:${prefix}:telegram`, platform_id: 'Telegram' };
    }
    if (fixture.owner_kind === 'SELF_SERVICE') {
      // Preserve already declared finite Mock seed resources and their original binding/project IDs.
      await client.query(`INSERT INTO pc_mock_resources(site_id,application_id,issuer,external_account_id,external_number_id,
        phone_number,region_id,external_project_id,platform_id,capabilities,source_available,resource_expires_at)
        SELECT $1,$2,$3,$4,b.external_number_id,n.phone_number,n.region_id,b.external_project_id,p.platform_id,
          CASE WHEN $1='once' AND n.capability<>'SEND_RECEIVE' THEN ARRAY['NUMBER_LEASE']::text[] ELSE $5::text[] END,
          n.resource_status IN ('LOCAL','ONLINE'),n.resource_expires_at FROM phone_numbers n
        JOIN upstream_accounts a ON a.id=n.upstream_account_id
        JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=a.provider
        LEFT JOIN provider_projects p ON p.provider=b.provider AND p.external_project_id=b.external_project_id AND p.upstream_account_id=a.id
        WHERE a.storefront_id=$1 AND a.external_account_id=$4 AND a.provider='pingcode-mock' AND a.owner_kind='SELF_SERVICE'
          AND NOT a.historical_only AND n.resource_expires_at IS NOT NULL
          AND (($1='once' AND b.external_project_id IS NULL) OR ($1='linepool' AND p.external_project_id IS NOT NULL))
        ON CONFLICT(external_number_id) DO NOTHING`, [...this.scope, fixture.external_account_id, fixture.capabilities]);
    }
    for (let index = 1; index <= 2; index++) {
      const externalNumberId = `pc-mock-number:${prefix}:${index}`;
      const phoneDigits = BigInt(`0x${digest(externalNumberId).slice(0, 12)}`) % 1000000000n;
      const phone = `+1999${phoneDigits.toString().padStart(9, '0')}`;
      await client.query(`INSERT INTO pc_mock_resources(site_id,application_id,issuer,external_account_id,external_number_id,
        phone_number,region_id,external_project_id,platform_id,capabilities,resource_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'us',$7,$8,$9,$10::timestamptz+interval '90 days') ON CONFLICT(external_number_id) DO NOTHING`,
      [...this.scope, fixture.external_account_id, externalNumberId, phone, project?.external_project_id ?? null,
        project?.platform_id ?? null, fixture.capabilities, fixture.created_at]);
      await client.query(`INSERT INTO pc_mock_messages(external_message_id,external_number_id,sender,body,occurred_at)
        VALUES($1,$2,'Mock PinClode',$3,$4) ON CONFLICT(external_message_id) DO NOTHING`,
      [`pc-mock-message:${prefix}:${index}:1`, externalNumberId, `${fixture.display_name} verification code: ${index === 1 ? '246810' : '135790'}`, fixture.created_at]);
    }
  }
  async snapshot(accessToken: string, externalAccountId: string) {
    this.requireSandbox();
    return this.db.transaction(async client => {
      // Pages share one stable local source view; a partial read never becomes an authoritative list.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.assertAccess(client, accessToken, externalAccountId);
      const progress: MockSnapshotProgress = { complete: false, pageSize: this.environment.values.PC_MOCK_SNAPSHOT_PAGE_SIZE,
        successfulPages: 0, fetchedCount: 0, failedPage: null, pages: [] };
      const resources: MockResource[] = [];
      let cursor: string | null = null;
      do {
        if (externalAccountId === this.environment.values.PC_MOCK_SNAPSHOT_FAIL_ACCOUNT
          && progress.pages.length + 1 === this.environment.values.PC_MOCK_SNAPSHOT_FAIL_PAGE) {
          progress.pages.push({ cursor, nextCursor: null, fetchedCount: 0, status: 'FAILED' });
          progress.failedPage = progress.pages.length;
          throw new MockPcSnapshotFailure(progress);
        }
        const { rows }: { rows: MockResource[] } = await client.query<MockResource>(`SELECT * FROM pc_mock_resources WHERE site_id=$1 AND application_id=$2 AND issuer=$3
          AND external_account_id=$4 AND source_present AND ($5::text IS NULL OR external_number_id>$5)
          ORDER BY external_number_id LIMIT $6`, [...this.scope, externalAccountId, cursor, progress.pageSize + 1]);
        const hasMore: boolean = rows.length > progress.pageSize;
        if (hasMore) rows.pop();
        const nextCursor: string | null = hasMore ? rows[rows.length - 1]!.external_number_id : null;
        progress.pages.push({ cursor, nextCursor, fetchedCount: rows.length, status: 'SUCCEEDED' });
        progress.successfulPages++;
        progress.fetchedCount += rows.length;
        resources.push(...rows);
        cursor = nextCursor;
      } while (cursor !== null);
      progress.complete = true;
      return { resources, progress };
    });
  }
  async messages(accessToken: string, externalAccountId: string, cursor: string) {
    this.requireSandbox();
    return this.db.transaction(async client => {
      await this.assertAccess(client, accessToken, externalAccountId);
      const { rows } = await client.query<{ sequence: string; external_message_id: string; external_number_id: string;
        phone_number: string; sender: string; body: string; occurred_at: Date }>(`SELECT m.*,r.phone_number FROM pc_mock_messages m
        JOIN pc_mock_resources r ON r.external_number_id=m.external_number_id WHERE r.site_id=$1 AND r.application_id=$2 AND r.issuer=$3
          AND r.external_account_id=$4 AND m.sequence>$5::bigint AND m.occurred_at<=now() ORDER BY m.sequence LIMIT 100`, [...this.scope, externalAccountId, cursor]);
      return rows.map(row => ({ cursor: row.sequence, message: { externalMessageId: row.external_message_id,
        externalNumberId: row.external_number_id, phoneNumber: row.phone_number, sender: row.sender, body: row.body,
        receivedAt: row.occurred_at.toISOString(), upstreamCreatedAt: row.occurred_at.toISOString() } satisfies ProviderInbound }));
    });
  }
}
