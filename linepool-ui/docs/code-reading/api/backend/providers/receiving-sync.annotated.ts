/**
 * receiving-sync.ts 中文分区导读副本：模拟接收同步与短信归属
 * 原文件：backend/src/providers/receiving-sync.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】读取模拟上游消息，绑定模拟号码，并把短信按当时分配关系归到用户。
 * 【为什么这样组织】号码会多次分配，短信必须按平台、归属和有效时间段路由，避免归给后来的持有人。
 * 【调用链】沙盒模拟消息 → ReceivingSync → mock 表、分配与 sms_messages。
 * 【修改提示】本实现使用 pingcode-mock；修改短信匹配需保留接收时间和分配窗口检查。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../../../../backend/src/database.js';
import { ApiFailure } from '../../../../../backend/src/http.js';
import { normalizePhone, type ProviderInbound, type ProviderNumber } from '../../../../../backend/src/providers/pingcode-adapter.js';
import { allocationStatus, ReceivingProvider } from '../../../../../backend/src/providers/receiving-provider.js';

/**
 * provider = 本文件固定使用 pingcode-mock 来源，与真实来源的回执分开处理。
 */
const provider = 'pingcode-mock';
/**
 * messageSchema = 内部模拟短信结构检查规则，包含供应商消息/号码编号、内容与接收时间。
 * 字段速读：phoneNumber 电话号码。
 */
const messageSchema = z.object({
  externalMessageId: z.string().regex(/^IN-[0-9a-f-]{36}$/i), externalNumberId: z.string().regex(/^[1-9][0-9]*$/),
  phoneNumber: z.string().nullable(), sender: z.string(), body: z.string(), receivedAt: z.iso.datetime(),
  upstreamCreatedAt: z.iso.datetime().nullable(),
});
/** Explicit trusted Mock routing context. The supplied PingCode document has no platform field. */
/**
 * MockInboundRoute = 模拟短信归属的路由参数。这里只描述结构，执行操作需看后面的函数。
 */
export type MockInboundRoute = { numberId: string; allocationId: string; service: string };

/**
 * ==================== 01 模拟接收同步与短信归属 / ReceivingSync ====================
 * ReceivingSync = 模拟接收同步与短信归属。读取模拟上游消息，绑定模拟号码，并把短信按当时分配关系归到用户。
 */
@Injectable()
export class ReceivingSync {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, private readonly receiving: ReceivingProvider) {}
  /**
   * pullMock = 按明确号码绑定逐页读取模拟短信并导入，统计新增与重复；检查游标重复和最多 100 页，避免死循环。
   */
  async pullMock(route: MockInboundRoute) {
    const { rows: [binding] } = await this.db.query<{ phone_number: string }>(
      `SELECT n.phone_number FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id
       WHERE b.provider=$1 AND n.id=$2`, [provider, route.numberId]);
    if (!binding) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Explicit Mock binding is required');
    let cursor: string | undefined;
    const seen = new Set<string>();
    const result = { imported: 0, duplicates: 0 };
    for (let page = 0; page < 100; page++) {
      const batch = await this.receiving.reader.messages({ phoneNumber: binding.phone_number, cursor });
      for (const message of batch.data) {
        const saved = await this.receiveMock(route, message);
        if (saved.status === 'IMPORTED') result.imported++;
        if (saved.status === 'DUPLICATE') result.duplicates++;
      }
      if (!batch.page.hasMore) return result;
      cursor = batch.page.nextCursor!;
      if (seen.has(cursor)) throw new ApiFailure(502, 'PROVIDER_CURSOR_REPEATED', 'Provider returned a repeated cursor');
      seen.add(cursor);
    }
    throw new ApiFailure(502, 'PROVIDER_PAGE_LIMIT', 'Mock sync exceeded the page limit');
  }
  // Internal-only helpers; deliberately no controller, scheduler, live binding or webhook route.
  /**
   * bindMockNumber = 将明确对应的本地号码与模拟上游编号绑定，核对手机号和平台映射，拒绝已有冲突。
   */
  async bindMockNumber(numberId: string, resource: ProviderNumber) {
    if (!resource.phoneNumber) throw new ApiFailure(409, 'PROVIDER_NUMBER_WITHOUT_PHONE', 'Number is not ready for binding');
    return this.db.transaction(async client => {
      const { rows: [number] } = await client.query<{ phone_number: string }>('SELECT phone_number FROM phone_numbers WHERE id=$1 FOR UPDATE', [numberId]);
      if (!number || normalizePhone(number.phone_number) !== normalizePhone(resource.phoneNumber!)) {
        throw new ApiFailure(409, 'PROVIDER_NUMBER_MISMATCH', 'Explicit number mapping is required');
      }
      const { rows: [slot] } = await client.query<{ platform_id: string }>(
        'SELECT platform_id FROM number_platforms WHERE number_id=$1 AND provider=$2 FOR UPDATE', [numberId, provider]);
      if (!slot) throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Number has no mock platform mapping to bind');
      await client.query(`INSERT INTO provider_resource_bindings(provider,external_project_id,external_number_id,number_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(provider,external_number_id) DO NOTHING`, [provider, slot.platform_id, resource.externalNumberId, numberId]);
      const { rows: [binding] } = await client.query<{ number_id: string }>(
        'SELECT number_id FROM provider_resource_bindings WHERE provider=$1 AND external_number_id=$2', [provider, resource.externalNumberId]);
      if (binding?.number_id !== numberId) throw new ApiFailure(409, 'PROVIDER_NUMBER_MISMATCH', 'External number was already bound');
    });
  }
  /**
   * receiveMock = 检查模拟短信和可信分配上下文，按事件/消息去重；核对号码、平台及接收时间处于有效分配窗口后保存短信和回执。
   */
  async receiveMock(route: MockInboundRoute, input: ProviderInbound, event?: { eventId: string; test: boolean }) {
    const message = messageSchema.parse(input);
    if (event?.test) return { status: 'TEST_IGNORED' as const, messageId: null };
    const fingerprint = createHash('sha256').update(JSON.stringify([
      message.externalNumberId, message.sender, message.body, Date.parse(message.receivedAt),
    ])).digest('hex');
    return this.db.transaction(async client => {
      // Lock event IDs first so conflicting concurrent callbacks cannot silently reuse one event.
      if (event) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${provider}:event:${event.eventId}`]);
      // Serialize duplicate delivery (including polling vs webhook) across different local routes.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${provider}:${message.externalMessageId}`]);
      if (event) {
        const { rows: [seen] } = await client.query<{ external_message_id: string }>(
          'SELECT external_message_id FROM provider_event_receipts WHERE provider=$1 AND event_id=$2', [provider, event.eventId]);
        if (seen && seen.external_message_id !== message.externalMessageId) throw new ApiFailure(409, 'PROVIDER_EVENT_CONFLICT', 'Event ID was reused');
      }
      const { rows: [existing] } = await client.query<{ message_id: string; fingerprint: string; allocation_id: string; number_id: string; service: string }>(
        `SELECT m.message_id,m.fingerprint,m.allocation_id,a.number_id,a.platform_id AS service FROM provider_message_receipts m
         JOIN number_allocations a ON a.id=m.allocation_id JOIN phone_numbers n ON n.id=a.number_id
         WHERE m.provider=$1 AND m.external_message_id=$2`,
        [provider, message.externalMessageId]);
      if (existing && (existing.fingerprint !== fingerprint || existing.allocation_id !== route.allocationId
        || existing.number_id !== route.numberId || existing.service !== route.service)) {
        throw new ApiFailure(409, 'PROVIDER_MESSAGE_CONFLICT', 'Message ID or route was reused with different content');
      }
      if (!existing) {
        // Lifecycle writers lock the number first, then its allocation.
        await client.query('SELECT id FROM phone_numbers WHERE id=$1 FOR UPDATE', [route.numberId]);
        const { rows: [number] } = await client.query<{
          assigned_user_id: string; service: string; phone_number: string; assigned_at: Date; expires_at: Date;
        }>(`SELECT a.user_id AS assigned_user_id,a.platform_id AS service,n.phone_number,a.assigned_at,
          LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at)) AS expires_at
          FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id
          JOIN number_allocations a ON a.number_id=n.id
          WHERE b.provider=$1 AND b.external_number_id=$2 AND n.id=$3 AND a.id=$4 FOR UPDATE OF n,a`,
        [provider, message.externalNumberId, route.numberId, route.allocationId]);
        if (!number || !route.service || number.service !== route.service
          || (message.phoneNumber !== null && normalizePhone(message.phoneNumber) !== normalizePhone(number.phone_number))) {
          throw new ApiFailure(409, 'PROVIDER_ROUTE_UNCONFIRMED', 'Number, allocation and platform must match a trusted mapping');
        }
        const received = Date.parse(message.receivedAt);
        if (allocationStatus(number.expires_at) === 'EXPIRED' || received < number.assigned_at.getTime()
          || received >= number.expires_at.getTime() || received > Date.now()) {
          throw new ApiFailure(409, 'PROVIDER_ALLOCATION_INACTIVE', 'Message is outside the active service period');
        }
        const id = randomUUID();
        // PingCode has no verificationCode field. Preserve content; do not invent a parsed code or sender platform.
        await client.query(`INSERT INTO sms_messages(id,user_id,number_id,sender,body,received_at,allocation_id)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, number.assigned_user_id, route.numberId, message.sender, message.body, message.receivedAt, route.allocationId]);
        await client.query(`INSERT INTO provider_message_receipts(provider,external_message_id,message_id,allocation_id,fingerprint,upstream_created_at)
          VALUES($1,$2,$3,$4,$5,$6)`, [provider, message.externalMessageId, id, route.allocationId, fingerprint, message.upstreamCreatedAt]);
      }
      if (event) await client.query(`INSERT INTO provider_event_receipts(provider,event_id,external_message_id)
        VALUES($1,$2,$3) ON CONFLICT(provider,event_id) DO NOTHING`, [provider, event.eventId, message.externalMessageId]);
      if (existing) return { status: 'DUPLICATE' as const, messageId: existing.message_id };
      const { rows: [saved] } = await client.query<{ message_id: string }>(
        'SELECT message_id FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2', [provider, message.externalMessageId]);
      return { status: 'IMPORTED' as const, messageId: saved!.message_id };
    });
  }
}
