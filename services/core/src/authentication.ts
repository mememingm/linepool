import { createHash, randomBytes } from 'node:crypto';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { compare, hash, hashSync } from 'bcryptjs';
import type { Request, Response, CookieOptions } from 'express';
import type { Account, AccountProfileInput, LoginInput, RegisterInput, User } from '@linepool/contracts';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure } from './http.js';

export type UserRow = {
  id: string; email: string; password_hash: string; display_name: string;
  is_demo: boolean; points_balance: number; expiry_notice: boolean; created_at: Date;
  role: 'USER' | 'ADMIN'; account_status: 'ACTIVE' | 'DISABLED';
  auth_kind: 'LOCAL' | 'PINCLODE'; agent_id?: string | null;
};
export type SessionRequest = Request & { user: User; sessionToken: string; sessionExpiresAt: Date };
const dummyHash = hashSync('invalid-account-placeholder', 12);
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function toUser(row: UserRow): User {
  return {
    id: row.id, email: row.email, displayName: row.display_name,
    isDemo: row.is_demo, pointsBalance: row.points_balance, createdAt: row.created_at.toISOString(), role: row.role,
    authKind: row.auth_kind, agentId: row.agent_id ?? null,
  };
}
@Injectable()
export class Authentication {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  get sandboxEnabled() { return this.environment.values.NODE_ENV !== 'production' && this.environment.values.LOCAL_SANDBOX; }
  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.environment.values.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
  }
  setSessionCookie(token: string, expiresAt: Date, response: Response) {
    // Remove the legacy API-only cookie so two cookies with the same name cannot disagree.
    response.clearCookie(this.environment.cookieName, { ...this.cookieOptions(), path: '/api' });
    response.cookie(this.environment.cookieName, token, { ...this.cookieOptions(), expires: expiresAt });
  }
  async issueSession(user: User, response: Response, expectedPasswordHash?: string): Promise<User> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.environment.sessionMaxAge);
    await this.db.transaction(async client => {
      const { rows: [account] } = await client.query<{ account_status: string; role: string; password_hash: string; auth_kind: string }>(
        'SELECT account_status,role,password_hash,auth_kind FROM users WHERE id=$1 FOR SHARE', [user.id]);
      if (!account || account.account_status !== 'ACTIVE') throw new ApiFailure(403, 'ACCOUNT_DISABLED', 'Account is disabled');
      if (account.auth_kind !== user.authKind) throw new ApiFailure(401, 'IDENTITY_CHANGED', 'Sign in again using the account identity provider');
      if (expectedPasswordHash && account.password_hash !== expectedPasswordHash) {
        throw new ApiFailure(401, 'INVALID_CREDENTIALS', 'Invalid account or password');
      }
      const { rows: [agent] } = await client.query<{ status: string }>('SELECT status FROM agents WHERE user_id=$1 FOR SHARE', [user.id]);
      if (account.role !== 'ADMIN' && agent && agent.status !== 'ACTIVE') throw new ApiFailure(403, 'AGENT_NOT_ACTIVE', 'Agent account is suspended or terminated');
      await client.query('DELETE FROM sessions WHERE expires_at <= now()');
      await client.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1,$2,$3)', [digest(token), user.id, expiresAt]);
    });
    this.setSessionCookie(token, expiresAt, response);
    return user;
  }
  async login(input: LoginInput, response: Response) {
    const demoAlias = input.email === 'admin';
    const email = demoAlias
      ? this.environment.values.NODE_ENV !== 'production' ? this.environment.values.DEMO_EMAIL : undefined
      : input.email;
    const { rows: [row] } = await this.db.query<UserRow>(
      `SELECT u.*,a.available_points AS points_balance,(SELECT agent.id FROM agents agent WHERE agent.user_id=u.id) AS agent_id
       FROM users u JOIN point_accounts a ON a.user_id=u.id WHERE u.email=$1 AND u.auth_kind='LOCAL'
       AND ($2::boolean=false OR u.is_demo=true)`, [email, demoAlias],
    );
    const valid = await compare(input.password, row?.password_hash ?? dummyHash);
    if (!row || !valid) throw new ApiFailure(401, 'INVALID_CREDENTIALS', 'Invalid account or password');
    if (row.account_status !== 'ACTIVE') throw new ApiFailure(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    return this.issueSession(toUser(row), response, row.password_hash);
  }
  async register(input: RegisterInput, response: Response) {
    const passwordHash = await hash(input.password, 12);
    const row = await this.db.transaction(async client => {
      const { rows: [created] } = await client.query<{ id: string }>(
        'INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',
        [input.email, passwordHash, input.displayName],
      );
      if (!created) throw new ApiFailure(409, 'EMAIL_EXISTS', 'Email is already registered');
      await client.query('INSERT INTO point_accounts(user_id) VALUES($1)', [created.id]);
      const { rows: [user] } = await client.query<UserRow>(
        `SELECT u.*,a.available_points AS points_balance,(SELECT agent.id FROM agents agent WHERE agent.user_id=u.id) AS agent_id
         FROM users u JOIN point_accounts a ON a.user_id=u.id WHERE u.id=$1`, [created.id],
      );
      if (!user) throw new ApiFailure(500, 'WALLET_ACCOUNT_MISSING', 'Point account is missing');
      return user;
    });
    return this.issueSession(toUser(row), response, row.password_hash);
  }
  async updateProfile(userId: string, sessionToken: string, input: AccountProfileInput): Promise<Account> {
    const tokenHash = digest(sessionToken);
    try {
      return await this.db.transaction(async client => {
        const { rows: [row] } = await client.query<UserRow & { phone_number: string | null }>(
          `SELECT u.*,a.available_points AS points_balance,(SELECT agent.id FROM agents agent WHERE agent.user_id=u.id) AS agent_id
           FROM users u JOIN point_accounts a ON a.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u`, [userId],
        );
        // Check again after acquiring the user lock, using a fresh statement snapshot after any concurrent email change.
        const session = await client.query(
          'SELECT token_hash FROM sessions WHERE user_id=$1 AND token_hash=$2 AND expires_at>now()', [userId, tokenHash],
        );
        if (!row || !session.rowCount || row.account_status !== 'ACTIVE') throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
        if (row.auth_kind === 'PINCLODE' && input.field !== 'displayName') {
          throw new ApiFailure(409, 'PINCLODE_LOGIN_REQUIRED', 'Manage PinClode credentials with the connection provider');
        }
        if (input.field !== 'displayName' && !await compare(input.currentPassword, row.password_hash)) {
          throw new ApiFailure(403, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
        }
        // Field names are selected locally, never interpolated from the request.
        const column = input.field === 'displayName' ? 'display_name' : input.field === 'email' ? 'email' : input.field === 'password' ? 'password_hash' : 'phone_number';
        const value = input.field === 'displayName' ? input.displayName : input.field === 'email' ? input.email : input.field === 'password' ? await hash(input.newPassword, 12) : input.phoneNumber;
        await client.query(`UPDATE users SET ${column}=$2 WHERE id=$1`, [userId, value]);
        const { rows: [updated] } = await client.query<UserRow & { phone_number: string | null }>(
          `SELECT u.*,a.available_points AS points_balance,(SELECT agent.id FROM agents agent WHERE agent.user_id=u.id) AS agent_id
           FROM users u JOIN point_accounts a ON a.user_id=u.id WHERE u.id=$1`, [userId],
        );
        if (!updated) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
        if (input.field === 'password' || (input.field === 'email' && input.email !== row.email)) {
          await client.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [userId, tokenHash]);
          await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [userId]);
        }
        return { ...toUser(updated), phoneNumber: updated.phone_number,
          preferences: { expiryNotice: updated.expiry_notice, language: 'zh-CN' } };
      });
    } catch (failure) {
      if (input.field === 'email' && typeof failure === 'object' && failure !== null
        && 'code' in failure && failure.code === '23505'
        && 'constraint' in failure && failure.constraint === 'users_email_key') {
        throw new ApiFailure(409, 'EMAIL_EXISTS', 'Email is already registered');
      }
      throw failure;
    }
  }
  async getSession(request: Request) {
    const cookies: Record<string, unknown> = request.cookies ?? {};
    const token = cookies[this.environment.cookieName];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const { rows: [row] } = await this.db.query<UserRow & { session_expires_at: Date }>(
      `SELECT u.*,a.available_points AS points_balance,s.expires_at AS session_expires_at,
        (SELECT agent.id FROM agents agent WHERE agent.user_id=u.id) AS agent_id
       FROM users u JOIN point_accounts a ON a.user_id=u.id JOIN sessions s ON s.user_id=u.id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.account_status='ACTIVE'
       AND (u.role='ADMIN' OR NOT EXISTS(SELECT 1 FROM agents a WHERE a.user_id=u.id AND a.status<>'ACTIVE'))
       AND (u.auth_kind='LOCAL' OR EXISTS(SELECT 1 FROM pc_agent_identities identity
         JOIN agents agent ON agent.id=identity.agent_id AND agent.user_id=u.id AND agent.status='ACTIVE'
         WHERE identity.user_id=u.id AND identity.site_id=$2 AND identity.application_id=$3 AND identity.issuer=$4))`,
      [digest(token), this.environment.siteId, this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER],
    );
    return row ? { user: toUser(row), token, expiresAt: row.session_expires_at } : null;
  }
  async logout(request: SessionRequest, response: Response) {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(request.sessionToken)]);
    response.clearCookie(this.environment.cookieName, this.cookieOptions());
    response.clearCookie(this.environment.cookieName, { ...this.cookieOptions(), path: '/api' });
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authentication: Authentication) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const session = await this.authentication.getSession(request);
    if (!session) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
    request.user = session.user;
    request.sessionToken = session.token;
    request.sessionExpiresAt = session.expiresAt;
    return true;
  }
}
