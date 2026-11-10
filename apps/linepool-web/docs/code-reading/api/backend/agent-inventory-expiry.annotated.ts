/**
 * agent-inventory-expiry.ts 中文分区导读副本：代理持有与权益到期任务
 * 原文件：backend/src/agent-inventory-expiry.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】定期结束到期的代理服务权益与持有记录，清理对应分配和库存占用。
 * 【为什么这样组织】后台释放与前台有效期判断保持配合；只改页面状态不会释放数据库占用。
 * 【调用链】应用启动计时器 → runBatch → 权益、持有、分配与库存更新。
 * 【修改提示】修改频率/批大小看 interval 与默认 limit；不能把号码资源到期和客户服务到期视为同一个时间。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Database } from '../../../../backend/src/database.js';
import { safeErrorDetails } from '../../../../backend/src/error-summary.js';

/** Expires local agent holdings only; it never calls PingCode or performs a purchase. */
/**
 * ==================== 01 代理持有与权益到期任务 / AgentInventoryExpiry ====================
 * AgentInventoryExpiry = 代理持有与权益到期任务。定期结束到期的代理服务权益与持有记录，清理对应分配和库存占用。
 */
@Injectable()
export class AgentInventoryExpiry implements OnApplicationBootstrap, OnModuleDestroy {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  /**
   * runBatch = 默认处理 100 条到期代理持有，允许 1～500。结束持有和有效权益、把对应代理库存置为可用并记自动到期事件。
   */
  async runBatch(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Agent holding expiry batch limit must be 1..500');
    return this.db.transaction(async client => {
      const { rows } = await client.query<{ holding_id: string; stock_id: string }>(
        `SELECT h.id AS holding_id,s.id AS stock_id
         FROM number_holdings h
         JOIN agent_number_stock s ON s.holding_id=h.id
         WHERE h.status='ACTIVE' AND h.expires_at IS NOT NULL AND h.expires_at <= now()
         ORDER BY h.expires_at,h.id
         FOR UPDATE OF h,s SKIP LOCKED
         LIMIT $1`, [limit]);
      for (const row of rows) {
        await client.query("UPDATE service_entitlements SET status='EXPIRED' WHERE holding_id=$1 AND status='ACTIVE'", [row.holding_id]);
        await client.query("UPDATE number_holdings SET status='RETIRED',transferred_at=COALESCE(transferred_at,now()) WHERE id=$1", [row.holding_id]);
        await client.query("UPDATE agent_number_stock SET status='AVAILABLE',holding_id=NULL WHERE id=$1", [row.stock_id]);
        await client.query(
          `INSERT INTO agent_number_stock_events(stock_id,holding_id,action,reason,actor_user_id,metadata)
           VALUES($1,$2,'EXPIRE',$3,(SELECT id FROM users WHERE role='ADMIN' ORDER BY created_at,id LIMIT 1),$4)`,
          [row.stock_id, row.holding_id, 'Agent holding expired', JSON.stringify({ automatic: true })],
        );
      }
      return { released: rows.length };
    });
  }

  /**
   * onApplicationBootstrap = 应用启动后的生命周期方法。启动本文件的定时扫描，并按代码安排第一次执行。
   */
  onApplicationBootstrap() {
    const tick = () => {
      if (this.running) return;
      this.running = this.runBatch().catch(error => console.error('Agent holding expiry failed; next scan will retry', safeErrorDetails(error)))
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
