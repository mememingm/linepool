import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';

import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { settings, environmentPath } from './config';
import { fingerprint, transactionOptions } from './business';
import { PcError, PingcodeClient, pcConfigured } from './pingcode.client';
import { OperatorService } from './operator.service';

const requiredScopes = ['numbers:read', 'sms:read', 'sms:send'];
const messages: Record<string, string> = {
  PC_NOT_CONFIGURED: '请先填写 API 地址、账号 ID 和 API Key。',
  PC_OPERATOR_ACCOUNT_MISMATCH: 'API Key 所属账号与填写的账号 ID 不一致。',
  PC_OPERATOR_SCOPE_MISSING: 'API Key 缺少所需权限，请在上游重新创建 Key。',
  PC_REQUEST_UNCERTAIN: '上游连接超时或网络不可用，请核对地址与服务状态。',
  PC_HTTP_401: 'API Key 无效、已到期或已撤销。', PC_HTTP_403: '上游拒绝访问，请检查账号状态与 Key 权限。',
};
const invalid = (message: string) => new BadRequestException({ message, code: 'VALIDATION_ERROR' });

@Injectable()
export class IntegrationService {
  private configQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: DbService, private readonly pc: PingcodeClient, private readonly operator: OperatorService) {}

  async overview() {
    const [checked, synced, mapped, lastEvent] = await Promise.all([
      this.db.appSetting.findUnique({ where: { key: 'integration.pingcode.check' } }),
      this.db.appSetting.findUnique({ where: { key: 'integration.pingcode.sync' } }),
      this.db.phoneNumber.count({ where: { provider: 'pingcode', providerAccountId: settings.pingcode.accountId } }),
      this.db.webhookEvent.findFirst({ where: { provider: 'pingcode', providerAccountId: settings.pingcode.accountId }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true, status: true } }),
    ]);
    return { provider: 'pingcode', name: 'PingCode', configured: pcConfigured(), demoMode: settings.demo,
      baseUrl: settings.pingcode.baseUrl, accountId: settings.pingcode.accountId,
      apiKeyConfigured: Boolean(settings.pingcode.apiKey), receiveSecretConfigured: Boolean(settings.pingcode.receiveWebhookSecret),
      sendSecretConfigured: Boolean(settings.pingcode.sendWebhookSecret), mappedNumbers: mapped,
      receiveUrl: settings.origin + '/api/webhooks/pingcode/receive', sendUrl: settings.origin + '/api/webhooks/pingcode/send',
      publicHttps: settings.origin.startsWith('https://'), lastEvent, lastCheck: checked?.value ?? null, lastSync: synced?.value ?? null,
      requiredScopes, capabilities: { numbers: true, receiveSms: true, sendSms: true, sendStatus: 'polling', purchase: false, renew: false },
      deliveryNote: '当前开放 API 仅支持已持有号码的查询和短信收发，没有采购/续费接口。同步不会开卡、扣费或自动向 C 端售卖。',
    };
  }

  /** Claim before the external action, so concurrent/replayed POSTs cannot execute it twice. */
  async run<T>(actorId: string, action: string, body: Record<string, unknown>, key: string, operation: () => Promise<T>): Promise<T> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '')) throw invalid('Idempotency-Key 必须是 UUID。');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) throw invalid('请填写 3–500 字的操作原因。');
    const hash = fingerprint({ actorId, action, body });
    const claim = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:idempotency:' + key},0))`;
      const previous = await tx.adminIdempotency.findUnique({ where: { key } });
      if (previous) {
        if (previous.actorId !== actorId || previous.requestHash !== hash) throw new ConflictException({ message: '操作标识已用于其他请求。', code: 'IDEMPOTENCY_CONFLICT' });
        if (previous.result === null) throw new ConflictException({ message: '操作仍在处理中，请刷新核对结果。', code: 'IDEMPOTENCY_IN_PROGRESS' });
        return { replay: true, value: previous.result as T };
      }
      await tx.adminIdempotency.create({ data: { key, actorId, requestHash: hash } });
      return { replay: false, value: undefined };
    }, transactionOptions);
    if (claim.replay) return claim.value!;
    try {
      const result = await operation();
      await this.db.$transaction(async tx => {
        await tx.auditLog.create({ data: { userId: actorId, action, resourceId: 'pingcode', targetType: 'integration', reason,
          details: { outcome: action === 'INTEGRATION_CHECK' ? (result as { ok?: boolean }).ok : true } } });
        await tx.adminIdempotency.update({ where: { key }, data: { result: result as unknown as Prisma.InputJsonValue } });
      });
      return result;
    } catch (error) {
      await this.db.adminIdempotency.deleteMany({ where: { key, actorId, result: { equals: Prisma.DbNull } } });
      if (error instanceof PcError) throw new ServiceUnavailableException({ code: error.code, message: messages[error.code] ?? '上游暂不可用，请检查连接、权限和接口版本。' });
      throw error;
    }
  }

  save(body: Record<string, unknown>) {
    const job = this.configQueue.then(() => this.saveConfiguration(body));
    this.configQueue = job.catch(() => undefined);
    return job;
  }
  private async saveConfiguration(body: Record<string, unknown>) {
    const allowed = ['baseUrl', 'accountId', 'apiKey', 'receiveWebhookSecret', 'sendWebhookSecret', 'reason'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw invalid('包含不支持的配置字段。');
    if (typeof body.baseUrl !== 'string' || typeof body.accountId !== 'string') throw invalid('请填写 API 地址与账号 ID。');
    const baseUrl = body.baseUrl.trim().replace(/\/+$/, ''), accountId = body.accountId.trim();
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw invalid('API 地址格式不正确。'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash ||
      (settings.production && parsed.protocol !== 'https:') || !parsed.pathname.endsWith('/api/open/v1')) throw invalid('地址须以 /api/open/v1 结尾；生产环境须使用 HTTPS。');
    if (!/^[1-9]\d{0,14}$/.test(accountId) || !Number.isSafeInteger(Number(accountId))) throw invalid('账号 ID 须为有效正整数。');
    const next = { ...settings.pingcode, baseUrl, accountId };
    for (const field of ['apiKey', 'receiveWebhookSecret', 'sendWebhookSecret'] as const) {
      const value = body[field];
      if (value !== undefined && typeof value !== 'string') throw invalid('密钥字段须为文本。');
      if (typeof value === 'string' && value.trim()) {
        if (!/^[\x21-\x7e]{8,512}$/.test(value.trim())) throw invalid('密钥须为 8–512 位不含空格的字符。');
        next[field] = value.trim();
      }
    }
    if (!next.apiKey) throw invalid('首次配置需要填写 API Key。');
    // Resource identity includes the upstream deployment, even though the legacy DB key only includes its account ID.
    if ((baseUrl !== settings.pingcode.baseUrl || accountId !== settings.pingcode.accountId) &&
      await this.db.phoneNumber.count({ where: { provider: 'pingcode' } })) throw new ConflictException({ code: 'INTEGRATION_IDENTITY_LOCKED', message: '已有上游号码，不能直接更换平台地址或账号；请先安排资源迁移。' });
    const names = { baseUrl: 'PINGCODE_BASE_URL', accountId: 'PINGCODE_ACCOUNT_ID', apiKey: 'PINGCODE_API_KEY',
      receiveWebhookSecret: 'PINGCODE_RECEIVE_WEBHOOK_SECRET', sendWebhookSecret: 'PINGCODE_SEND_WEBHOOK_SECRET' };
    let original = '';
    try { original = await readFile(environmentPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let updated = original;
    for (const [field, name] of Object.entries(names)) {
      const line = name + '=' + JSON.stringify(next[field as keyof typeof next]);
      const pattern = new RegExp('^(?:export\\s+)?' + name + '\\s*=.*$', 'gm');
      if (pattern.test(updated)) updated = updated.replace(pattern, () => line);
      else updated = updated.replace(/\s*$/, '') + '\n' + line + '\n';
    }
    const temporary = environmentPath + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, updated, { flag: 'wx', mode: 0o600 });
      // An external deployment edit must not be overwritten by this form.
      const current = await readFile(environmentPath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
      if (current !== original) throw new ConflictException({ message: '配置被其他进程修改，请刷新重试。', code: 'CONFIG_CHANGED' });
      await rename(temporary, environmentPath);
    } finally { await unlink(temporary).catch(() => undefined); }
    Object.assign(settings.pingcode, next);
    this.pc.resetAccountCheck();
    await this.db.appSetting.deleteMany({ where: { key: { in: ['integration.pingcode.check', 'integration.pingcode.sync'] } } });
    return this.overview();
  }

  async check() {
    this.pc.resetAccountCheck();
    let result: Record<string, unknown>;
    try {
      const account = await this.pc.verifyAccount();
      const missingScopes = requiredScopes.filter(scope => !account.scopes.includes(scope));
      result = { ok: missingScopes.length === 0, connected: true, accountId: String(account.id), username: account.username,
        scopes: account.scopes, missingScopes, checkedAt: new Date().toISOString(),
        message: missingScopes.length ? '账号连接成功，但部分短信功能缺少权限。' : '账号与权限验证通过；请继续同步号码并在上游配置回调。' };
    } catch (error) {
      if (!(error instanceof PcError)) throw error;
      result = { ok: false, connected: false, code: error.code, message: messages[error.code] ?? '上游认证失败或接口响应不兼容，请核对 Key 与接口版本。', checkedAt: new Date().toISOString() };
    }
    await this.db.appSetting.upsert({ where: { key: 'integration.pingcode.check' }, create: { key: 'integration.pingcode.check', value: result as Prisma.InputJsonObject }, update: { value: result as Prisma.InputJsonObject } });
    return result;
  }
  async numbers() {
    try {
      await this.pc.verifyAccount(['numbers:read']);
      const [upstream, local] = await Promise.all([this.pc.numbers(), this.db.phoneNumber.findMany({ where: { provider: 'pingcode', providerAccountId: settings.pingcode.accountId }, select: { providerNumberId: true } })]);
      const ids = new Set(local.map(row => row.providerNumberId));
      return { items: upstream.map(row => ({ ...row, imported: ids.has(String(row.id)) })), total: upstream.length };
    } catch (error) {
      if (error instanceof PcError) throw new ServiceUnavailableException({ code: error.code, message: messages[error.code] ?? '号码拉取失败，请核对上游权限、服务状态和接口版本。' });
      throw error;
    }
  }
  async sync(body: Record<string, unknown>) {
    const rows = body.rows ?? [];
    try {
      const result = await this.operator.sync(rows);
      const summary = { refreshed: result.refreshed, imported: result.imported, unavailable: result.unavailable,
        unimportedCount: result.unimported.length, syncedAt: result.syncedAt.toISOString() };
      await this.db.appSetting.upsert({ where: { key: 'integration.pingcode.sync' }, create: { key: 'integration.pingcode.sync', value: summary }, update: { value: summary } });
      return summary;
    } catch (error) {
      if (error instanceof PcError) throw error;
      // Operator validation contains no credentials; do not expose raw Prisma/network errors.
      if (error instanceof Error && error.constructor === Error) throw invalid(error.message);
      throw error;
    }
  }
}
