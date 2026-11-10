import { Injectable } from '@nestjs/common';
import type { InboxWaitInput, PcCapability, PcMessage, PcNumber, PcPlanInput, User } from '@linepool/contracts';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { connectionView, planView, digest, type ConnectionRow, type PlanRow } from './model.js';
import { linePoolAllocationScope } from '../platform-inventory.js';

/** Aliases a/n/c/u are the selected allocation, number, connection and session owner. */
export const linePoolWaitServiceScope = (provider: 'pingcode-mock' | 'pingcode') => `${linePoolAllocationScope()}
  AND a.user_id=u.id AND a.number_id=n.id AND a.assigned_at<=now() AND a.released_at IS NULL
  AND (a.receiving_status='WAITING' OR (a.receiving_mode='HOSTED' AND a.expires_at>now()))
  AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.user_id=a.user_id
    AND (o.fulfillment_status='COMPLETED' OR (o.receiving_mode='ONE_TIME' AND a.receiving_status='WAITING'))))
  AND u.auth_kind='LOCAL' AND u.account_status='ACTIVE'
  AND (u.role='ADMIN' OR NOT EXISTS(SELECT 1 FROM agents g WHERE g.user_id=u.id AND g.status<>'ACTIVE'))
  AND n.upstream_account_id=c.id AND 'SMS_CODE'=ANY(n.pc_capabilities)
  AND (a.receiving_status='WAITING' OR (NOT n.source_missing AND n.resource_status IN ('LOCAL','ONLINE') AND n.resource_expires_at>now()))
  AND c.storefront_id='linepool' AND c.owner_kind='SELF_SERVICE' AND c.provider='${provider}'
  AND NOT c.historical_only AND c.status='ACTIVE' AND c.auth_status='ACTIVE' AND c.access_expires_at>now()
  AND 'SMS_CODE'=ANY(c.capabilities) AND 'SMS_CODE'=ANY(c.enabled_capabilities)
  AND EXISTS(SELECT 1 FROM number_platforms p JOIN provider_projects project
    ON project.provider=p.provider AND project.external_project_id=p.external_project_id AND project.platform_id=p.platform_id
    WHERE p.number_id=n.id AND p.platform_id=a.platform_id AND (p.is_available OR a.receiving_status='WAITING') AND p.provider=c.provider AND project.upstream_account_id=c.id)`;

@Injectable()
export class PcConnections {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  private requireModule() {
    if (!this.environment.isModuleEnabled(this.environment.product)) throw new ApiFailure(409, 'PC_MODULE_DISABLED', 'The site product module is disabled');
  }
  private async own(user: User, optional = false) {
    if (user.authKind !== 'PINCLODE' || !user.agentId) throw new ApiFailure(403, 'SELF_SERVICE_REQUIRED', 'Local accounts use the self-service area; PinClode agent login is required here');
    const { rows: [connection] } = await this.db.query<ConnectionRow>(`SELECT a.* FROM upstream_accounts a
      JOIN pc_agent_identities i ON i.agent_id=a.agent_id JOIN agents g ON g.id=i.agent_id JOIN users u ON u.id=i.user_id
      WHERE i.user_id=$1 AND i.agent_id=$2 AND i.site_id=$3 AND i.application_id=$4 AND i.issuer=$5
      AND a.storefront_id=i.site_id AND a.application_id=i.application_id AND a.issuer=i.issuer AND a.subject=i.subject
      AND a.owner_kind='AGENT' AND NOT a.historical_only AND a.provider=$6
      AND g.status='ACTIVE' AND u.account_status='ACTIVE'`, [user.id, user.agentId, this.environment.siteId,
      this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER, this.environment.pcProvider]);
    if (!connection && !optional) throw new ApiFailure(404, 'PC_CONNECTION_NOT_FOUND', 'The original PinClode connection is unavailable');
    return connection;
  }
  private support(connection: ConnectionRow, capability: PcCapability, enable: boolean) {
    const siteCapabilities = this.environment.siteId === 'linepool' ? ['SMS_CODE'] : ['NUMBER_LEASE', 'SEND_SMS'];
    if (!siteCapabilities.includes(capability) || !connection.capabilities.includes(capability)
      || (enable && !this.environment.isModuleEnabled(this.environment.product))) {
      throw new ApiFailure(409, 'PC_CAPABILITY_UNAVAILABLE', 'This capability is unavailable for the site or provider account');
    }
  }
  async session(user: User) {
    const connection = await this.own(user, true);
    if (!connection) return { connection: null, numbers: [], plans: [] };
    // shops exists from migration 049 and is LinePool-only; ONCE never queries it.
    const officialShop = this.environment.siteId === 'linepool' && Boolean((await this.db.query(
      `SELECT 1 FROM shops WHERE connection_id=$1 AND site_id='linepool' AND kind='OFFICIAL' AND status='ACTIVE'`, [connection.id])).rowCount);
    const [numbers, plans] = await Promise.all([
      this.db.query<{ id: string; phone_number: string; region_id: string; resource_expires_at: Date | null;
        source_missing: boolean; pc_capabilities: PcCapability[] }>(`SELECT id,phone_number,region_id,resource_expires_at,source_missing,pc_capabilities
          FROM phone_numbers WHERE upstream_account_id=$1 ORDER BY phone_number,id`, [connection.id]),
      this.db.query<PlanRow>('SELECT * FROM pc_plans WHERE connection_id=$1 AND archived_at IS NULL ORDER BY created_at,id', [connection.id]),
    ]);
    return { connection: connectionView(connection, this.environment.isModuleEnabled(this.environment.product)), numbers: numbers.rows.map((row): PcNumber => ({ id: row.id,
      phoneNumber: row.phone_number, regionId: row.region_id, resourceExpiresAt: row.resource_expires_at?.toISOString() ?? null,
      sourceMissing: row.source_missing, capabilities: this.environment.isModuleEnabled(this.environment.product) ? row.pc_capabilities : [] })), plans: plans.rows.map(planView), officialShop };
  }
  async capabilities(user: User, enabled: PcCapability[]) {
    this.requireModule();
    const connection = (await this.own(user))!;
    for (const capability of enabled) this.support(connection, capability, true);
    const { rows: [saved] } = await this.db.query<ConnectionRow>(`UPDATE upstream_accounts SET enabled_capabilities=$2,next_poll_at=now(),
      poll_claim_id=NULL,poll_claim_deadline=NULL,poll_version=poll_version+1
      WHERE id=$1 AND owner_kind='AGENT' AND agent_id=$3 AND NOT historical_only RETURNING *`, [connection.id, enabled, user.agentId]);
    if (!saved) throw new ApiFailure(404, 'PC_CONNECTION_NOT_FOUND', 'Connection is unavailable');
    return connectionView(saved, this.environment.isModuleEnabled(this.environment.product));
  }
  async messages(user: User, input: { numberId?: string; page: number; pageSize: number }) {
    const connection = (await this.own(user))!;
    if (input.numberId) {
      const number = await this.db.query('SELECT id FROM phone_numbers WHERE id=$1 AND upstream_account_id=$2', [input.numberId, connection.id]);
      if (!number.rowCount) throw new ApiFailure(404, 'PC_NUMBER_NOT_FOUND', 'Number is unavailable');
    }
    const { rows: [count] } = await this.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM provider_message_receipts
      WHERE provider=$4 AND connection_id=$1 AND owner_agent_id=$2 AND processing_status='CONNECTION_IMPORTED'
        AND ($3::uuid IS NULL OR number_id=$3)`, [connection.id, user.agentId, input.numberId ?? null, connection.provider]);
    const { rows } = await this.db.query<{ external_message_id: string; number_id: string; normalized_payload: {
      phoneNumber: string; sender: string; content: string; code: string | null; occurredAt: string }; connection_read_at: Date | null }>(
      `SELECT external_message_id,number_id,normalized_payload,connection_read_at FROM provider_message_receipts
       WHERE provider=$6 AND connection_id=$1 AND owner_agent_id=$2 AND processing_status='CONNECTION_IMPORTED'
         AND ($3::uuid IS NULL OR number_id=$3) ORDER BY (normalized_payload->>'occurredAt') DESC,external_message_id DESC LIMIT $4 OFFSET $5`,
    [connection.id, user.agentId, input.numberId ?? null, input.pageSize, (input.page - 1) * input.pageSize, connection.provider]);
    const totalItems = count?.total ?? 0;
    return { data: rows.map((row): PcMessage => ({ id: row.external_message_id, numberId: row.number_id,
      phoneNumber: row.normalized_payload.phoneNumber, sender: row.normalized_payload.sender, body: row.normalized_payload.content,
      verificationCode: row.normalized_payload.code, receivedAt: row.normalized_payload.occurredAt, isRead: row.connection_read_at !== null })),
      pagination: { page: input.page, pageSize: input.pageSize, totalItems, totalPages: Math.ceil(totalItems / input.pageSize) } };
  }
  async read(user: User, ids: string[]) {
    const connection = (await this.own(user))!;
    const result = await this.db.query(`UPDATE provider_message_receipts SET connection_read_at=now()
      WHERE provider=$4 AND connection_id=$1 AND owner_agent_id=$2 AND processing_status='CONNECTION_IMPORTED'
        AND external_message_id=ANY($3::text[]) AND connection_read_at IS NULL`, [connection.id, user.agentId, ids, connection.provider]);
    return { changed: result.rowCount ?? 0 };
  }
  async wait(user: User, sessionToken: string, input: { numberId: string | null; waiting: boolean }) {
    this.requireModule();
    const connection = (await this.own(user))!;
    if (!input.waiting) {
      await this.db.query('DELETE FROM pc_wait_demands WHERE connection_id=$1 AND session_hash=$2', [connection.id, digest(sessionToken)]);
      return { waitingUntil: null };
    }
    if (!this.environment.isModuleEnabled(this.environment.product) || !connection.enabled_capabilities.includes(this.environment.product)) {
      throw new ApiFailure(409, 'PC_CAPABILITY_UNAVAILABLE', 'Receiving is disabled for this connection');
    }
    if (connection.auth_status !== 'ACTIVE' || !connection.access_expires_at || connection.access_expires_at.getTime() <= Date.now()) {
      throw new ApiFailure(409, 'PC_REAUTH_REQUIRED', 'The connection must be authorized before waiting for messages');
    }
    return this.db.transaction(async client => {
      if (input.numberId) {
        const number = await client.query(`SELECT id FROM phone_numbers WHERE id=$1 AND upstream_account_id=$2
          AND NOT source_missing AND resource_status IN ('LOCAL','ONLINE')
          AND (resource_expires_at>now() OR ($3='pingcode' AND resource_expires_at IS NULL))`, [input.numberId, connection.id, connection.provider]);
        if (!number.rowCount) throw new ApiFailure(404, 'PC_NUMBER_UNAVAILABLE', 'Number is missing, unavailable, or its finite provider resource has expired');
      }
      const { rows: [saved] } = await client.query<{ waiting_until: Date }>(`INSERT INTO pc_wait_demands(connection_id,session_hash,number_id,waiting_until)
        VALUES($1,$2,$3,now()+$4*interval '1 second') ON CONFLICT(connection_id,session_hash) DO UPDATE
          SET number_id=EXCLUDED.number_id,waiting_until=EXCLUDED.waiting_until RETURNING waiting_until`,
      [connection.id, digest(sessionToken), input.numberId, this.environment.values.PC_WAIT_SECONDS]);
      await client.query('UPDATE upstream_accounts SET next_poll_at=LEAST(COALESCE(next_poll_at,now()),now()) WHERE id=$1', [connection.id]);
      return { waitingUntil: saved!.waiting_until.toISOString() };
    });
  }
  async waitInbox(user: User, sessionToken: string, input: InboxWaitInput) {
    if (this.environment.siteId !== 'linepool' || user.authKind !== 'LOCAL') {
      throw new ApiFailure(403, 'SELF_SERVICE_REQUIRED', 'A local LinePool self-service account is required');
    }
    const sessionHash = digest(sessionToken);
    return this.db.transaction(async client => {
      const session = await client.query(`SELECT s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>now() AND u.auth_kind='LOCAL' AND u.account_status='ACTIVE'
          AND (u.role='ADMIN' OR NOT EXISTS(SELECT 1 FROM agents g WHERE g.user_id=u.id AND g.status<>'ACTIVE'))
        FOR UPDATE OF s FOR SHARE OF u`, [sessionHash, user.id]);
      if (!session.rowCount) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
      // Cancellation remains available after service release, capability changes or lost provider authorization.
      if (!input.waiting) {
        await client.query(`DELETE FROM pc_wait_demands d USING upstream_accounts c
          WHERE d.connection_id=c.id AND d.session_hash=$1 AND d.allocation_id=$2
            AND c.storefront_id=$3 AND c.owner_kind='SELF_SERVICE'`, [sessionHash, input.allocationId, this.environment.siteId]);
        return { waitingUntil: null };
      }
      this.requireModule();
      if (this.environment.pcProvider === 'pingcode') throw new ApiFailure(409, 'PC_PLATFORM_PROJECT_UNCONFIRMED', 'Real LinePool self-service requires the documented project metadata protocol');
      const { rows: [connection] } = await client.query<ConnectionRow>(`SELECT * FROM upstream_accounts
        WHERE storefront_id=$1 AND application_id=$2 AND issuer=$3 AND external_account_id=$4
          AND owner_kind='SELF_SERVICE' AND provider=$5 AND status='ACTIVE' AND NOT historical_only FOR UPDATE`,
      [this.environment.siteId, this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER,
        this.environment.selfServiceExternalAccountId, this.environment.pcProvider]);
      if (!connection) throw new ApiFailure(404, 'PC_CONNECTION_NOT_FOUND', 'The configured self-service connection is unavailable');
      this.support(connection, 'SMS_CODE', true);
      if (!connection.enabled_capabilities.includes('SMS_CODE')) throw new ApiFailure(409, 'PC_CAPABILITY_UNAVAILABLE', 'Receiving is disabled for this connection');
      if (connection.auth_status !== 'ACTIVE' || !connection.access_expires_at || connection.access_expires_at.getTime() <= Date.now()) {
        throw new ApiFailure(409, 'PC_REAUTH_REQUIRED', 'The connection must be authorized before waiting for messages');
      }
      const { rows: [service] } = await client.query<{ number_id: string; waiting_until: Date }>(`SELECT a.number_id,
        LEAST(CASE WHEN a.receiving_mode='ONE_TIME' THEN s.expires_at ELSE LEAST(a.expires_at,n.resource_expires_at) END,
          s.expires_at,clock_timestamp()+$5*interval '1 second') AS waiting_until
        FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN upstream_accounts c ON c.id=n.upstream_account_id
        JOIN sessions s ON s.token_hash=$4 JOIN users u ON u.id=s.user_id
        WHERE a.id=$1 AND a.user_id=$2 AND c.id=$3 AND s.expires_at>now() AND ${linePoolWaitServiceScope(this.environment.pcProvider)}
        FOR SHARE OF a,n`, [input.allocationId, user.id, connection.id, sessionHash, this.environment.values.PC_WAIT_SECONDS]);
      if (!service) throw new ApiFailure(404, 'NUMBER_NOT_FOUND', 'The selected platform service is unavailable or no longer assigned to this account');
      const { rows: [saved] } = await client.query<{ waiting_until: Date }>(`INSERT INTO pc_wait_demands(connection_id,session_hash,number_id,allocation_id,waiting_until)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(connection_id,session_hash) DO UPDATE
          SET number_id=EXCLUDED.number_id,allocation_id=EXCLUDED.allocation_id,waiting_until=EXCLUDED.waiting_until RETURNING waiting_until`,
      [connection.id, sessionHash, service.number_id, input.allocationId, service.waiting_until]);
      await client.query('UPDATE upstream_accounts SET next_poll_at=LEAST(COALESCE(next_poll_at,now()),now()) WHERE id=$1', [connection.id]);
      return { waitingUntil: saved!.waiting_until.toISOString() };
    });
  }
  async savePlan(user: User, input: PcPlanInput, id?: string) {
    this.requireModule();
    const connection = (await this.own(user))!;
    this.support(connection, input.capability, input.enabled);
    if (input.enabled && !connection.enabled_capabilities.includes(input.capability)) throw new ApiFailure(409, 'PC_CAPABILITY_DISABLED', 'Enable the connection capability before enabling its plan');
    const values = [connection.id, input.name, input.durationDays, input.amountMinor, input.currency, input.capability, input.enabled];
    const { rows: [row] } = id ? await this.db.query<PlanRow>(`UPDATE pc_plans SET name=$2,duration_days=$3,amount_minor=$4,currency=$5,
      capability=$6,enabled=$7,updated_at=now() WHERE connection_id=$1 AND id=$8 AND archived_at IS NULL RETURNING *`, [...values, id])
      : await this.db.query<PlanRow>(`INSERT INTO pc_plans(connection_id,name,duration_days,amount_minor,currency,capability,enabled)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, values);
    if (!row) throw new ApiFailure(404, 'PC_PLAN_NOT_FOUND', 'Plan is unavailable');
    return planView(row);
  }
  async archivePlan(user: User, id: string) {
    this.requireModule();
    const connection = (await this.own(user))!;
    const result = await this.db.query(`UPDATE pc_plans SET enabled=false,archived_at=now(),updated_at=now()
      WHERE id=$1 AND connection_id=$2 AND archived_at IS NULL`, [id, connection.id]);
    return { changed: Boolean(result.rowCount) };
  }
  async adminConnections() {
    const { rows } = await this.db.query<ConnectionRow>(`SELECT * FROM upstream_accounts WHERE storefront_id=$1 AND NOT historical_only
      ORDER BY owner_kind DESC,created_at,id`, [this.environment.siteId]);
    return rows.map(row => connectionView(row, this.environment.isModuleEnabled(this.environment.product)));
  }
  async requestPoll(id: string) {
    this.requireModule();
    const result = await this.db.query(`UPDATE upstream_accounts SET next_poll_at=now() WHERE id=$1 AND storefront_id=$2 AND provider=$3 AND NOT historical_only`, [id, this.environment.siteId, this.environment.pcProvider]);
    if (!result.rowCount) throw new ApiFailure(404, 'PC_CONNECTION_NOT_FOUND', 'Connection is unavailable');
    return { requested: true };
  }
  async fixtureAction(actorId: string, id: string, externalNumberId: string, action: 'MISSING' | 'RESTORE' | 'EXPIRE') {
    this.requireModule();
    if (this.environment.values.PC_MODE !== 'mock' || this.environment.values.NODE_ENV === 'production' || !this.environment.values.LOCAL_SANDBOX) throw new ApiFailure(403, 'PC_MOCK_UNAVAILABLE', 'Fixture actions require the isolated local sandbox');
    return this.db.transaction(async client => {
      const { rows: [account] } = await client.query<ConnectionRow>(`SELECT * FROM upstream_accounts WHERE id=$1 AND storefront_id=$2
        AND NOT historical_only AND provider='pingcode-mock' AND application_id=$3 AND issuer=$4 FOR UPDATE`,
      [id, this.environment.siteId, this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]);
      if (!account) throw new ApiFailure(404, 'PC_CONNECTION_NOT_FOUND', 'Connection is unavailable');
      const result = await client.query(`UPDATE pc_mock_resources SET source_present=CASE WHEN $6='MISSING' THEN false WHEN $6='RESTORE' THEN true ELSE source_present END,
        resource_expires_at=CASE WHEN $6='EXPIRE' THEN LEAST(resource_expires_at,now()) ELSE resource_expires_at END
        WHERE site_id=$1 AND application_id=$2 AND issuer=$3 AND external_account_id=$4 AND external_number_id=$5`,
      [this.environment.siteId, account.application_id, account.issuer, account.external_account_id, externalNumberId, action]);
      if (!result.rowCount) throw new ApiFailure(404, 'PC_FIXTURE_NOT_FOUND', 'Mock resource is unavailable');
      await client.query('UPDATE upstream_accounts SET next_poll_at=now() WHERE id=$1', [id]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1,'PC_MOCK_FIXTURE',$2,$3,'{}'::jsonb,$4::jsonb)`, [actorId, id, action, JSON.stringify({ externalNumberId, action })]);
      return { changed: true };
    });
  }
}
