/**
 * pingcode-adapter.ts 中文分区导读副本：PingCode 报文与内部数据适配
 * 原文件：backend/src/providers/pingcode-adapter.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】检查供应商返回的号码/短信结构，统一手机号与状态，封装供应商请求方法。
 * 【为什么这样组织】供应商字段与项目内部契约分开，协议变更只需在适配边界转换。
 * 【调用链】PingCodeTransport → PingCodeAdapter → 内部 ProviderNumber / ProviderInbound。
 * 【修改提示】代码中的路径/报文需以确认的供应商协议为准；存在适配器不代表 main.ts 已接入真实传输。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * time = 供应商时间格式检查规则，使用 ISO 日期时间文字。
 */
const time = z.iso.datetime();
/**
 * externalId = 供应商数字编号规则，要求正的安全整数；内部映射时转成文字。
 */
const externalId = z.number().int().positive().safe();
/**
 * numberStatus = 供应商号码状态规则：就绪、激活、不可用、过期或停用，与项目内部状态需要映射。
 */
const numberStatus = z.enum(['READY', 'ACTIVE', 'UNAVAILABLE', 'EXPIRED', 'DISABLED']);
/**
 * phone = 供应商手机号格式检查规则，可带或不带 +；内部再统一格式。
 */
const phone = z.string().regex(/^\+?[0-9]{2,32}$/);
/**
 * pingCodeNumberSchema = 供应商号码报文检查规则，包括数字编号、可选手机号/ICCID、状态和可选到期时间。
 * 字段速读：id 记录编号；phoneNumber 电话号码；status 状态；expiresAt 到期时间。
 */
export const pingCodeNumberSchema = z.object({
  id: externalId, phoneNumber: phone.optional(), iccid: z.string().optional(), status: numberStatus, expiresAt: time.optional(),
});
/**
 * pingCodeSmsSchema = 供应商短信报文检查规则，并核对收发方向、消息编号前缀和状态相符。
 * 字段速读：id 记录编号；numberId 号码编号；phoneNumber 电话号码；status 状态；createdAt 创建时间。
 */
export const pingCodeSmsSchema = z.object({
  id: z.string().regex(/^(IN-[0-9a-f-]{36}|OUT-[0-9]+)$/i), direction: z.enum(['INBOUND', 'OUTBOUND']),
  numberId: externalId, phoneNumber: phone.optional(), counterparty: z.string(), content: z.string(),
  status: z.enum(['RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERABLE', 'FAILED', 'UNCERTAIN']),
  occurredAt: time, createdAt: time, errorCode: z.string().optional(),
}).refine(value => value.direction === 'INBOUND'
  ? value.id.startsWith('IN-') && value.status === 'RECEIVED'
  : value.id.startsWith('OUT-') && value.status !== 'RECEIVED', 'SMS direction, ID and status must agree');
/**
 * pageSchema = 供应商游标分页规则。hasMore=true 必须返回 nextCursor，否则无法安全读下一页。
 * 字段速读：limit 数量上限。
 */
const pageSchema = z.object({ limit: z.number().int().min(1).max(100), hasMore: z.boolean(), nextCursor: z.string().min(1).optional() })
  .refine(page => !page.hasMore || Boolean(page.nextCursor), 'Missing nextCursor');
/**
 * receiveEventSchema = 此文件本地解码辅助使用的接收事件结构；与已注册回调控制器提出的项目感知结构不同。
 * 字段速读：data 返回的业务数据。
 */
const receiveEventSchema = z.object({
  eventId: z.string().min(1), event: z.literal('sms.received'), occurredAt: time, test: z.boolean().optional(),
  data: z.object({ messageId: z.string().regex(/^IN-[0-9a-f-]{36}$/i), numberId: externalId, phoneNumber: phone,
    from: z.string(), content: z.string() }),
});
/**
 * ProviderNumber = numberStatus 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ProviderNumber = {
  externalNumberId: string; phoneNumber: string | null; iccid: string | null;
  status: z.infer<typeof numberStatus>; resourceExpiresAt: string | null;
};
/**
 * ProviderInbound = 适配成内部格式的供应商短信。这里只描述结构，执行操作需看后面的函数。
 */
export type ProviderInbound = {
  externalMessageId: string; externalNumberId: string; phoneNumber: string | null;
  sender: string; body: string; receivedAt: string; upstreamCreatedAt: string | null;
};
/**
 * PingCodeRequest = 供应商请求的方法、路径、查询和请求体。这里只描述结构，执行操作需看后面的函数。
 */
export type PingCodeRequest = { method: 'GET'; path: string; query: Record<string, string> };
/**
 * PingCodeResponse = 供应商请求返回的状态与内容。这里只描述结构，执行操作需看后面的函数。
 */
export type PingCodeResponse = { status: number; body: unknown; headers?: Record<string, string> };
/** Deliberately injected: this work ships no fetch/HTTP transport and reads no API keys. */
/**
 * PingCodeTransport = 请求传输接口，只约定 GET 请求与响应结构；本文件没有真实 fetch/HTTP 实现。
 */
export interface PingCodeTransport { request(input: PingCodeRequest): Promise<PingCodeResponse> }
/**
 * ==================== 01 PingCode 报文与内部数据适配 / ProviderError ====================
 * ProviderError = 供应商调用错误。携带受限错误编号、HTTP 状态和可选重试等待秒数，不复制上游原始正文。
 */
export class ProviderError extends Error {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(readonly code: string, readonly status: number, readonly retryAfterSeconds: number | null = null) {
    super(code);
  }
}
/**
 * normalizePhone = 检查并统一手机号为带单个 + 的格式，便于号码映射时比较。
 */
export const normalizePhone = (value: string) => `+${phone.parse(value).replace(/^\+/, '')}`;
/**
 * mapNumber = 将供应商号码字段转换成内部 ProviderNumber，数字编号转文字，缺失字段统一为 null。
 */
function mapNumber(value: z.infer<typeof pingCodeNumberSchema>): ProviderNumber {
  return { externalNumberId: String(value.id), phoneNumber: value.phoneNumber ? normalizePhone(value.phoneNumber) : null,
    iccid: value.iccid ?? null, status: value.status, resourceExpiresAt: value.expiresAt ?? null };
}
/**
 * mapPingCodeInbound = 检查并转换上游接收短信；OUTBOUND 发出短信明确拒绝，不作为用户收件箱内容导入。
 */
export function mapPingCodeInbound(value: unknown): ProviderInbound {
  const sms = pingCodeSmsSchema.parse(value);
  if (sms.direction !== 'INBOUND') throw new ProviderError('OUTBOUND_NOT_SUPPORTED', 422);
  return { externalMessageId: sms.id, externalNumberId: String(sms.numberId),
    phoneNumber: sms.phoneNumber ? normalizePhone(sms.phoneNumber) : null, sender: sms.counterparty,
    body: sms.content, receivedAt: sms.occurredAt, upstreamCreatedAt: sms.createdAt };
}

/** Document-backed read adapter. Purchase/allocation are explicitly unavailable, never fabricated. */
/**
 * ==================== 02 PingCode 报文与内部数据适配 / PingCodeAdapter ====================
 * PingCodeAdapter = PingCode 报文与内部数据适配。检查供应商返回的号码/短信结构，统一手机号与状态，封装供应商请求方法。
 */
export class PingCodeAdapter {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly transport: PingCodeTransport) {}
  /**
   * get = 调用注入的传输发送 GET 请求，统一处理非成功 HTTP 状态和 Retry-After；不会自行读取供应商密钥。
   */
  private async get(path: string, query: Record<string, string> = {}) {
    const result = await this.transport.request({ method: 'GET', path: `/pingcode/api/open/v1${path}`, query });
    if (result.status < 200 || result.status >= 300) {
      const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(result.body);
      const retry = result.headers?.['retry-after'] ?? result.headers?.['Retry-After'];
      throw new ProviderError(parsed.success ? parsed.data.error.code : 'INVALID_UPSTREAM_ERROR', result.status,
        retry && /^\d+$/.test(retry) ? Number(retry) : null);
    }
    return result.body;
  }
  /**
   * account = 读取供应商账户 /me 并检查编号、名称和权限范围；不是当前网站用户账户。
   */
  async account() {
    return z.object({ id: externalId, username: z.string(), scopes: z.array(z.string()), expiresAt: time.optional() }).parse(await this.get('/me'));
  }
  /**
   * numbers = 按游标读取供应商号码列表并转换内部结构；不是用户已分配号码列表。
   */
  async numbers(input: { limit?: number; cursor?: string; status?: z.infer<typeof numberStatus> } = {}) {
    const query = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).optional(), status: numberStatus.optional() }).parse(input);
    const result = z.object({ data: z.array(pingCodeNumberSchema), page: pageSchema }).parse(await this.get('/numbers', this.query(query)));
    return { data: result.data.map(mapNumber), page: result.page };
  }
  /**
   * number = 按规范手机号查询一条供应商号码资料。
   */
  async number(phoneNumber: string) {
    return mapNumber(pingCodeNumberSchema.parse(await this.get('/numbers/by-phone', { phoneNumber: normalizePhone(phoneNumber) })));
  }
  /**
   * messages = 按号码、游标和可选时间拉取上游接收短信，检查分页并拒绝出站短信。
   */
  async messages(input: { phoneNumber: string; limit?: number; cursor?: string; createdAfter?: string }) {
    const query = z.object({ phoneNumber: phone, limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).optional(), createdAfter: time.optional() }).parse(input);
    const result = z.object({ data: z.array(pingCodeSmsSchema), page: pageSchema }).parse(await this.get('/sms',
      { ...this.query(query), phoneNumber: normalizePhone(query.phoneNumber), direction: 'INBOUND' }));
    // Reject an invalid upstream direction instead of accidentally delivering outbound messages.
    return { data: result.data.map(mapPingCodeInbound), page: result.page };
  }
  /**
   * message = 按 IN- 消息编号读取一条上游接收短信并转换格式。
   */
  async message(id: string) {
    const valid = z.string().regex(/^IN-[0-9a-f-]{36}$/i).parse(id);
    return mapPingCodeInbound(await this.get(`/sms/${encodeURIComponent(valid)}`));
  }
  /**
   * purchase = 真实采购不可用，直接抛 PURCHASE_NOT_DOCUMENTED；不执行供应商购买。
   */
  purchase(): never { throw new ProviderError('PURCHASE_NOT_DOCUMENTED', 501); }
  /**
   * allocate = 真实供应商分配不可用，直接抛 ALLOCATION_NOT_DOCUMENTED。
   */
  allocate(): never { throw new ProviderError('ALLOCATION_NOT_DOCUMENTED', 501); }
  /**
   * release = 真实供应商释放不可用，直接抛 RELEASE_NOT_DOCUMENTED。
   */
  release(): never { throw new ProviderError('RELEASE_NOT_DOCUMENTED', 501); }
  /**
   * query = 把已校验的查询字段转换成文字键值，并去掉 undefined，交给传输层编码发送。
   */
  private query(input: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  }
}

/** Local verification helper only; no public webhook endpoint is enabled. 300s is our local replay policy. */
// 阅读边界：下面保留的原英文注释描述此本地辅助函数的初始范围。
// 当前应用已另行注册 pingcode-webhook.ts 的回调入口，实际协议/项目字段以那个控制器为准；此函数不是该入口调用链。
/**
 * decodePingCodeWebhook = 本地回调解码辅助。校验签名、300 秒时间窗口和事件编号，再返回规范短信；实际注册入口在 pingcode-webhook.ts。
 */
export function decodePingCodeWebhook(rawBody: Buffer, headers: Record<string, string | undefined>, secret: string, now = Date.now()) {
  const timestamp = headers['x-pingcode-timestamp'] ?? '';
  const signature = headers['x-pingcode-signature'] ?? '';
  if (!secret || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    throw new ProviderError('WEBHOOK_SIGNATURE_INVALID', 401);
  }
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new ProviderError('WEBHOOK_SIGNATURE_INVALID', 401);
  const event = receiveEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
  if (event.eventId !== headers['x-pingcode-event-id']) throw new ProviderError('WEBHOOK_EVENT_ID_MISMATCH', 400);
  return { eventId: event.eventId, test: event.test === true || headers['x-pingcode-test'] === 'true',
    message: { externalMessageId: event.data.messageId, externalNumberId: String(event.data.numberId),
      phoneNumber: normalizePhone(event.data.phoneNumber), sender: event.data.from, body: event.data.content,
      receivedAt: event.occurredAt, upstreamCreatedAt: null } satisfies ProviderInbound };
}
