/**
 * primitives.ts 中文分区导读副本：公共字段与分页规则
 * 原文件：packages/contracts/src/primitives.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。多数规则使用 Zod 描述输入或返回格式，类型声明供编辑器检查。
 * 【整体用途】定义多种接口共用的密码、编号、地区、平台、套餐代号和分页规则。
 * 【为什么这样组织】集中维护基础规则，让不同接口接收相同格式；本文件不导入 index，避免循环依赖。
 * 【调用链】后台/前台契约 → 复用本文件 → 前后端同时检查。
 * 【修改提示】每页默认条数改 pageSize.default(20)，但页面显式传入的条数优先。开放国家还需同步目录、下单及库存，不能只改地区枚举。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { z } from 'zod';

// Leaf module with shared primitives. Must not import from './index.js'
// to avoid circular-import TDZ errors in the compiled output.
/**
 * passwordSchema = 密码检查规则。长度 8～72 个字符，同时限制 UTF-8 编码不超过 72 字节；中文字符可能占多个字节。
 */
export const passwordSchema = z.string().min(8).max(72).refine(value => new TextEncoder().encode(value).length <= 72, 'Password must not exceed 72 UTF-8 bytes');
/**
 * uuidSchema = UUID 编号规则。只检查格式，不负责判断记录是否存在或归谁所有。
 */
export const uuidSchema = z.string().uuid();
/**
 * timestampSchema = 带时区的时间文字规则。用于接口交换时间。
 */
export const timestampSchema = z.string().datetime({ offset: true });
/**
 * regionIdSchema = 系统认识的地区代号规则；认识一个地区不等于前台已经开放销售。
 */
export const regionIdSchema = z.enum(['us', 'gb', 'ca', 'sg', 'de', 'nl']);
/** Countries currently open for storefront purchases. Agent inventory is independent. */
/**
 * storefrontRegionIds = 当前允许前台购买的国家列表，目前只有 us。代理库存的地区范围单独处理。
 */
export const storefrontRegionIds = ['us'] as const;
/**
 * isStorefrontRegion = 判断某地区是否在前台开放列表中，供购买和续期等业务检查。
 */
export function isStorefrontRegion(region: string): boolean {
  return storefrontRegionIds.some(id => id === region);
}
/**
 * serviceSchema = 可用服务平台代号规则，目前是 Telegram、WhatsApp、Google。
 */
export const serviceSchema = z.enum(['Telegram', 'WhatsApp', 'Google']);
/**
 * planIdSchema = 套餐代号格式规则，例如 week、month、p14d；它检查命名格式，不决定套餐天数。
 */
export const planIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
/**
 * fulfillmentStatusSchema = 订单履行状态规则：处理中、完成、失败或取消。
 */
export const fulfillmentStatusSchema = z.enum(['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']);
/**
 * paginationQuerySchema = 分页查询规则。默认第 1 页、每页 20 条，每页最多 100 条；coerce 将地址参数中的数字文字转成数字。
 * 字段速读：page 页码；pageSize 每页条数。
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
