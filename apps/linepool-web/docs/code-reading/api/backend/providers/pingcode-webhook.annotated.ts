/**
 * pingcode-webhook.ts 中文分区导读副本：上游短信回调入口
 * 原文件：backend/src/providers/pingcode-webhook.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】接收原始回调，验证签名、时间和事件编号，再记录并尝试路由短信。
 * 【为什么这样组织】必须在读取可信业务字段和写库之前验证回调来源，重放事件需要去重。
 * 【调用链】供应商 POST /api/webhooks/pingcode → 签名验证 → WebhookInbox。
 * 【修改提示】协议仍需上游确认；签名依赖 main.ts 保留原始字节。真实密钥只来自配置，不写入资料。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Environment } from '../../../../../backend/src/environment.js';
import { ApiFailure, SchemaPipe, SignedWebhook } from '../../../../../backend/src/http.js';
import { WebhookInbox } from '../../../../../backend/src/providers/webhook-inbox.js';

/**
 * identifier = 供应商项目/号码编号整理规则。接收非空文字或安全正整数，统一转换成文字编号。
 */
const identifier = z.union([
  z.string().trim().min(1).max(200),
  z.number().int().positive().safe(),
]).transform(value => String(value));
/**
 * envelopeSchema = 回调事件外层规则。检查事件编号、sms.received 类型、发生时间和可选测试标记。
 */
const envelopeSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  event: z.literal('sms.received'),
  occurredAt: z.string().datetime({ offset: true }),
  test: z.boolean().optional(),
});
/**
 * messageSchema = 真实短信回调内容规则。要求项目、号码、手机号、发送方和内容，供验签之后读取。
 * 字段速读：messageId 消息编号；numberId 号码编号；phoneNumber 电话号码。
 */
const messageSchema = envelopeSchema.extend({
  data: z.object({
    messageId: z.string().trim().min(1).max(200),
    projectId: identifier,
    numberId: identifier,
    phoneNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
    from: z.string().max(500),
    content: z.string().max(16000),
  }),
});
/**
 * RawWebhookRequest = 额外保留了原始报文字节的 HTTP 请求。这里只描述结构，执行操作需看后面的函数。
 */
export type RawWebhookRequest = Request & { rawBody?: Buffer };

/** LP's proposed project-aware contract; PC must confirm it before live integration. */
/**
 * ==================== 01 上游短信回调入口 / PingCodeWebhookController ====================
 * PingCodeWebhookController = 上游短信回调入口。接收原始回调，验证签名、时间和事件编号，再记录并尝试路由短信。
 */
@Controller('webhooks/pingcode')
export class PingCodeWebhookController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly environment: Environment, private readonly inbox: WebhookInbox) {}

  /**
   * receive = 已注册的 POST /api/webhooks/pingcode 入口。校验配置、原始 JSON、签名、时间和事件编号；已签名测试事件仅确认接收，普通短信先持久化再路由。
   * 接口：POST /api/webhooks/pingcode。接收：登录用户与请求信息(request)。
   */
  @Post()
  @HttpCode(200)
  @SignedWebhook()
  async receive(@Req() request: RawWebhookRequest) {
    const secret = this.environment.values.PINGCODE_WEBHOOK_SECRET;
    if (!secret) throw new ApiFailure(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signing secret is not configured');
    if (!Buffer.isBuffer(request.rawBody)) {
      throw new ApiFailure(415, 'WEBHOOK_JSON_REQUIRED', 'Webhook requires an application/json body');
    }
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
      throw new ApiFailure(415, 'WEBHOOK_ENCODING_UNSUPPORTED', 'Compressed webhook bodies are not supported');
    }
    const timestamp = request.get('x-pingcode-timestamp') ?? '';
    const signature = request.get('x-pingcode-signature') ?? '';
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
      throw new ApiFailure(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature or timestamp is invalid');
    }
    // 根据原始字节重算 HMAC 签名，再用 timingSafeEqual 比较。不能把 JSON 重新排版后再验签，因为字节已经改变。
    const expected = createHmac('sha256', secret).update(timestamp).update('.').update(request.rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
      throw new ApiFailure(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature or timestamp is invalid');
    }
    const envelope = new SchemaPipe(envelopeSchema).transform(request.body);
    if (request.get('x-pingcode-event-id') !== envelope.eventId) {
      throw new ApiFailure(400, 'WEBHOOK_EVENT_ID_MISMATCH', 'Event header does not match request body');
    }
    // Only the signed body may mark a delivery as a connection check, not an unsigned header.
    if (envelope.test === true) return { received: true };
    const event = new SchemaPipe(messageSchema).transform(request.body);
    if (Date.parse(event.occurredAt) > Date.now() + 300000) {
      throw new ApiFailure(400, 'WEBHOOK_TIME_INVALID', 'Message reception time is in the future');
    }
    await this.inbox.recordVerified({
      eventId: event.eventId, messageId: event.data.messageId,
      projectId: event.data.projectId, numberId: event.data.numberId,
      phoneNumber: event.data.phoneNumber, sender: event.data.from,
      content: event.data.content, occurredAt: event.occurredAt,
    });
    // Unknown ownership remains durably saved and private; the retry worker can route it later.
    await this.inbox.route(event.data.messageId);
    return { received: true };
  }
}
