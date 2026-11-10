/**
 * allocation-expiry.ts 中文分区导读副本：直接分配到期回收任务
 * 原文件：backend/src/allocation-expiry.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】定期释放已到期的号码分配，并清理相关平台服务占用。
 * 【为什么这样组织】到期状态需要落实到存储占用，后续库存查询才可正确复用。
 * 【调用链】应用启动定时任务 → runBatch → releaseExpired；退出时停计时器。
 * 【修改提示】调整频率或每批数量看计时器和 runBatch 默认值；这不改变原订单约定的到期时间。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { releaseExpired } from '../../../../backend/src/platform-inventory.js';
import { Database } from '../../../../backend/src/database.js';
import { safeErrorDetails } from '../../../../backend/src/error-summary.js';

/** Local service expiry only: never calls a supplier and never enables resale. */
/**
 * ==================== 01 直接分配到期回收任务 / AllocationExpiry ====================
 * AllocationExpiry = 直接分配到期回收任务。定期释放已到期的号码分配，并清理相关平台服务占用。
 */
@Injectable()
export class AllocationExpiry implements OnApplicationBootstrap, OnModuleDestroy {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;
  /**
   * runBatch = 释放一批到期分配。默认 100 条、允许 1～500，事务中调用 releaseExpired 并返回处理数量。
   */
  async runBatch(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Expiry batch limit must be 1..500');
    return this.db.transaction(async client => {
      const result = await releaseExpired(client, undefined, limit);
      return { released: result.rowCount };
    });
  }
  /**
   * onApplicationBootstrap = 应用启动后的生命周期方法。启动本文件的定时扫描，并按代码安排第一次执行。
   */
  onApplicationBootstrap() {
    const tick = () => {
      if (this.running) return;
      this.running = this.runBatch().catch(error => console.error('Local allocation expiry failed; next scan will retry', safeErrorDetails(error)))
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
