import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import type { PcAuthStartInput } from '@linepool/contracts';
import { Authentication, toUser, type UserRow } from '../authentication.js';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { MockPcProvider } from './mock-provider.js';
import { PcHttpFailure, PcHttpProvider } from './http-provider.js';
import { digest, type AuthState, type ConnectionRow } from './model.js';

@Injectable()
export class PcAuthorization {
  constructor(private readonly db: Database, private readonly environment: Environment,
    private readonly authentication: Authentication, private readonly provider: MockPcProvider,
    private readonly http: PcHttpProvider) {}
  private requireAuthorization() {
    if (!this.environment.isModuleEnabled(this.environment.product)) throw new ApiFailure(409, 'PC_MODULE_DISABLED', 'The site product module is disabled');
    if (this.environment.values.PC_MODE === 'mock') this.provider.requireSandbox();
  }
  private get stateCookie() { return `${this.environment.cookieName}_pc_state`; }
  private get cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.environment.values.NODE_ENV === 'production', sameSite: 'lax', path: '/api/pc' };
  }
  private async browserState(request: Request, stateValue: string) {
    const cookies: Record<string, unknown> = request.cookies ?? {};
    const browser = cookies[this.stateCookie];
    if (!/^[a-f0-9]{64}$/.test(stateValue) || typeof browser !== 'string') throw new ApiFailure(401, 'PC_STATE_INVALID', 'Authorization browser state is missing');
    const { rows: [state] } = await this.db.query<AuthState>('SELECT * FROM pc_auth_states WHERE state_hash=$1', [digest(stateValue)]);
    this.validateState(state, browser);
    return state!;
  }
  private validateState(state: AuthState | undefined, browser: string) {
    if (!state || state.browser_hash !== digest(browser) || state.consumed_at || state.expires_at.getTime() <= Date.now()
      || state.site_id !== this.environment.siteId || state.application_id !== this.environment.values.PC_APPLICATION_ID
      || state.issuer !== this.environment.values.PC_ISSUER || state.callback_url !== this.environment.values.PC_AUTH_CALLBACK_URL) {
      throw new ApiFailure(401, 'PC_STATE_INVALID', 'Authorization state is expired, used, or belongs to a different site/application/browser');
    }
  }
  async start(request: Request, response: Response, input: PcAuthStartInput) {
    this.requireAuthorization();
    const callback = this.environment.values.PC_AUTH_CALLBACK_URL;
    if (this.environment.values.PC_MODE === 'mock' && callback !== `${this.environment.values.WEB_ORIGIN}/api/pc/auth/callback`) {
      throw new ApiFailure(503, 'PC_CALLBACK_MISCONFIGURED', 'Mock callback must use this frontend origin at /api/pc/auth/callback');
    }
    const session = await this.authentication.getSession(request);
    let expected: ConnectionRow | undefined;
    if (input.purpose === 'SELF_SERVICE') {
      if (session?.user.role !== 'ADMIN') throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Administrator access is required to authorize the self-service connection');
      const result = await this.db.query<ConnectionRow>(`SELECT * FROM upstream_accounts WHERE storefront_id=$1
        AND owner_kind='SELF_SERVICE' AND NOT historical_only AND provider=$3 AND external_account_id=$2`,
      [this.environment.siteId, this.environment.selfServiceExternalAccountId, this.environment.pcProvider]);
      expected = result.rows[0];
      if (!expected) throw new ApiFailure(503, 'PC_SELF_SERVICE_NOT_CONFIGURED', 'A separate self-service account for the selected provider must be provisioned before authorization');
    } else if (input.purpose === 'REAUTHORIZE') {
      if (!session || session.user.authKind !== 'PINCLODE' || !session.user.agentId) throw new ApiFailure(403, 'PC_AGENT_REQUIRED', 'PinClode agent login is required');
      const result = await this.db.query<ConnectionRow>(`SELECT * FROM upstream_accounts WHERE agent_id=$1 AND storefront_id=$2
        AND owner_kind='AGENT' AND NOT historical_only`, [session.user.agentId, this.environment.siteId]);
      expected = result.rows[0];
      if (!expected || expected.provider !== this.environment.pcProvider || expected.application_id !== this.environment.values.PC_APPLICATION_ID || expected.issuer !== this.environment.values.PC_ISSUER) {
        throw new ApiFailure(409, 'PC_IDENTITY_MISMATCH', 'The original connection application and issuer must be used');
      }
    }
    const state = randomBytes(32).toString('hex'), browser = randomBytes(32).toString('hex');
    const verifier = this.environment.values.PC_MODE === 'real' ? randomBytes(32).toString('base64url') : null;
    const expiresAt = new Date(Date.now() + 10 * 60000);
    await this.db.transaction(async client => {
      if (this.environment.values.PC_MODE === 'mock') await this.provider.ensureFixtures(client);
      const values = [digest(state), digest(browser), this.environment.siteId,
        this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER, callback, input.purpose,
        input.purpose === 'AGENT_LOGIN' ? null : session!.user.id, expected?.id ?? null, expected?.subject ?? null,
        expected?.external_account_id ?? null, expiresAt];
      if (verifier) await client.query(`INSERT INTO pc_auth_states(state_hash,browser_hash,site_id,application_id,issuer,callback_url,purpose,
        requested_user_id,expected_connection_id,expected_subject,expected_external_account_id,expires_at,code_verifier)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [...values, verifier]);
      else await client.query(`INSERT INTO pc_auth_states(state_hash,browser_hash,site_id,application_id,issuer,callback_url,purpose,
        requested_user_id,expected_connection_id,expected_subject,expected_external_account_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, values);
    });
    response.cookie(this.stateCookie, browser, { ...this.cookieOptions, expires: expiresAt });
    return { authorizeUrl: verifier ? this.http.authorizeUrl(state, verifier)
      : `${this.environment.values.WEB_ORIGIN}/api/pc/mock/authorize?state=${state}` };
  }
  async consent(request: Request, stateValue: string) {
    this.requireAuthorization();
    this.provider.requireSandbox();
    const state = await this.browserState(request, stateValue);
    const fixtures = await this.provider.choices(state);
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const escape = (value: string) => value.replace(/[&<>"']/g, character => entities[character]!);
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mock PinClode consent</title><body><main><h1>Local Mock PinClode</h1><p>Choose a configured account to authorize ${escape(this.environment.siteName)} (${escape(state.application_id)}).</p><p>These are persisted local fixtures. Agent A and B own separate finite resources; the not-enabled fixture denies application access.</p><form method="post" action="/api/pc/mock/authorize"><input type="hidden" name="state" value="${escape(stateValue)}">${fixtures.map(fixture => `<p><button type="submit" name="fixture" value="${escape(fixture.fixture_key)}">${escape(fixture.display_name)}</button></p>`).join('')}</form></main></body></html>`;
  }
  async choose(request: Request, stateValue: string, fixtureKey: string) {
    this.requireAuthorization();
    this.provider.requireSandbox();
    const cookies: Record<string, unknown> = request.cookies ?? {};
    const browser = cookies[this.stateCookie];
    if (typeof browser !== 'string' || !/^[a-f0-9]{64}$/.test(stateValue)) throw new ApiFailure(401, 'PC_STATE_INVALID', 'Authorization browser state is missing');
    return this.db.transaction(async client => {
      const { rows: [state] } = await client.query<AuthState>('SELECT * FROM pc_auth_states WHERE state_hash=$1 FOR UPDATE', [digest(stateValue)]);
      this.validateState(state, browser);
      const code = await this.provider.authorize(client, state!, fixtureKey);
      return `${state!.callback_url}?state=${stateValue}&code=${code}`;
    });
  }
  async callback(request: Request, response: Response, stateValue: string, code: string) {
    try {
      this.requireAuthorization();
      const cookies: Record<string, unknown> = request.cookies ?? {};
      const browser = cookies[this.stateCookie];
      if (typeof browser !== 'string' || !/^[a-f0-9]{64}$/.test(stateValue)
        || (this.environment.values.PC_MODE === 'mock' ? !/^[a-f0-9]{64}$/.test(code) : !code || code.length > 4096 || /[\r\n]/.test(code))) {
        throw new ApiFailure(401, 'PC_STATE_INVALID', 'Authorization browser state or code is missing');
      }
      const session = await this.authentication.getSession(request);
      const realState = this.environment.values.PC_MODE === 'real' ? await this.db.transaction(async client => {
        const { rows: [state] } = await client.query<AuthState>('SELECT * FROM pc_auth_states WHERE state_hash=$1 FOR UPDATE', [digest(stateValue)]);
        this.validateState(state, browser);
        if (state!.purpose !== 'AGENT_LOGIN' && (!session || session.user.id !== state!.requested_user_id)) {
          throw new ApiFailure(401, 'PC_SESSION_CHANGED', 'The initiating login session is required');
        }
        if (state!.purpose !== 'AGENT_LOGIN') {
          const current = await client.query(`SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE'
            AND ($2::boolean=false OR role='ADMIN') FOR SHARE`, [session!.user.id, state!.purpose === 'SELF_SERVICE']);
          if (!current.rowCount) throw new ApiFailure(403, 'ACCOUNT_DISABLED', 'The initiating account is no longer authorized');
        }
        await client.query('UPDATE pc_auth_states SET consumed_at=now(),code_verifier=NULL WHERE state_hash=$1', [state!.state_hash]);
        return state!;
      }) : null;
      // Consume browser state before the one-time exchange; no database lock spans the remote request.
      const realAuthorization = realState ? await this.http.exchange(realState, code) : null;
      const result = await this.db.transaction(async client => {
        const { rows: [state] } = await client.query<AuthState>('SELECT * FROM pc_auth_states WHERE state_hash=$1 FOR UPDATE', [digest(stateValue)]);
        this.validateState(realState && state ? { ...state, consumed_at: null } : state, browser);
        if (state!.purpose !== 'AGENT_LOGIN') {
          if (!session || session.user.id !== state!.requested_user_id) throw new ApiFailure(401, 'PC_SESSION_CHANGED', 'The initiating login session is required');
          const current = await client.query(`SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE'
            AND ($2::boolean=false OR role='ADMIN') FOR SHARE`, [session.user.id, state!.purpose === 'SELF_SERVICE']);
          if (!current.rowCount) throw new ApiFailure(403, 'ACCOUNT_DISABLED', 'The initiating account is no longer authorized');
        }
        const { fixture, tokens } = realAuthorization ?? await this.provider.exchange(client, state!, code);
        await client.query('UPDATE pc_auth_states SET consumed_at=now() WHERE state_hash=$1', [state!.state_hash]);
        if (!tokens) return { error: 'PC_APPLICATION_NOT_ENABLED' as string, user: null };
        if ((state!.purpose === 'SELF_SERVICE') !== (fixture.owner_kind === 'SELF_SERVICE')
          || (state!.expected_subject !== null && state!.expected_subject !== fixture.subject)
          || (state!.expected_external_account_id !== null && state!.expected_external_account_id !== fixture.external_account_id)) {
          return { error: 'PC_IDENTITY_MISMATCH', user: null };
        }
        let connectionId = state!.expected_connection_id;
        let userId: string | null = null;
        if (fixture.owner_kind === 'AGENT') {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [[...this.provider.scope, fixture.subject].join(':')]);
          let { rows: [identity] } = await client.query<{ user_id: string; agent_id: string }>(`SELECT user_id,agent_id FROM pc_agent_identities
            WHERE site_id=$1 AND application_id=$2 AND issuer=$3 AND subject=$4`, [...this.provider.scope, fixture.subject]);
          if (!identity) {
            userId = randomUUID(); const agentId = randomUUID();
            await client.query(`INSERT INTO users(id,email,password_hash,display_name,auth_kind,role)
              VALUES($1,$2,'!PINCLODE:no-local-password',$3,'PINCLODE','USER')`, [userId, `${userId}@pinclode.invalid`, fixture.display_name]);
            await client.query('INSERT INTO point_accounts(user_id) VALUES($1)', [userId]);
            await client.query('INSERT INTO agents(id,user_id,name) VALUES($1,$2,$3)', [agentId, userId, fixture.display_name]);
            await client.query(`INSERT INTO pc_agent_identities(site_id,application_id,issuer,subject,user_id,agent_id)
              VALUES($1,$2,$3,$4,$5,$6)`, [...this.provider.scope, fixture.subject, userId, agentId]);
            identity = { user_id: userId, agent_id: agentId };
          }
          userId = identity.user_id;
          const valid = await client.query(`SELECT u.id FROM users u JOIN agents a ON a.user_id=u.id
            WHERE u.id=$1 AND a.id=$2 AND u.auth_kind='PINCLODE' AND u.role IN ('USER','ADMIN') AND u.account_status='ACTIVE' AND a.status='ACTIVE' FOR SHARE OF u,a`, [userId, identity.agent_id]);
          if (!valid.rowCount) return { error: 'PC_AGENT_NOT_ACTIVE', user: null };
          const { rows: [account] } = await client.query<ConnectionRow>(`SELECT * FROM upstream_accounts WHERE agent_id=$1 FOR UPDATE`, [identity.agent_id]);
          if (account) {
            if (account.provider !== this.environment.pcProvider || account.subject !== fixture.subject || account.application_id !== state!.application_id || account.issuer !== state!.issuer
              || account.external_account_id !== fixture.external_account_id || account.storefront_id !== state!.site_id
              || (state!.expected_connection_id !== null && account.id !== state!.expected_connection_id)) return { error: 'PC_IDENTITY_MISMATCH', user: null };
            connectionId = account.id;
          } else {
            connectionId = randomUUID();
            await client.query(`INSERT INTO upstream_accounts(id,provider,external_account_id,storefront_id,owner_kind,agent_id,application_id,issuer,subject)
              VALUES($1,$8,$2,$3,'AGENT',$4,$5,$6,$7)`, [connectionId, fixture.external_account_id,
              this.environment.siteId, identity.agent_id, state!.application_id, state!.issuer, fixture.subject, this.environment.pcProvider]);
          }
        }
        if (!connectionId) throw new ApiFailure(409, 'PC_CONNECTION_MISSING', 'Original connection is unavailable');
        const { rows: [connection] } = await client.query<ConnectionRow>(`SELECT * FROM upstream_accounts WHERE id=$1 AND NOT historical_only FOR UPDATE`, [connectionId]);
        if (!connection || connection.provider !== this.environment.pcProvider || connection.external_account_id !== fixture.external_account_id || connection.storefront_id !== state!.site_id
          || (connection.subject !== null && connection.subject !== fixture.subject)
          || (connection.application_id !== null && connection.application_id !== state!.application_id)
          || (connection.issuer !== null && connection.issuer !== state!.issuer)) return { error: 'PC_IDENTITY_MISMATCH', user: null };
        const supported = this.environment.isModuleEnabled(this.environment.product) ? fixture.capabilities : [];
        await client.query(`UPDATE upstream_accounts SET application_id=$2,issuer=$3,subject=$4,status='ACTIVE',auth_status='ACTIVE',
          capabilities=$5,enabled_capabilities=CASE WHEN token_version=0 THEN $5::text[] ELSE ARRAY(SELECT unnest(enabled_capabilities) INTERSECT SELECT unnest($5::text[])) END,
          access_token=$6,refresh_token=$7,access_expires_at=$8,refresh_expires_at=$9,token_version = (1 + token_version),
          refresh_claim_id=NULL,refresh_claim_deadline=NULL,poll_claim_id=NULL,poll_claim_deadline=NULL,poll_version=poll_version+1,
          next_poll_at=now(),problem=NULL WHERE id=$1`, [connectionId, state!.application_id, state!.issuer, fixture.subject,
          supported, tokens.accessToken, tokens.refreshToken, tokens.accessExpiresAt, tokens.refreshExpiresAt]);
        if (!userId) return { error: null, user: null };
        const { rows: [user] } = await client.query<UserRow>(`SELECT u.*,a.available_points AS points_balance,i.agent_id FROM users u
          JOIN point_accounts a ON a.user_id=u.id JOIN pc_agent_identities i ON i.user_id=u.id WHERE u.id=$1`, [userId]);
        if (!user) throw new Error('PC_AGENT_USER_MISSING');
        return { error: null, user: toUser(user) };
      });
      if (result.error) throw new ApiFailure(401, result.error, 'PinClode authorization was not accepted');
      if (result.user) await this.authentication.issueSession(result.user, response);
      response.clearCookie(this.stateCookie, this.cookieOptions);
      response.redirect(303, `${this.environment.values.WEB_ORIGIN}/agent`);
    } catch (failure) {
      response.clearCookie(this.stateCookie, this.cookieOptions);
      const payload = failure instanceof ApiFailure ? failure.getResponse() : null;
      const errorCode = typeof payload === 'object' && payload !== null && 'error' in payload
        && typeof payload.error === 'object' && payload.error !== null && 'code' in payload.error && typeof payload.error.code === 'string'
        ? payload.error.code : failure instanceof PcHttpFailure ? failure.reason : 'PC_AUTH_FAILED';
      response.redirect(303, `${this.environment.values.WEB_ORIGIN}/agent?authError=${encodeURIComponent(errorCode)}`);
    }
  }
}
