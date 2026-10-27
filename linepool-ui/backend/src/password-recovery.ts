import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { hash } from 'bcryptjs';
import nodemailer from 'nodemailer';
import type { ForgotPasswordInput, ResetPasswordInput } from '@linepool/contracts';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure } from './http.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class PasswordRecovery {
  private readonly logger = new Logger(PasswordRecovery.name);
  constructor(private readonly db: Database, private readonly environment: Environment) {}

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
        if (!result.accepted.length) throw new Error('Email was not accepted');
      } catch {
        await this.db.query('DELETE FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
        // Do not log recipients, credentials, raw SMTP errors or reset links.
        this.logger.error('Password recovery email delivery failed; check SMTP configuration.');
      } finally { transport.close(); }
    }
    // Unknown, disabled and recently requested accounts receive the same response.
    return { accepted: true as const };
  }

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
