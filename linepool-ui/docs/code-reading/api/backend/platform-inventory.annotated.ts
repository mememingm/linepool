/**
 * platform-inventory.ts 中文分区导读副本：平台服务库存条件与过期释放
 * 原文件：backend/src/platform-inventory.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】拼接库存可售 SQL 条件，并释放到期的直接分配。
 * 【为什么这样组织】同一号码的不同平台服务分别占用；资源有效期必须覆盖用户购买的服务期限。
 * 【调用链】目录/下单/后台 → availableStock；定时任务 → releaseExpired。
 * 【修改提示】durationExpression 是 SQL 中的天数字段/表达式，不是用户直接输入；改可售规则要同步购买与统计。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import type { PoolClient } from 'pg';

/** Shared stock predicate. Alias n=physical number, s=number/platform inventory slot. */
/**
 * availableStock = 可售库存 SQL 条件。要求平台/项目启用、允许出售、未预留、未分配；真实来源资源期限需覆盖 duration 天，模拟来源有独立分支。
 */
export function availableStock(duration: string) {
  return `s.is_available AND s.sale_enabled AND s.reserved_order_id IS NULL
    AND n.sale_enabled AND n.resource_status IN ('LOCAL','ONLINE')
    AND EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
      WHERE p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id
      AND p.is_active AND f.is_active)
    AND (s.provider='pingcode-mock' OR (n.resource_status='ONLINE' AND n.resource_expires_at>=now()+(${duration}*interval '1 day')))
    AND NOT EXISTS(SELECT 1 FROM number_allocations a WHERE a.number_id=s.number_id
      AND a.platform_id=s.platform_id AND a.released_at IS NULL)`;
}

/**
 * releaseExpired = 批量结束到期的平台分配并记录生命周期事件。一个平台到期不会直接关闭同号码其他平台服务，也不会主动重新上架。
 */
export async function releaseExpired(client: PoolClient, platform?: string, limit = 500) {
  // Periods are half-open [assigned_at, expires_at). Closing a service never closes other platforms.
  return client.query(`WITH due AS (
    SELECT id FROM number_allocations WHERE released_at IS NULL AND expires_at<=now()
    AND ($1::text IS NULL OR platform_id=$1) ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED
  ), closed AS (
    UPDATE number_allocations a SET released_at=a.expires_at,release_reason='EXPIRED'
    FROM due WHERE a.id=due.id RETURNING a.id
  ) INSERT INTO number_lifecycle_events(allocation_id,reason)
    SELECT id,'EXPIRED' FROM closed ON CONFLICT(allocation_id) DO NOTHING`, [platform ?? null, limit]);
}
