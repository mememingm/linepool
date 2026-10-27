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
};
export type SessionRequest = Request & { user: User; sessionToken: string; sessionExpiresAt: Date };
const cookieName = 'linepool_react_session';
const dummyHash = hashSync('invalid-account-placeholder', 12);
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function toUser(row: UserRow): User {
  return {
    id: row.id, email: row.email, displayName: row.display_name,
    isDemo: row.is_demo, pointsBalance: row.points_balance, createdAt: row.created_at.toISOString(), role: row.role,
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
    response.clearCookie(cookieName, { ...this.cookieOptions(), path: '/api' });
    response.cookie(cookieName, token, { ...this.cookieOptions(), expires: expiresAt });
  }
  async issueSession(user: User, response: Response, expectedPasswordHash?: string): Promise<User> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.environment.sessionMaxAge);
    await this.db.transaction(async client => {
      const { rows: [account] } = await client.query<{ account_status: string; role: string; password_hash: string }>(
        'SELECT account_status,role,password_hash FROM users WHERE id=$1 FOR SHARE', [user.id]);
      if (!account || account.account_status !== 'ACTIVE') throw new ApiFailure(403, 'ACCOUNT_DISABLED', 'Account is disabled');
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
      'SELECT * FROM users WHERE email = $1 AND ($2::boolean = false OR is_demo = true)', [email, demoAlias],
    );
    const valid = await compare(input.password, row?.password_hash ?? dummyHash);
    if (!row || !valid) throw new ApiFailure(401, 'INVALID_CREDENTIALS', 'Invalid account or password');
    if (row.account_status !== 'ACTIVE') throw new ApiFailure(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    return this.issueSession(toUser(row), response, row.password_hash);
  }
  async register(input: RegisterInput, response: Response) {
    const passwordHash = await hash(input.password, 12);
    const { rows: [row] } = await this.db.query<UserRow>(
      'INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING *',
      [input.email, passwordHash, input.displayName],
    );
    if (!row) throw new ApiFailure(409, 'EMAIL_EXISTS', 'Email is already registered');
    return this.issueSession(toUser(row), response, row.password_hash);
  }
  async updateProfile(userId: string, sessionToken: string, input: AccountProfileInput): Promise<Account> {
    const tokenHash = digest(sessionToken);
    try {
      return await this.db.transaction(async client => {
        const { rows: [row] } = await client.query<UserRow & { phone_number: string | null }>(
          'SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId],
        );
        // Check again after acquiring the user lock, using a fresh statement snapshot after any concurrent email change.
        const session = await client.query(
          'SELECT token_hash FROM sessions WHERE user_id=$1 AND token_hash=$2 AND expires_at>now()', [userId, tokenHash],
        );
        if (!row || !session.rowCount || row.account_status !== 'ACTIVE') throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
        if (input.field !== 'displayName' && !await compare(input.currentPassword, row.password_hash)) {
          throw new ApiFailure(403, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
        }
        // Field names are selected locally, never interpolated from the request.
        const column = input.field === 'displayName' ? 'display_name' : input.field === 'email' ? 'email' : input.field === 'password' ? 'password_hash' : 'phone_number';
        const value = input.field === 'displayName' ? input.displayName : input.field === 'email' ? input.email : input.field === 'password' ? await hash(input.newPassword, 12) : input.phoneNumber;
        const { rows: [updated] } = await client.query<UserRow & { phone_number: string | null }>(
          `UPDATE users SET ${column}=$2 WHERE id=$1 RETURNING *`, [userId, value],
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
    const token = cookies[cookieName];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const { rows: [row] } = await this.db.query<UserRow & { session_expires_at: Date }>(
      `SELECT u.*,s.expires_at AS session_expires_at FROM users u JOIN sessions s ON s.user_id=u.id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.account_status='ACTIVE'
       AND (u.role='ADMIN' OR NOT EXISTS(SELECT 1 FROM agents a WHERE a.user_id=u.id AND a.status<>'ACTIVE'))`, [digest(token)],
    );
    return row ? { user: toUser(row), token, expiresAt: row.session_expires_at } : null;
  }
  async logout(request: SessionRequest, response: Response) {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(request.sessionToken)]);
    response.clearCookie(cookieName, this.cookieOptions());
    response.clearCookie(cookieName, { ...this.cookieOptions(), path: '/api' });
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
