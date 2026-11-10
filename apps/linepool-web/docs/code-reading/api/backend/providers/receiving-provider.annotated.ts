/**
 * receiving-provider.ts 中文分区导读副本：号码接收与分配能力接口
 * 原文件：backend/src/providers/receiving-provider.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】约定购买时预留哪些号码、确认后怎样分配给用户，并计算分配是否到期。
 * 【为什么这样组织】把下单流程与具体供应商实现分开，保证业务层使用统一能力。
 * 【调用链】Ordering → ReceivingProvider.reserve / allocate；main.ts 当前使用 MockReceivingProvider。
 * 【修改提示】替换真实实现需在服务端接入并核对供应商协议；改抽象定义要同步所有实现。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import type { PoolClient } from 'pg';
import type { CreateOrderInput } from '@linepool/contracts';
import type { PingCodeAdapter } from '../../../../../backend/src/providers/pingcode-adapter.js';

/** LINEPOOL operations, not a claimed PingCode HTTP contract. All writes stay in the caller's transaction. */
/**
 * ==================== 01 号码接收与分配能力接口 / ReceivingProvider ====================
 * ReceivingProvider = 号码接收能力的抽象约定。定义 source、reader、预留 reserve 与分配 allocate；当前来源只声明 mock。
 */
export abstract class ReceivingProvider {
  abstract readonly source: 'mock';
  abstract readonly reader: PingCodeAdapter;
  /**
   * reserve = 预留号码能力：在调用方事务中根据商品/数量选择资源，返回号码编号列表。
   */
  abstract reserve(client: PoolClient, input: CreateOrderInput, offer: { capability: string; area_prefix: string; duration_days: number }): Promise<string[]>;
  /**
   * allocate = 号码分配能力：在调用方事务中为订单建立用户服务分配。
   */
  abstract allocate(client: PoolClient, allocation: { userId: string; orderId: string; durationDays: number; numberIds: string[] }): Promise<void>;
}

/**
 * allocationStatus = 根据到期时间返回 ACTIVE 或 EXPIRED。等于当前时间也视为过期。
 */
export function allocationStatus(expiresAt: Date, now = Date.now()): 'ACTIVE' | 'EXPIRED' {
  return expiresAt.getTime() > now ? 'ACTIVE' : 'EXPIRED';
}
