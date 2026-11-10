# 上游对接前源码自查清单（linepool-ui + D:\once）

> 用途：对接上游 API 前，自己逐项确认哪些是真实逻辑、哪些是写死的 mock / 演示值。
> 编写日期：2026-11-02。下文"现状"列是编写时读代码得到的结论，**请以你自己核对的结果为准**，核对后在方框里打勾并在"备注"写下你的结论。
> 约定：✅ 真实逻辑　⚠️ 写死 / mock　❓ 未确认

---

## 0. 准备

- [ ] D:\once 不是 git 仓库，动手前先备份或 `git init` 并提交一次，方便之后 diff
- [ ] linepool-ui 当前有未提交改动（`App.tsx`、`router.ts`、`home/` 等），核对前先 `git status` 确认基线
- [ ] 准备一份上游（PingCode / PC）的真实接口文档，后面每个接口都要和它对照

---

## 1. linepool-ui 架构速览

| 层 | 位置 | 说明 |
|---|---|---|
| 接口契约 | [packages/contracts/src/](../packages/contracts/src/) | zod schema，前后端共用，**接口的唯一定义来源** |
| 后端入口 | [backend/src/main.ts](../backend/src/main.ts) | NestJS，所有 controller / provider 在此注册 |
| 后端配置 | [backend/src/environment.ts](../backend/src/environment.ts) | 全部环境变量及校验 |
| 数据库 | [backend/db/migrations/](../backend/db/migrations/) | 原生 SQL 迁移，无 ORM |
| 前端请求 | [src/linepool/api/client.ts](../src/linepool/api/client.ts) | 唯一 fetch 封装，响应用 contracts 校验 |
| 前端页面 | `src/linepool/{workspace-reference,agent,admin,wallet,welcome,home}` | 业务页面 |
| 上游 UI | `src/vendor/**`、`public/**` | 只读，**不用审** |

- [ ] 我理解了请求链路：页面 → `api/client.ts` → `/api/*` → controller → service → provider（上游）/ 数据库

---

## 2. linepool 后端：上游接入总开关

| # | 检查项 | 文件 | 现状 | 备注 |
|---|---|---|---|---|
| 2.1 | DI 注入的是 mock 还是真实 provider | [main.ts:38-39](../backend/src/main.ts) | ⚠️ `MockReceivingProvider`、`MockNumberServiceProvider` | |
| 2.2 | 后台"系统接入状态"显示的 transport | [upstream-integration.ts](../backend/src/upstream-integration.ts) | ⚠️ 写死 `providerTransport: 'mock'` | |
| 2.3 | 环境变量里是否有上游 BaseURL / API Key | [environment.ts](../backend/src/environment.ts) | ⚠️ 只有 `PINGCODE_WEBHOOK_SECRET`，**没有** BaseURL、Key | |
| 2.4 | 全仓搜索是否存在真实 HTTP transport | `grep -rn "implements PingCodeTransport" backend/src` | ⚠️ 只有 Mock 一个实现 | |

- [ ] 2.1　- [ ] 2.2　- [ ] 2.3　- [ ] 2.4

---

## 3. linepool 后端：上游抽象层（对接时要实现的）

| # | 接口 / 类 | 文件 | 现状 | 备注 |
|---|---|---|---|---|
| 3.1 | `NumberServiceProvider.renewalOptions` | [number-service-provider.ts](../backend/src/number-service-provider.ts) | ⚠️ 写死 `[7, 30]` 天，`totalPoints: null` | |
| 3.2 | `NumberServiceProvider.requestRenewal` | 同上 | ⚠️ 永远返回 `PENDING`，不扣费不改到期 | |
| 3.3 | `NumberServiceProvider.usage` | 同上 | ⚠️ 假数字：短信 100/36、语音 60/12、流量 1024/256 | |
| 3.4 | `ReceivingProvider.reserve / allocate` | [providers/mock-receiving-provider.ts](../backend/src/providers/mock-receiving-provider.ts) | ⚠️ 只查本地表，条件 `provider='pingcode-mock'` | |
| 3.5 | `PingCodeAdapter`（只读适配器） | [providers/pingcode-adapter.ts](../backend/src/providers/pingcode-adapter.ts) | ❓ schema 按文档写，**需对照上游文档核对字段、路径 `/pingcode/api/open/v1`、状态枚举** | |
| 3.6 | `MockPingCodeTransport` | [providers/mock-pingcode-transport.ts](../backend/src/providers/mock-pingcode-transport.ts) | ⚠️ fixture，游标 `mock-N` 是自造格式 | |
| 3.7 | 号码 / 短信同步 | [provider-sync.ts](../backend/src/provider-sync.ts)、[providers/receiving-sync.ts](../backend/src/providers/receiving-sync.ts) | ❓ 看 `bindMockNumber`、`receiveMock` 这类方法是否只服务 mock | |
| 3.8 | Webhook 接收 | [providers/pingcode-webhook.ts](../backend/src/providers/pingcode-webhook.ts)、[providers/webhook-inbox.ts](../backend/src/providers/webhook-inbox.ts) | ❓ 有签名校验与防重放，看起来是真逻辑；**核对签名算法、头名、事件结构是否与上游一致** | |

- [ ] 3.1　- [ ] 3.2　- [ ] 3.3　- [ ] 3.4　- [ ] 3.5　- [ ] 3.6　- [ ] 3.7　- [ ] 3.8

---

## 4. linepool 后端：业务逻辑里的 mock 依赖

逐个打开下列文件，搜索 `mock` / `pingcode-mock` / `LOCAL_SIMULATED`，判断"换掉 provider 后这里是否还写死"。

| # | 文件 | 重点看 | 备注 |
|---|---|---|---|
| 4.1 | [ordering.ts](../backend/src/ordering.ts) | 下单是否同步调用 provider、扣积分时机 | |
| 4.2 | [workspace.ts](../backend/src/workspace.ts) | 号码 / 短信 / 目录数据来源 | |
| 4.3 | [platform-inventory.ts](../backend/src/platform-inventory.ts) | 库存计算是否只看本地表 | |
| 4.4 | [agent-inventory.ts](../backend/src/agent-inventory.ts)（1285 行，最大） | 代理库存、成本状态 | |
| 4.5 | [agent-settlement.ts](../backend/src/agent-settlement.ts) | 成本 / 利润从哪来（`LOCAL_SIMULATED`？） | |
| 4.6 | [recharge.ts](../backend/src/recharge.ts) | 充值：确认**没有**真实支付通道 | |
| 4.7 | [administration.ts](../backend/src/administration.ts)、[admin-controller.ts](../backend/src/admin-controller.ts) | 后台导入号码写死的 provider | |
| 4.8 | [number-services.ts](../backend/src/number-services.ts) | 续费 / 用量是否透传 `source` | |

```bash
grep -rnE "mock|pingcode-mock|LOCAL_SIMULATED|demo" backend/src --include=*.ts
```

- [ ] 4.1　- [ ] 4.2　- [ ] 4.3　- [ ] 4.4　- [ ] 4.5　- [ ] 4.6　- [ ] 4.7　- [ ] 4.8

---

## 5. linepool 后端：仅限本地的沙箱 / 种子数据

| # | 文件 | 检查 | 备注 |
|---|---|---|---|
| 5.1 | [sandbox.ts](../backend/src/sandbox.ts) | 只有 `LOCAL_SANDBOX=true` 且非 production 才开放；含写死验证码 `482913` | |
| 5.2 | [environment.ts:40-45](../backend/src/environment.ts) | 沙箱保护：仅 127.0.0.1、库名需以 `_sandbox/_test` 结尾 | |
| 5.3 | [mock-fulfillment.ts](../backend/src/mock-fulfillment.ts)、[scripts/mock-fulfillment.ts](../backend/scripts/mock-fulfillment.ts) | 只被 CLI / 沙箱调用，没有 HTTP 入口 | |
| 5.4 | [db/demo-seed.ts](../backend/db/demo-seed.ts)、[scripts/seed.ts](../backend/scripts/seed.ts)、[scripts/seed-agent-inventory.ts](../backend/scripts/seed-agent-inventory.ts) | 演示号码、价格、地区从这里来；**上线库不要跑** | |
| 5.5 | 迁移文件中是否塞了演示数据 | `grep -rniE "insert into" backend/db/migrations` | |

- [ ] 5.1　- [ ] 5.2　- [ ] 5.3　- [ ] 5.4　- [ ] 5.5

---

## 6. linepool 前端：写死值

```bash
grep -rnE "mock|demo|模拟|演示|示例|\[7, ?30\]" src/linepool --include=*.ts --include=*.tsx
```

| # | 文件 | 现状 | 备注 |
|---|---|---|---|
| 6.1 | [workspace-reference/sale-catalog.ts](../src/linepool/workspace-reference/sale-catalog.ts) | ⚠️ 前端再次写死只卖 `[7, 30]` 天 | |
| 6.2 | [workspace-reference/NumberServices.tsx](../src/linepool/workspace-reference/NumberServices.tsx) | 按 `source==='mock'` 显示"模拟数据"，有"模拟场景"切换 | |
| 6.3 | [workspace-reference/SandboxTools.tsx](../src/linepool/workspace-reference/SandboxTools.tsx) | 沙箱按钮，确认只在 `sandboxStatus` 为 enabled 时出现 | |
| 6.4 | [admin/AdminShell.tsx:546](../src/linepool/admin/AdminShell.tsx) | ⚠️ 批量导入写死 `provider: 'pingcode-mock'`、平台限 Telegram/WhatsApp/Google | |
| 6.5 | [agent/dashboard/types.ts](../src/linepool/agent/dashboard/types.ts)、[AgentMetricCards.tsx](../src/linepool/agent/dashboard/AgentMetricCards.tsx) | 成本状态 `LOCAL_SIMULATED` 的展示 | |
| 6.6 | [admin/IntegrationPages.tsx:83](../src/linepool/admin/IntegrationPages.tsx) | 绕过 `api/client.ts` 直接 `fetch`，看调用的是什么 | |
| 6.7 | [home/HomePage.tsx](../src/linepool/home/HomePage.tsx)、[welcome/reference/messages.ts](../src/linepool/welcome/reference/messages.ts) | 营销展示的示例短信，**可接受**，确认没被当成真实数据 | |
| 6.8 | [workspace-reference/reference-data.ts](../src/linepool/workspace-reference/reference-data.ts)、[workspace-data.ts](../src/linepool/workspace-reference/workspace-data.ts) | 趋势图是从真实接口数据推算，还是有兜底假数据（看 `isDemo`） | |
| 6.9 | 不经过 API 的页面 | `AgentsPage`、`SettingsPage`、`WelcomePage`、`PageContainer`：确认是纯展示还是漏接了接口 | |

- [ ] 6.1　- [ ] 6.2　- [ ] 6.3　- [ ] 6.4　- [ ] 6.5　- [ ] 6.6　- [ ] 6.7　- [ ] 6.8　- [ ] 6.9

---

## 7. D:\once

### 7.1 架构速览

| 层 | 位置 |
|---|---|
| 前端 | [D:\once\src](file:///D:/once/src)（React Router + Zustand + TanStack Query） |
| 前端请求 | [src/lib/api.ts](file:///D:/once/src/lib/api.ts)、[src/lib/queries.ts](file:///D:/once/src/lib/queries.ts) |
| 后端 | [D:\once\backend\src](file:///D:/once/backend/src)（NestJS + Prisma） |
| 表结构 | [backend/prisma/schema.prisma](file:///D:/once/backend/prisma/schema.prisma) |
| 配置 | [backend/src/config.ts](file:///D:/once/backend/src/config.ts)：`DEMO_MODE`、`PINGCODE_*` |
| 已有 mock 说明 | [ONCE-MOCK-DATA.md（备份）](file:///D:/backups/2026-11-02/once/docs/ONCE-MOCK-DATA.md) |

### 7.2 检查项

| # | 文件 | 现状 | 备注 |
|---|---|---|---|
| 7.2.1 | [backend/src/business.ts:5](file:///D:/once/backend/src/business.ts) | ⚠️ 价格写死 `plans = {7: 1200, 30: 3500}`（分） | |
| 7.2.2 | [backend/src/leases.service.ts](file:///D:/once/backend/src/leases.service.ts) | ⚠️ 订单直接写 `DEMO_CONFIRMED`，展示文案"演示已确认" | |
| 7.2.3 | [backend/src/fulfillment.service.ts](file:///D:/once/backend/src/fulfillment.service.ts) | ⚠️ 履约只认 `provider:'demo'`，`mock:${id}` 作为上游订单号 | |
| 7.2.4 | [backend/src/demo-chat.service.ts](file:///D:/once/backend/src/demo-chat.service.ts) | ⚠️ 演示短信发送 | |
| 7.2.5 | [backend/src/events.service.ts](file:///D:/once/backend/src/events.service.ts) | 审计动作全是 `MOCK_EVENT_*`，确认是否只处理演示事件 | |
| 7.2.6 | [backend/src/pingcode.client.ts](file:///D:/once/backend/src/pingcode.client.ts) | ✅❓ **已有真实 HTTP 客户端**，配置齐全才启用；可作为 linepool transport 的参考 | |
| 7.2.7 | [backend/src/outbound.service.ts](file:///D:/once/backend/src/outbound.service.ts)、[send-webhook.controller.ts](file:///D:/once/backend/src/send-webhook.controller.ts)、[webhook-auth.ts](file:///D:/once/backend/src/webhook-auth.ts) | 真实发送与回执，核对签名规则 | |
| 7.2.8 | [backend/prisma/demo-inventory.json](file:///D:/once/backend/prisma/demo-inventory.json) | ⚠️ 演示库存，确认不会导入生产库 | |
| 7.2.9 | [src/admin/api.ts:11](file:///D:/once/src/admin/api.ts)、[src/admin/mock.ts](file:///D:/once/src/admin/mock.ts) | `VITE_ADMIN_MOCK=true` 时走假数据；确认生产构建不带 `.env.admin-mock` | |
| 7.2.10 | [src/app/WorkspaceProvider.tsx](file:///D:/once/src/app/WorkspaceProvider.tsx) | 调用 `/demo/events`、`/demo/orders/*`、`demo-message`，看触发条件 `data.demo` | |
| 7.2.11 | `assets/ux/demo.html`、`assets/ux/mock-data.js` | 独立浏览器演示，不走 `/api` | |
| 7.2.12 | 旧文件 `app.js`、`workspace.js`、`events.js` | README 说已不执行，确认没被 `index.html` 引用 | |

```bash
grep -rnE "demo|mock|DEMO_|MOCK_|plans\[" /d/once/backend/src /d/once/src --include=*.ts --include=*.tsx
```

- [ ] 7.2.1　- [ ] 7.2.2　- [ ] 7.2.3　- [ ] 7.2.4　- [ ] 7.2.5　- [ ] 7.2.6
- [ ] 7.2.7　- [ ] 7.2.8　- [ ] 7.2.9　- [ ] 7.2.10　- [ ] 7.2.11　- [ ] 7.2.12

---

## 8. 文档可信度交叉核对

这些文档也是 AI 写的，**只当线索**，逐条拿代码验证"已完成"的说法：

- [ ] [pc-lp-integration-spec.md](pc-lp-integration-spec.md)：接口规格 vs `pingcode-adapter.ts`
- [ ] [pc-lp-api-checklist.md](pc-lp-api-checklist.md)：清单里勾了"完成"的项是否真有实现
- [ ] [pc-lp-integration-confirmation.md（备份）](file:///D:/backups/2026-11-02/linepool-ui/docs/pc-lp-integration-confirmation.md)：与上游确认过的事项
- [ ] [project-feature-status-2026-10-28.md（备份）](file:///D:/backups/2026-11-02/linepool-ui/docs/project-feature-status-2026-10-28.md)：功能状态 vs 第 2–6 节结论
- [ ] [api-webhook-integration-guide.md](api-webhook-integration-guide.md)：webhook 规则 vs `pingcode-webhook.ts`
- [ ] D:\once [backend/PC-INTEGRATION.md](file:///D:/once/backend/PC-INTEGRATION.md)、[backend/API.md](file:///D:/once/backend/API.md)

---

## 9. 核对完成后的对接切入点（参考）

1. linepool：新增真实 `PingCodeTransport`（参考 once 的 `pingcode.client.ts`），在 `environment.ts` 加 BaseURL / Key
2. 实现真实 `ReceivingProvider`、`NumberServiceProvider`
3. `main.ts` 按配置切换注入；`upstream-integration.ts` 改为按配置返回 transport
4. 去掉前后端写死的 7/30 天与价格（`sale-catalog.ts`、`number-service-provider.ts`、once `business.ts`），改为上游 / 配置下发
5. 后台导入号码的 `pingcode-mock` 改为真实 provider 标识
6. 接生产供应商和支付前，按 AGENTS.md 需明确授权

---

## 核对记录

| 日期 | 章节 | 结论 / 发现 |
|---|---|---|
| | | |
