# LINEPOOL 本地沙盒验收（2026-10-19）

范围为 D:/llinepool/linepool-ui。保留共享接码、按服务权限分配、服务端计价及禁用续费规则。没有连接真实PingCode采购/付费服务，没有修改上游只读资产或原开发数据库。

## 首个阻塞及修复

新账户积分为0，又没有可用的受限测试积分入口，无法创建第一笔业务。现在仅在 `LOCAL_SANDBOX=true`、非生产、loopback的独立环境开放当前用户沙盒工具：固定100测试积分只发一次，真实 `point_ledger` 入账；并发重复领取仍只有一笔，不跳过下单时的余额/库存/服务校验。

`backend/src/sandbox.ts`、`backend/db/migrations/011_local_sandbox_tools.sql` 提供受账户归属限制的积分、履约、收件模拟接口；复用现有 Ordering、MockFulfillment 和 ReceivingSync。`backend/src/ordering.ts` 在本地工具模式可将真实订单保持待履约。`src/linepool/workspace-reference/SandboxTools.tsx` 在现有工作台内提供折叠工具，没有改版网站。未知收件保留原事件ID，刷新后可查/核对；待定购买继续使用原请求键。

本地失败结果回滚该笔模拟扣减并留账本，不是正式支付退款规则。当前禁用的续费没有开放。

## 当前入口与操作

入口：<http://127.0.0.1:3314/register>。API3315，经前端同源代理访问；独立PG数据在 `output/business-sandbox/pgdata`，本次端口5753。

1. 注册新邮箱账户，在 `/app/purchase` 展开“本地沙盒工具”，领取一次100测试积分；到积分页可查流水。
2. 选择平台服务、地区和期限，按正常页面确认创建订单。服务端实际扣分，订单先待履约。
3. 在工具内对自己的待定订单模拟成功、明确失败或超时未知；未知后核对原订单，成功才发放服务分配和号码权限。
4. 在自己的号码/收件箱工具中模拟收件；可重复同一事件、设置未知并在刷新后核对。收件由服务端归属、服务映射和租期校验后入库。
5. 打开收件箱阅读，已读状态也由API保存。

## 隔离启动和可重复准备

```powershell
cd D:/llinepool/linepool-ui
npm run build:all
# 当前已有环境：
node scripts/sandbox.mjs stop business-sandbox
node scripts/sandbox.mjs start business-sandbox
node scripts/sandbox.mjs inspect business-sandbox
# 全新环境（已存在的同名目录会拒绝重置）：
node scripts/sandbox.mjs prepare another-run
node scripts/sandbox.mjs start another-run
```

prepare需要PostgreSQL二进制（默认D:/postgresql/bin，可设PG_BIN），自动选独立PG端口、创建非超级用户应用角色、建库/追加迁移/seed合成目录。网页/API默认3314/3315；并行环境先设置 `LINEPOOL_SANDBOX_WEB_PORT` 和 `LINEPOOL_SANDBOX_API_PORT` 为其他空闲端口。目录seed账户用于目录库存，不会向新注册账户预置订单、消息或积分。

stop只停止该具名环境的API/preview；start会在其隔离PG已停止时重启它，保留数据。`local-run.json`含连接凭据，属于本地忽略文件，不归档。expire只用于该隔离环境指定号码UUID的到期fixture，不能指向原库。

## 本次实际验证

最终新账户浏览器完整回放18断言通过：空账户、并发发测试积分仅一次；真实订单POST提交后故意丢响应，页面显示连接失败；刷新再提交复用原键，订单和扣分均只有一次；未知履约没有号码，迟到成功交付一份服务分配，重复核对不增交付；重复收件事件只有一条，未知收件刷新后核对原事件；已读刷新恢复；另一下单明确失败后只冲正自己的15分，账本汇总等于余额85；退出重登恢复；390px收件箱可用；B无A订单，不能读A订单或标读A短信。

最终A账户：2订单（1COMPLETED、1FAILED）、1服务分配、2消息、85积分。其UUID及关联记录在browser-evidence.json，与数据库证据逐项对应。数据库全库还有早期复现账户和seed，不把全库总数冒充A账户数量。

独立API/preview重启、随后完整停PG再启动均通过恢复检查。仅将最终A账户的隔离号码fixture设到期后，页面显示“已过期”，新的模拟收件返回409 `PROVIDER_ALLOCATION_INACTIVE`，历史收件仍可阅读。

测试通过：根 npm test 的 contracts5、API18、workspace-details47、preferences13、backend28。后端包括并发库存/余额、共享服务分配、幂等与冲突、权限、ReceivingSync去重/未知/重放、沙盒积分与履约。生产网站构建通过，117个上游文件完整性验证通过。

发现两个旧测试不符现状：已禁用的/admin/renewals原测试仍期待写成功，现改为验证400且保留未认证/无权限检查；详情文案断言与现有“服务方案详情”不符，改为对齐当前文案。沙盒新增错误断言改为检查ApiFailure.response.error.code，没有修改业务错误来迁就测试。

## 证据及回归命令

`output/business-sandbox/`：

- `browser-evidence.json`、`browser-verification.log`：最终18项页面/API断言。
- `database-evidence.json`：users、orders、allocations、ledger、messages的关联。
- `restart-verification.log`、`cold-restart.log`、`expiry-verification.log`。
- `first-blocker.png`、`final-inbox-desktop.png`（1440×1000）、`final-inbox-mobile.png`、`expiry-mobile.png`。
- `integration-tests.log`：全部测试原始输出。
- `versions.json`：源码、后端/前端产物、实际静态响应及数据库路径。

```powershell
cd D:/llinepool/linepool-ui
# 创建独立linepool_sandbox_test库并运行根测试，绝不把测试指向原开发库：
node scripts/sandbox.mjs test business-sandbox
npx --yes --package @playwright/cli playwright-cli -s=linepool-test open http://127.0.0.1:3314/register
npx --yes --package @playwright/cli playwright-cli -s=linepool-test run-code --filename scripts/sandbox-browser.js
```

浏览器脚本注册自己的新账户，当前默认本地端口3314。已验证到期的旧测试账户不用于下一次购买；新账户/新具名环境无需删除旧记录。

## 保留边界

真实采购/通信、支付充值、正式退款/回收政策、生产发布、账户找回与外网治理不在本轮验收内。续费继续禁用。未宣称管理后台、全部偏好视觉、键盘无障碍、所有屏幕及其他浏览器均已专项验收。
