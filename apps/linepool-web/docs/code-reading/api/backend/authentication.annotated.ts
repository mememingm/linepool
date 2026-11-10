/**
 * authentication.ts 中文分区导读副本：登录、账户修改与会话
 * 原文件：backend/src/authentication.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】检查密码，创建/读取/注销登录会话，更新账户资料，并提供登录守卫。
 * 【为什么这样组织】Cookie 只携带令牌，数据库存令牌摘要；每次使用会话仍检查账户及代理状态。
 * 【调用链】AuthController / WorkspaceController → Authentication → users / sessions；SessionGuard 把用户放进请求。
 * 【修改提示】会话有效期来自 Environment；密码限制来自共享契约。修改密码或邮箱的会话失效规则要与找回密码、管理员重置保持一致。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { compare, hash, hashSync } from 'bcryptjs';
import type { Request, Response, CookieOptions } from 'express';
import type { Account, AccountProfileInput, LoginInput, RegisterInput, User } from '@linepool/contracts';
import { Database } from '../../../../backend/src/database.js';
import { Environment } from '../../../../backend/src/environment.js';
import { ApiFailure } from '../../../../backend/src/http.js';

/**
 * UserRow = users 表读取出的用户记录，使用数据库字段名。这里只描述结构，执行操作需看后面的函数。
 */
export type UserRow = {
  id: string; email: string; password_hash: string; display_name: string;
  is_demo: boolean; points_balance: number; expiry_notice: boolean; created_at: Date;
  role: 'USER' | 'ADMIN'; account_status: 'ACTIVE' | 'DISABLED';
};
/**
 * SessionRequest = 带已确认用户和会话信息的 HTTP 请求。这里只描述结构，执行操作需看后面的函数。
 */
export type SessionRequest = Request & { user: User; sessionToken: string; sessionExpiresAt: Date };
/**
 * cookieName = 登录 Cookie 的固定名字。修改时要同步读取、设置和清理，旧 Cookie 也要考虑兼容。
 */
const cookieName = 'linepool_react_session';
/**
 * dummyHash = 用于不存在账户的占位密码摘要，让未知账户同样进行密码比较，减少通过响应差异猜测账号的机会。
 */
const dummyHash = hashSync('invalid-account-placeholder', 12);
/**
 * digest = 令牌摘要。将令牌转换成 SHA-256 摘要，数据库保存摘要而非原始令牌。
 */
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
/**
 * toUser = 把数据库用户字段转换成接口用户结构，时间转文字，不把 password_hash 返回给前端。
 */
export function toUser(row: UserRow): User {
  return {
    id: row.id, email: row.email, displayName: row.display_name,
    isDemo: row.is_demo, pointsBalance: row.points_balance, createdAt: row.created_at.toISOString(), role: row.role,
  };
}
/**
 * ==================== 01 登录、账户修改与会话 / Authentication ====================
 * Authentication = 登录、账户修改与会话。检查密码，创建/读取/注销登录会话，更新账户资料，并提供登录守卫。
 */
@Injectable()
export class Authentication {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  /**
   * sandboxEnabled = 是否启用本地沙盒的计算属性，要求非生产且 LOCAL_SANDBOX=true。
   */
  get sandboxEnabled() { return this.environment.values.NODE_ENV !== 'production' && this.environment.values.LOCAL_SANDBOX; }
  /**
   * cookieOptions = 会话 Cookie 选项。HttpOnly 不让页面脚本读取，生产使用 Secure，路径覆盖整个应用。
   */
  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.environment.values.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
  }
  /**
   * setSessionCookie = 写入登录 Cookie，同时清理旧的 /api 路径 Cookie，避免同名 Cookie 互相矛盾。
   */
  setSessionCookie(token: string, expiresAt: Date, response: Response) {
    // Remove the legacy API-only cookie so two cookies with the same name cannot disagree.
    response.clearCookie(cookieName, { ...this.cookieOptions(), path: '/api' });
    response.cookie(cookieName, token, { ...this.cookieOptions(), expires: expiresAt });
  }
  /**
   * issueSession = 签发登录会话。生成随机令牌，事务中再查账户和代理状态，存摘要与到期时间，成功后设置 Cookie。
   */
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
  /**
   * login = 检查账户和密码。admin 别名只走非生产演示映射；验证后签发会话，密码摘要来自数据库。
   */
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
  /**
   * register = 注册账户。先生成密码摘要，插入用户，重复邮箱返回 EMAIL_EXISTS，成功后签发会话。
   */
  async register(input: RegisterInput, response: Response) {
    const passwordHash = await hash(input.password, 12);
    const { rows: [row] } = await this.db.query<UserRow>(
      'INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING *',
      [input.email, passwordHash, input.displayName],
    );
    if (!row) throw new ApiFailure(409, 'EMAIL_EXISTS', 'Email is already registered');
    return this.issueSession(toUser(row), response, row.password_hash);
  }
  /**
   * updateProfile = 修改登录账户资料。在事务锁内再次校验当前会话；敏感修改校验当前密码，改密码或邮箱后清理其他会话及重置令牌。
   */
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
  /**
   * getSession = 读取并验证会话。检查 Cookie 格式、摘要对应记录、到期时间、账户状态和代理状态；无效返回 null。
   */
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
  /**
   * logout = 删除当前令牌对应的数据库会话，并清除新旧路径的会话 Cookie。
   */
  async logout(request: SessionRequest, response: Response) {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(request.sessionToken)]);
    response.clearCookie(cookieName, this.cookieOptions());
    response.clearCookie(cookieName, { ...this.cookieOptions(), path: '/api' });
  }
}
/**
 * ==================== 02 登录、账户修改与会话 / SessionGuard ====================
 * SessionGuard = 登录守卫。受保护的接口先通过它检查会话，再执行控制器方法。
 */
@Injectable()
export class SessionGuard implements CanActivate {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly authentication: Authentication) {}
  /**
   * canActivate = 确认请求已登录。成功后将 user、sessionToken、sessionExpiresAt 填入请求，失败返回 UNAUTHENTICATED。
   */
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
