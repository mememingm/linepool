/**
 * mock-receiving-provider.ts 中文分区导读副本：模拟号码预留与分配
 * 原文件：backend/src/providers/mock-receiving-provider.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】从本地模拟库存锁定可用平台号码，为用户建立分配并更新平台占用。
 * 【为什么这样组织】并发时跳过被其他请求锁定的资源；同一事务内预留和分配保持一致。
 * 【调用链】Ordering → reserve → 创建订单 → allocate → 分配记录和平台占用。
 * 【修改提示】这里依据商品实际 duration_days 检查资源期限；不要仅增加前端可选项而忽略库存期限。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateOrderInput } from '@linepool/contracts';
import { ApiFailure } from '../../../../../backend/src/http.js';
import { ReceivingProvider } from '../../../../../backend/src/providers/receiving-provider.js';
import { PingCodeAdapter } from '../../../../../backend/src/providers/pingcode-adapter.js';
import { MockPingCodeTransport } from '../../../../../backend/src/providers/mock-pingcode-transport.js';
import { availableStock, releaseExpired } from '../../../../../backend/src/platform-inventory.js';

/** Database-backed simulation. No network or supplier side effects, including on rollback. */
/**
 * ==================== 01 模拟号码预留与分配 / MockReceivingProvider ====================
 * MockReceivingProvider = 模拟号码预留与分配。从本地模拟库存锁定可用平台号码，为用户建立分配并更新平台占用。
 */
@Injectable()
export class MockReceivingProvider extends ReceivingProvider {
  readonly source = 'mock' as const;
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(readonly reader = new PingCodeAdapter(new MockPingCodeTransport())) { super(); }
  /**
   * reserve = 先释放到期分配，再按国家、平台、前缀、区号和数量锁定本地模拟库存，跳过已锁资源；不足则整体拒绝。
   */
  async reserve(client: PoolClient, input: CreateOrderInput, offer: { capability: string; area_prefix: string; duration_days: number }) {
    await releaseExpired(client, input.service);
    const { rows } = await client.query<{ id: string }>(
      `SELECT n.id FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
       WHERE n.region_id=$1 AND s.platform_id=$2 AND s.provider='pingcode-mock'
       AND ${availableStock('$7')} AND n.capability=$4 AND starts_with(n.phone_number,$5)
       AND ($6::text IS NULL OR (n.phone_number ~ '^\\+1[2-9][0-9]{9}$' AND substring(n.phone_number FROM 3 FOR 3)=$6))
       ORDER BY n.created_at,n.id LIMIT $3 FOR UPDATE OF s SKIP LOCKED`,
      [input.region, input.service, input.quantity, offer.capability, offer.area_prefix, input.areaCode ?? null, offer.duration_days],
    );
    if (rows.length !== input.quantity) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Not enough inventory is currently available');
    return rows.map(row => row.id);
  }
  /**
   * allocate = 为选中号码建立订单服务分配，到期时间按 durationDays 计算；核对插入数量，失败交由外层事务回滚。
   */
  async allocate(client: PoolClient, input: { userId: string; orderId: string; durationDays: number; numberIds: string[] }) {
    const result = await client.query(
      `INSERT INTO number_allocations(number_id,platform_id,user_id,order_id,assigned_at,expires_at)
       SELECT n.id,o.service,$1,o.id,now(),now()+($3*interval '1 day')
       FROM orders o JOIN number_platforms s ON s.platform_id=o.service
       JOIN phone_numbers n ON n.id=s.number_id
       WHERE o.id=$2 AND n.id=ANY($4::uuid[]) AND s.provider='pingcode-mock'`,
      [input.userId, input.orderId, input.durationDays, input.numberIds],
    );
    if (result.rowCount !== input.numberIds.length) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Resource allocation did not complete');
  }
}
