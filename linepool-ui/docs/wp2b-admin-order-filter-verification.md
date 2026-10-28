# WP2-b：F4 管理员订单筛选核验

日期：2026-10-28  
范围：仅核对 `docs/p0-fix-plan.md` 的 F4；未重复实现已有功能。

## 结论

F4 当前基线已完整覆盖计划要求，未发现需要修改业务代码的缺口。本包只新增本验证文档；未改 `src/linepool/admin/AdminShell.tsx`、`backend/src/administration.ts` 或 `packages/contracts/src/admin.ts`。

## 静态核对

- **真实状态只有四种**：`PROCESSING`、`COMPLETED`、`FAILED`、`CANCELLED`。前端订单状态下拉仅显示“处理中、已完成、失败、已取消”；共享契约 `fulfillmentStatusSchema` 与 `adminOrderSchema` 也只接受这四种。
- **快捷筛选独立**：订单页另有“全部 / 今天 / 需要处理”标签；“需要处理”使用概览 `exceptionOrders` 数量，避免把日期或核对语义混入状态下拉。
- **筛选可组合**：`status` 与 `view` 分开写入查询参数，后端分别添加履约状态和 `today` / `attention` 条件。
- **概览跳转正确**：概览“今日订单”跳转 `view=today`；“订单需要核对”跳转 `view=attention`。
- **旧 URL 兼容**：前端将 `status=today`、`status=EXCEPTION`、`status=UNVERIFIED` 转换为对应 `view` 并清除旧 `status`；契约预处理也保留同一兼容规则。
- **后端独立校验**：订单列表在 `Administration.list()` 内再次通过 `adminOrdersQuerySchema` 校验；非法 `status` 不会落入 SQL，非法 `view` 由契约枚举拒绝。控制器通用查询校验之外仍有订单专用校验。
- **attention 语义一致且不重复计数**：筛选与概览共用 `orderNeedsAttention`：履约失败，或不存在 `ORDER_DEBIT` 扣款流水。两处都是按 `orders` 行计数，没有 join 扩张导致重复计数。
- **中文标签一致**：管理员订单状态文案与用户端订单状态文案均为“处理中、已完成、失败、已取消”。未触碰 F1 及 `workspace-data.ts` 等其他区域。

## 验证证据

- `cd linepool-ui && npm run api:typecheck`：通过。
- `cd linepool-ui && npm run typecheck`：未通过，失败发生在既有 `verify:upstream` 完整性检查，而非 F4 类型错误；该检查报告 `src/vendor/magic/**` 与上游基线不一致。按约束未修改这些只读文件。
- 主服务只读环境探测：`GET http://127.0.0.1:3010/api/health` 返回 `{"data":{"status":"ok","database":"ok","mode":"demo"}}`；未登录访问 `GET /api/admin/orders` 返回 `401 Unauthorized`。本轮不启停服务、不迁移、不写库；管理员登录与浏览器最终验收交 WP3，避免把旧主服务结果当作本分支新代码验证。

## 待 WP3 浏览器验收

使用真实管理员登录后确认：状态下拉四项；概览入口分别选中“今天 / 需要处理”；`status=FAILED&view=today` 可组合；旧 `status=today/EXCEPTION/UNVERIFIED` 正常转换；“需要处理”列表数量与概览一致且失败、缺扣款订单各只出现一次。
