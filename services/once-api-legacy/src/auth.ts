import { BadRequestException, CanActivate, ConflictException, ExecutionContext, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { DbService } from './db.service';
import { settings } from './config';
import { ChangePasswordDto, CredentialsDto, ForgotPasswordDto, ResetPasswordDto } from './dto';

const scrypt = promisify(scryptCallback);
const cookieName = 'once_session';
const lifetime = 7 * 86400000;
const resetLifetime = 60 * 60000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export type AuthedRequest = Request & { account: { id: string; email: string; role: string } };
const cookieOptions = { httpOnly: true, secure: settings.production, sameSite: 'strict' as const, path: '/' };

export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return salt + ':' + derived.toString('hex');
}

@Injectable()
export class AuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly db: DbService) {}
  throttle(key: string) {
    const now = Date.now();
    for (const [id, value] of this.attempts) if (value.until <= now) this.attempts.delete(id);
    if (this.attempts.size >= 10000 && !this.attempts.has(key)) throw new HttpException('Too many requests', 429);
    const attempt = this.attempts.get(key) || { count: 0, until: now + 15 * 60000 };
    if (++attempt.count > 20) throw new HttpException('Too many attempts. Try again later.', 429);
    this.attempts.set(key, attempt);
  }
  async register(input: CredentialsDto, response: Response) {
    const hashed = await passwordHash(input.password);
    try {
      const user = await this.db.user.create({ data: { email: input.email.trim().toLowerCase(), passwordHash: hashed, pointAccount: { create: {} } } });
      return await this.session(user, response);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This email is already registered');
      throw error;
    }
  }
  async login(input: CredentialsDto, response: Response) {
    const user = await this.db.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    const [salt, stored] = (user?.passwordHash || '00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
    const derived = await scrypt(input.password, salt, 64) as Buffer;
    if (!user || !timingSafeEqual(Buffer.from(stored, 'hex'), derived)) throw new UnauthorizedException('Invalid email or password');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('账号已被禁用，请联系管理员。');
    return this.session(user, response);
  }
  private async session(user: { id: string; email: string; role: string }, response: Response) {
    const token = randomBytes(32).toString('hex');
    await this.db.$transaction([
      this.db.session.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + lifetime) } }),
      this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);
    response.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
    return { id: user.id, email: user.email };
  }
  async account(request: Request) {
    const token: unknown = request.cookies?.[cookieName];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Sign in required');
    const session = await this.db.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
    if (!session || session.user.status !== 'ACTIVE' || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Session expired');
    return { id: session.user.id, email: session.user.email, role: session.user.role };
  }
  async changePassword(request: AuthedRequest, input: ChangePasswordDto) {
    const user = await this.db.user.findUnique({ where: { id: request.account.id } });
    if (!user) throw new UnauthorizedException('请重新登录。');
    const [salt, stored] = user.passwordHash.split(':');
    const current = await scrypt(input.currentPassword, salt, 64) as Buffer;
    if (!timingSafeEqual(Buffer.from(stored, 'hex'), current)) throw new BadRequestException('当前密码不正确。');
    if (input.newPassword === input.currentPassword) throw new BadRequestException('新密码不能与当前密码相同。');
    const next = await passwordHash(input.newPassword);
    const token = request.cookies[cookieName] as string;
    await this.db.$transaction(async tx => {
      const updated = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash: next } });
      if (updated.count !== 1) throw new ConflictException('密码已发生变化，请重新验证当前密码。');
      await tx.session.deleteMany({ where: { userId: user.id, tokenHash: { not: hash(token) } } });
    });
    return { ok: true };
  }
  async forgotPassword(input: ForgotPasswordDto) {
    const email = input.email.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return { ok: true };
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    await this.db.$transaction([
      this.db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
      this.db.passwordResetToken.create({ data: { tokenHash: hash(token), userId: user.id, expiresAt: new Date(now.getTime() + resetLifetime) } }),
    ]);
    // The demo environment has no mail provider, so the UI can show this one-time link locally.
    return settings.demo ? { ok: true, resetToken: token, expiresAt: new Date(now.getTime() + resetLifetime).toISOString() } : { ok: true };
  }
  async resetPassword(input: ResetPasswordDto) {
    const tokenHash = hash(input.token);
    const record = await this.db.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
    const now = new Date();
    if (!record || record.usedAt || record.expiresAt <= now || record.user.status !== 'ACTIVE') {
      throw new BadRequestException('重置链接无效或已过期。');
    }
    const next = await passwordHash(input.newPassword);
    await this.db.$transaction(async tx => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException('重置链接无效或已过期。');
      const updated = await tx.user.updateMany({ where: { id: record.userId, status: 'ACTIVE' }, data: { passwordHash: next } });
      if (updated.count !== 1) throw new BadRequestException('重置链接无效或已过期。');
      await tx.session.deleteMany({ where: { userId: record.userId } });
      await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } });
    });
    return { ok: true } as const;
  }
  async logout(request: Request, response: Response) {
    const token = request.cookies?.[cookieName];
    if (typeof token === 'string') await this.db.session.deleteMany({ where: { tokenHash: hash(token) } });
    response.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    request.account = await this.auth.account(request);
    return true;
  }
}
