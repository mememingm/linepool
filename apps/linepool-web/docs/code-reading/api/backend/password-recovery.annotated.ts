/**
 * password-recovery.ts 中文分区导读副本：密码找回与重置
 * 原文件：backend/src/password-recovery.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】生成短期重置令牌并通过配置的邮件服务投递，使用令牌时修改密码并使旧会话失效。
 * 【为什么这样组织】未知邮箱与已登记邮箱使用相同受理响应，避免查询账户存在性；令牌单次使用。
 * 【调用链】找回请求 → 生成/存令牌摘要 → 邮件；重置请求 → 核验并消费令牌 → 更新密码 → 删除会话。
 * 【修改提示】有效期当前 30 分钟、同账户重新发起间隔 60 秒；修改时同步 SQL 和邮件文字。SMTP 未配置时返回不可用。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { hash } from 'bcryptjs';
import nodemailer from 'nodemailer';
import type { ForgotPasswordInput, ResetPasswordInput } from '@linepool/contracts';
import { Database } from '../../../../backend/src/database.js';
import { Environment } from '../../../../backend/src/environment.js';
import { ApiFailure } from '../../../../backend/src/http.js';
import { safeErrorDetails } from '../../../../backend/src/error-summary.js';

/**
 * digest = 令牌摘要。将令牌转换成 SHA-256 摘要，数据库保存摘要而非原始令牌。
 */
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * ==================== 01 密码找回与重置 / PasswordRecovery ====================
 * PasswordRecovery = 密码找回与重置。生成短期重置令牌并通过配置的邮件服务投递，使用令牌时修改密码并使旧会话失效。
 */
@Injectable()
export class PasswordRecovery {
  private readonly logger = new Logger(PasswordRecovery.name);
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, private readonly environment: Environment) {}

  /**
   * request = 受理密码找回。要求邮件配置，创建短期令牌摘要并尝试发信；未知/停用/刚请求过的账号统一返回 accepted。
   */
  async request(input: ForgotPasswordInput) {
    const config = this.environment.values;
    if (!config.SMTP_HOST || !config.SMTP_FROM) {
      throw new ApiFailure(503, 'PASSWORD_RECOVERY_UNAVAILABLE', 'Password recovery email is not configured');
    }
    const token = randomBytes(32).toString('hex');
    const tokenHash = digest(token);
    const recipient = await this.db.transaction(async client => {
      const { rows: [user] } = await client.query<{ id: string; email: string }>(
        "SELECT id,email FROM users WHERE email=$1 AND account_status='ACTIVE' FOR UPDATE", [input.email]);
      if (!user) return null;
      // Serialize issuance with profile changes, resets and account disabling.
      const result = await client.query(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
        VALUES($1,$2,clock_timestamp()+interval '30 minutes')
        ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
          created_at=clock_timestamp(),expires_at=EXCLUDED.expires_at
        WHERE password_reset_tokens.created_at<=clock_timestamp()-interval '60 seconds'
        RETURNING user_id`, [user.id, tokenHash]);
      return result.rowCount ? user.email : null;
    });
    if (recipient) {
      const transport = nodemailer.createTransport({
        host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
        requireTLS: config.NODE_ENV === 'production' && !config.SMTP_SECURE,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
        connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 6000,
        disableFileAccess: true, disableUrlAccess: true,
      });
      try {
        // The fragment is kept out of HTTP requests, access logs and Referer headers.
        const link = `${config.WEB_ORIGIN}/reset-password#token=${token}`;
        const result = await transport.sendMail({
          from: { name: 'LINEPOOL', address: config.SMTP_FROM }, to: recipient,
          subject: '重置你的 LINEPOOL 密码 / Reset your LINEPOOL password',
          text: `请打开以下链接设置新密码，链接 30 分钟内有效且仅可使用一次：\n\n${link}\n\nOpen the link to reset your password. It expires in 30 minutes and can be used once.\n如果不是你本人操作，请忽略此邮件。 / If you did not request this, ignore this email.`,
        });
        if (!result.accepted.length) throw Object.assign(new Error('Email was not accepted'), { code: 'SMTP_NOT_ACCEPTED' });
      } catch (error) {
        // Do not log recipients, credentials, raw SMTP responses or reset links.
        this.logger.error({ message: 'Password recovery email delivery failed; check SMTP configuration.', ...safeErrorDetails(error) });
        await this.db.query('DELETE FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
      } finally { transport.close(); }
    }
    // Unknown, disabled and recently requested accounts receive the same response.
    return { accepted: true as const };
  }

  /**
   * reset = 使用一次性重置令牌。锁定用户后再次检查并删除有效令牌，再更新密码摘要和删除所有旧会话。
   */
  async reset(input: ResetPasswordInput) {
    const tokenHash = digest(input.token);
    const passwordHash = await hash(input.newPassword, 12);
    await this.db.transaction(async client => {
      const { rows: [pending] } = await client.query<{ user_id: string }>(
        'SELECT user_id FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
      const invalid = () => new ApiFailure(400, 'INVALID_RESET_TOKEN', 'Password reset link is invalid or expired');
      if (!pending) throw invalid();
      const { rows: [user] } = await client.query<{ account_status: string }>(
        'SELECT account_status FROM users WHERE id=$1 FOR UPDATE', [pending.user_id]);
      if (!user || user.account_status !== 'ACTIVE') throw invalid();
      // Recheck after acquiring the user lock: concurrent resets can consume this token.
      const consumed = await client.query(`DELETE FROM password_reset_tokens
        WHERE user_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() RETURNING user_id`, [pending.user_id, tokenHash]);
      if (!consumed.rowCount) throw invalid();
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [pending.user_id, passwordHash]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [pending.user_id]);
    });
    return { changed: true as const };
  }
}
