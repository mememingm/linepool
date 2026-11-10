/**
 * webhook-inbox.ts 中文分区导读副本：已验证回调的收件箱与重试
 * 原文件：backend/src/providers/webhook-inbox.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】持久化已验证回调，按号码平台和分配时间归属短信，记录异常并定期重试待处理项。
 * 【为什么这样组织】先落回执再路由，遇到资源未到齐或无法匹配时可追踪和重试，避免丢失事件。
 * 【调用链】PingCodeWebhookController → recordVerified / route；后台手动重试也调用 route。
 * 【修改提示】修改重试批量/周期看 retryPending 与计时器；管理员手动重试仍保留 actorId/reason 审计信息。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHash } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../../../../backend/src/database.js';
import { Environment } from '../../../../../backend/src/environment.js';
import { ApiFailure } from '../../../../../backend/src/http.js';
import { safeErrorDetails } from '../../../../../backend/src/error-summary.js';

// Internal normalized input. The HTTP adapter verifies the agreed raw-body signature first.
// PC must confirm the proposed project-aware wire contract before live integration.
/**
 * inbound = 已验证短信的内部整理规则，包含项目与号码、内容及原接收时间；进入本服务之前应已完成回调验签。
 */
const inbound = z.object({
  eventId: z.string().trim().min(1).max(200),
  messageId: z.string().trim().min(1).max(200),
  projectId: z.string().trim().min(1).max(200),
  numberId: z.string().trim().min(1).max(200),
  phoneNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  sender: z.string().max(500), content: z.string().max(16000),
  occurredAt: z.string().datetime({ offset: true }),
  rawPayload: z.json().optional(),
});
/**
 * VerifiedPcInbound = inbound 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type VerifiedPcInbound = z.infer<typeof inbound>;

/**
 * ==================== 01 已验证回调的收件箱与重试 / WebhookInbox ====================
 * WebhookInbox = 已验证回调的收件箱与重试。持久化已验证回调，按号码平台和分配时间归属短信，记录异常并定期重试待处理项。
 */
@Injectable()
export class WebhookInbox implements OnApplicationBootstrap, OnModuleDestroy {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  /** A committed receipt is sufficient for the HTTP adapter to acknowledge delivery. */
  /**
   * recordVerified = 持久保存已验证回执。检查事件编号和消息内容指纹，重复投递只增加事件次数，编号复用冲突则拒绝。
   */
  async recordVerified(input: VerifiedPcInbound) {
    const item = inbound.parse(input);
    const fingerprint = createHash('sha256').update(JSON.stringify([
      item.projectId,item.numberId,item.phoneNumber,item.sender,item.content,Date.parse(item.occurredAt),
    ])).digest('hex');
    return this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`pingcode:event:${item.eventId}`]);
      const { rows: [event] } = await client.query<{ external_message_id: string }>(
        "SELECT external_message_id FROM provider_event_receipts WHERE provider='pingcode' AND event_id=$1", [item.eventId]);
      if (event && event.external_message_id !== item.messageId) throw new ApiFailure(409, 'PROVIDER_EVENT_CONFLICT', 'Event ID was reused');
      await client.query(`INSERT INTO provider_message_receipts(provider,external_message_id,fingerprint,
        external_project_id,external_number_id,raw_payload)
        VALUES('pingcode',$1,$2,$3,$4,$5) ON CONFLICT(provider,external_message_id) DO NOTHING`,
      [item.messageId,fingerprint,item.projectId,item.numberId,JSON.stringify(item)]);
      const { rows: [saved] } = await client.query<{ fingerprint: string; processing_status: string }>(
        "SELECT fingerprint,processing_status FROM provider_message_receipts WHERE provider='pingcode' AND external_message_id=$1 FOR UPDATE", [item.messageId]);
      if (saved!.fingerprint !== fingerprint) throw new ApiFailure(409, 'PROVIDER_MESSAGE_CONFLICT', 'Message ID was reused with different content or project');
      await client.query(`INSERT INTO provider_event_receipts(provider,event_id,external_message_id)
        VALUES('pingcode',$1,$2) ON CONFLICT(provider,event_id) DO UPDATE
        SET delivery_count=provider_event_receipts.delivery_count+1`, [item.eventId,item.messageId]);
      return { received: true as const, messageId: item.messageId, status: saved!.processing_status };
    });
  }

  /** Route by trusted project + number + original reception time, including delayed redelivery. */
  /**
   * route = 把回执按可信项目+号码+原接收时间匹配唯一用户分配。成功写短信并标 IMPORTED；不能唯一匹配则保留 UNMATCHED，手动重试另验管理员并审计。
   */
  async route(messageId: string, retry?: { actorId: string; reason: string }) {
    return this.db.transaction(async client => {
      if (retry) {
        const actor = await client.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' FOR SHARE", [retry.actorId]);
        if (!actor.rowCount) throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Platform administrator access is required');
      }
      const { rows: [receipt] } = await client.query<{ processing_status: string; raw_payload: unknown }>(
        "SELECT processing_status,raw_payload FROM provider_message_receipts WHERE provider='pingcode' AND external_message_id=$1 FOR UPDATE", [messageId]);
      if (!receipt) throw new ApiFailure(404, 'RECEIPT_NOT_FOUND', 'Receipt not found');
      // Keep manual routing and its audit entry in the same transaction; existing imports remain idempotent.
      const finish = async (status: 'IMPORTED' | 'UNMATCHED') => {
        if (retry) await client.query(
          'INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
          [retry.actorId,'WEBHOOK_RETRY',`pingcode:${messageId}`,retry.reason,
            JSON.stringify({ status: receipt.processing_status }),JSON.stringify({ status })]);
        return { status };
      };
      if (receipt.processing_status === 'IMPORTED') return finish('IMPORTED');
      const item = inbound.parse(receipt.raw_payload);
      const { rows } = await client.query<{ id: string; number_id: string; user_id: string; platform_id: string }>(
        `SELECT a.id,a.number_id,a.user_id,a.platform_id FROM provider_projects p
         JOIN number_platforms s ON s.provider=p.provider AND s.external_project_id=p.external_project_id AND s.platform_id=p.platform_id
         JOIN provider_resource_bindings b ON b.provider=p.provider AND b.number_id=s.number_id
         JOIN phone_numbers n ON n.id=b.number_id
         JOIN number_allocations a ON a.number_id=n.id AND a.platform_id=p.platform_id
         WHERE p.provider='pingcode' AND p.external_project_id=$1 AND b.external_number_id=$2 AND n.phone_number=$3
         AND a.assigned_at<=$4::timestamptz AND $4::timestamptz<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))
         AND $4::timestamptz<=now()
         AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))
         FOR SHARE OF a`, [item.projectId,item.numberId,item.phoneNumber,item.occurredAt]);
      if (rows.length !== 1) {
        await client.query(`UPDATE provider_message_receipts SET processing_status='UNMATCHED',
          failure_reason='No unique number/platform service at original reception time',processed_at=now()
          WHERE provider='pingcode' AND external_message_id=$1`, [messageId]);
        return finish('UNMATCHED');
      }
      const service = rows[0]!;
      const { rows: [message] } = await client.query<{ id: string }>(
        `INSERT INTO sms_messages(user_id,number_id,allocation_id,platform_id,sender,body,received_at,verification_code)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [service.user_id,service.number_id,service.id,service.platform_id,item.sender,item.content,item.occurredAt,
        item.content.match(/(?<![0-9])[0-9]{4,8}(?![0-9])/)?.[0] ?? null]);
      await client.query(`UPDATE provider_message_receipts SET message_id=$2,allocation_id=$3,
        processing_status='IMPORTED',failure_reason=NULL,processed_at=now()
        WHERE provider='pingcode' AND external_message_id=$1`, [messageId,message!.id,service.id]);
      return finish('IMPORTED');
    });
  }

  /**
   * retryPending = 读取一批 PENDING/UNMATCHED 回执逐条尝试路由，默认 100，允许 1～500；定时触发不代表每条都能匹配成功。
   */
  async retryPending(limit = 100) {
    if (!Number.isInteger(limit) || limit<1 || limit>500) throw new Error('Receipt retry limit must be 1..500');
    const { rows } = await this.db.query<{ external_message_id: string }>(
      `SELECT external_message_id FROM provider_message_receipts WHERE provider='pingcode'
       AND processing_status IN ('PENDING','UNMATCHED')
       ORDER BY processed_at NULLS FIRST,received_at,external_message_id LIMIT $1`, [limit]);
    const outcomes = [];
    for (const row of rows) outcomes.push(await this.route(row.external_message_id));
    return outcomes;
  }

  /**
   * onApplicationBootstrap = 应用启动后的生命周期方法。启动本文件的定时扫描，并按代码安排第一次执行。
   */
  onApplicationBootstrap() {
    if (!this.environment.values.PINGCODE_WEBHOOK_SECRET) return;
    const tick = () => {
      if (this.running) return;
      this.running = this.retryPending().catch(error => console.error('Webhook inbox retry failed; next scan will retry', safeErrorDetails(error)))
        .finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
    tick();
  }

  /**
   * onModuleDestroy = 应用停止时的清理方法。释放本文件创建的资源，等待尚未完成的任务按代码结束。
   */
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
