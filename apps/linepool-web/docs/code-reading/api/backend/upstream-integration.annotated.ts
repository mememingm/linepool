/**
 * upstream-integration.ts 中文分区导读副本：后台上游接入状态
 * 原文件：backend/src/upstream-integration.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】汇总回调配置和回执状态，返回后台接入状态展示。
 * 【为什么这样组织】把“已配置某些参数”与“真实供应商传输已接通”分别表达，避免后台状态误导。
 * 【调用链】AdminController.integrationStatus → UpstreamIntegration.status → 环境与回执统计。
 * 【修改提示】providerTransport 当前固定 mock；配置回调密钥不会自动切换为真实供应商传输。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable } from '@nestjs/common';
import { adminUpstreamStatusSchema } from '@linepool/contracts/admin';
import { Database } from '../../../../backend/src/database.js';
import { Environment } from '../../../../backend/src/environment.js';

/**
 * ==================== 01 后台上游接入状态 / UpstreamIntegration ====================
 * UpstreamIntegration = 后台上游接入状态。汇总回调配置和回执状态，返回后台接入状态展示。
 */
@Injectable()
export class UpstreamIntegration {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, private readonly environment: Environment) {}

  /**
   * status = 汇总真实来源回执/事件统计与回调配置，返回 providerTransport:mock；secretConfigured 只表示配置存在。
   */
  async status() {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [receipts] } = await client.query(`SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE processing_status='IMPORTED'))::int AS imported,
        (count(*) FILTER (WHERE processing_status='PENDING'))::int AS pending,
        (count(*) FILTER (WHERE processing_status='UNMATCHED'))::int AS unmatched,
        max(received_at)::text AS "lastReceivedAt",max(processed_at)::text AS "lastProcessedAt"
        FROM provider_message_receipts WHERE provider='pingcode'`);
      const { rows: [deliveries] } = await client.query(`SELECT count(*)::int AS "eventCount",
        COALESCE(sum(delivery_count),0)::int AS "deliveryCount",
        COALESCE(sum(delivery_count-1),0)::int AS "redeliveryCount"
        FROM provider_event_receipts WHERE provider='pingcode'`);
      return adminUpstreamStatusSchema.parse({
        environment: this.environment.values.NODE_ENV,
        // The current application wires MockNumberProvider; inbound configuration does not enable live procurement.
        providerTransport: 'mock',
        webhook: {
          path: '/api/webhooks/pingcode',
          secretConfigured: Boolean(this.environment.values.PINGCODE_WEBHOOK_SECRET),
          replayWindowSeconds: 300, retryIntervalSeconds: 30,
        },
        receipts: { ...receipts, ...deliveries },
      });
    });
  }
}
