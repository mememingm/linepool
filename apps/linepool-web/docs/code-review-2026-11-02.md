# 代码审阅报告：AI 代码常见问题（linepool-ui + D:\once）

> 审阅日期：2026-11-02（第 2 版，按"上游 API 尚未对接"的前提重新分类）。只读了代码，没有改代码，也没有运行测试。
> 原报告的编号（L1–L10、O1–O5）保留在括号里，方便和第 1 版对照。
> 严重程度：🔴 会误导业务或数据　🟠 会让排错困难　🟡 可读性 / 维护问题　⚪ 现阶段可接受

---

## 先说结论

上游还没接，**价格、天数、货币、平台、地区、演示标记这类值先写死是合理的**，不算问题。这一版把所有发现分成三类：

| 类别 | 含义 | 条数 |
|---|---|---|
| **A. 跟上游无关，现在就该改** | 不管接不接上游都是错的：吞异常、字段取错来源、对外报错误状态 | 9 |
| **B. 可以先写死的占位值** | 等上游接口或配置来替换；现在只要求它"集中、可识别、不说假话" | 8 |
| **C. 预留但没接线的代码** | 为对接准备的骨架，目前不会执行，要你决定留还是删 | 1 |

### 占位值合格的三条标准（用于判断 B 类）

1. **集中**：一个值只在一个地方定义，其他地方引用它，不要在多个文件里各写一遍。
2. **可识别**：用统一标记，比如注释里写 `UPSTREAM-PLACEHOLDER`，对接时 `grep` 一次就能找全。
3. **不说假话**：占位就明说是占位。例如返回 `source: 'mock'`、`isDemo: true` 是诚实的；返回"已同步""已确认"就是假话，归 A 类。

---

## A. 跟上游无关，现在就该改

### A1 🔴 订单数量从幂等日志里取，取不到就当 1（原 L4）

- 位置：[agent-inventory.ts:1266](../backend/src/agent-inventory.ts)
  ```ts
  quantity: (row.idempotency_payload as { result?: { count?: number } } | null)?.result?.count ?? 1,
  ```
- 已核实：[015_agent_inventory.sql:100](../backend/db/migrations/015_agent_inventory.sql) 建的 `tx_orders` 表没有 quantity 列，后续迁移也没补。数量没有存在任何正式的列里，只能从一份存幂等请求的 JSON 里"猜"，JSON 一变就静默变成 1。
- 跟上游无关：这是本地订单数据结构的问题。

### A2 🔴 代理看板对外报"成本已同步"，但成本其实是本地值（原 L2）

- 位置：[agent-inventory.ts:358](../backend/src/agent-inventory.ts) 写死 `costStatus: 'SYNCED' as const`
- 为什么归 A 类：上游没接，成本不可能"已同步"。契约里已经准备好了诚实的取值 `LOCAL_SIMULATED` / `UNAVAILABLE`（[contracts/agent-inventory.ts:51](../packages/contracts/src/agent-inventory.ts)），前端也做好了对应的提示（[AgentMetricCards.tsx:37](../src/linepool/agent/dashboard/AgentMetricCards.tsx)）。现在写死成 `SYNCED`，等于让前端把利润当真实值展示。
- 成本来源：[028_agent_settlement.sql:44-45](../backend/db/migrations/028_agent_settlement.sql) 的 `cost_minor bigint NOT NULL DEFAULT 0`，历史持有记录的成本一律是 0，所以利润会虚高。
- 最小改法：现阶段直接改成 `'LOCAL_SIMULATED'`。接上游后再按真实同步状态返回。

### A3 🟠 金额、成本用 `?? 0` 兜底，"不知道"和"真的是 0"分不出来（原 L5）

- 位置：[agent-inventory.ts:342-367](../backend/src/agent-inventory.ts)、[agent-inventory.ts:1250](../backend/src/agent-inventory.ts)、[agent-inventory.ts:1264](../backend/src/agent-inventory.ts)、[agent-inventory.ts:969](../backend/src/agent-inventory.ts)
- 计数类（库存数、客户数）用 0 兜底可以接受；**金额、成本类不行**，因为它们直接参与利润计算。
- 注意：`cost_minor` 在数据库里本身就是 `NOT NULL DEFAULT 0`，所以代码里的 `?? 0` 是多余的，真正的问题在数据库默认值（见 A2）。

### A4 🟠 后台定时任务把错误原因丢掉了（原 L8）

- 位置：[allocation-expiry.ts:21](../backend/src/allocation-expiry.ts)、[agent-inventory-expiry.ts:39](../backend/src/agent-inventory-expiry.ts)、[webhook-inbox.ts:118](../backend/src/providers/webhook-inbox.ts)
  ```ts
  this.runBatch().catch(() => console.error('Local allocation expiry failed; next scan will retry'))
  ```
- 问题：`catch` 没有接收 error 参数，日志里只有一句固定文案，没有异常信息，也没有堆栈。
- 同类问题：
  - [provider-sync.ts:69](../backend/src/provider-sync.ts) 不记任何日志。
  - [password-recovery.ts:54](../backend/src/password-recovery.ts) 邮件发送失败时不记 SMTP 错误码。不把错误告诉用户是对的（防止被用来探测邮箱是否注册），但服务端日志里至少应该有错误码。
- 最小改法：`.catch(error => console.error('...', error instanceof Error ? error.name + ': ' + error.message : error))`。担心日志泄露凭据的话，只记 `error.name` 和错误码。

### A5 🟠 once 维护任务吞异常，而且一步失败会跳过后面所有步骤（原 O2）

- 位置：[maintenance.service.ts:45](file:///D:/once/backend/src/maintenance.service.ts)
- 问题：五个恢复步骤串在同一个 try 里，日志里没有错误原因。第一步只要一直失败，后面的短信重试、收件恢复就永远不会执行。
- 最小改法：五个步骤各自 try，每个失败都记录原因。

### A6 🟠 once 短信状态刷新失败时，静默返回旧状态（原 O3）

- 位置：[outbound.service.ts:146](file:///D:/once/backend/src/outbound.service.ts)，`catch { return 旧记录 }`，不记日志
- 同文件 [outbound.service.ts:109](file:///D:/once/backend/src/outbound.service.ts)：凡不是 `PcError` 的异常（包括代码 bug）都被记成 `SMS_SUBMISSION_UNCERTAIN`，原始异常丢失。为了避免重复发送，这个设计本身可以保留，但应该把原始异常写进日志。
- 这段是 once 已经接上 PingCode 的真实逻辑，跟上游接没接无关。

### A7 🟡 偏好设置里的 `language` 是个假字段（原 L3）

- 位置：[workspace.ts:197](../backend/src/workspace.ts)、[workspace.ts:202](../backend/src/workspace.ts)、[authentication.ts:104](../backend/src/authentication.ts)，契约里是 `z.literal('zh-CN')`（[contracts/index.ts:62](../packages/contracts/src/index.ts)）
- 问题：跟上游无关。这个字段不能保存，也不会被读取；前端真正的语言设置存在 localStorage 里（[preferences/store.ts](../src/linepool/preferences/store.ts)）。从 🔴 降为 🟡，因为现在没有功能依赖它，但它会误导后来读代码的人。
- 二选一：从契约和后端删掉这个字段；或者真的存进数据库。

### A8 🟡 工作台组件里混着整套演示数据（原 L9）

- 位置：[showcase/Reference.tsx:24-31、75-110、246](../src/linepool/showcase/Reference.tsx)，包括用户名 `'林晓'`、`demoNumbers`、写死的趋势曲线、`?? 56`
- 这是界面展示用的假数据，跟上游无关。调用方现在拦住了，正常不会显示。但真实分支和假数据分支写在同一个文件里，将来很容易被意外触发。建议把演示数据拆到单独的文件。

### A9 🟡 可读性与耦合（原 L10、O4、O5）

- 超长行：
  - [AdminShell.tsx](../src/linepool/admin/AdminShell.tsx) 共 846 行，最长一行 1787 字符，超过 200 字符的有 164 行。
  - [Reference.tsx](../src/linepool/showcase/Reference.tsx) 最长一行 1010 字符。
  - [sandbox.ts](../backend/src/sandbox.ts) 像被压缩过，几乎没有空格和换行。
- 文件过大：[agent-inventory.ts](../backend/src/agent-inventory.ts) 有 1285 行，一个类包揽代理、客户、库存、余额、转账、订单、看板。
- 互相依赖：`agent/` import `admin/` 25 次，`admin/` 反过来 import `agent/` 6 次；`wallet` 和 `workspace-reference` 也互相 import。
- once：
  - [main.tsx:5](file:///D:/once/src/main.tsx) 直接 import `mock-data.js`，演示代码因此会打进生产包。运行时有 localhost 判断，平时不会生效，但会挂一个 `window.OnceMock` 全局对象。
  - [models.ts:202](file:///D:/once/src/lib/models.ts) 货币格式化失败时一律显示 `$`，不管实际是什么货币。
  - [config.ts](file:///D:/once/backend/src/config.ts) 读取环境变量全部用 `|| ''` 兜底，配置缺失时启动也没有任何提示。
  - [outbound.service.ts:87](file:///D:/once/backend/src/outbound.service.ts) 的 `|| ''` 实际走不到，只是为了绕过类型检查。

---

## B. 可以先写死的占位值（对接上游时替换）

> 这些值现在写死**没问题**。下表给出现状、是否满足上面三条标准，以及对接时它应该从哪里来。

| 编号 | 占位值 | 位置 | 集中？ | 诚实？ | 对接时的来源 |
|---|---|---|---|---|---|
| B1（原 L1） | `isDemo: true` | [workspace.ts:44、54、109](../backend/src/workspace.ts)；前端 [workspace-data.ts:7](../src/linepool/workspace-reference/workspace-data.ts) | ❌ 4 处 | ✅ 现在确实都是演示数据 | 改成由 provider 的 `source`（`mock` / `live`）推算，不再写死 |
| B2（原 L6） | 货币 `'USD'` | [agent-inventory.ts:358、969](../backend/src/agent-inventory.ts)、[agent-settlement.ts:58](../backend/src/agent-settlement.ts)、前端 [AgentSettlementTable.tsx:12](../src/linepool/agent/dashboard/AgentSettlementTable.tsx) | ❌ 4 处以上 | ✅ | 结算配置，或上游价格的币种 |
| B3（原 L6） | 天数只能是 7 / 30 | [administration.ts:246](../backend/src/administration.ts)、[number-service-provider.ts:25](../backend/src/number-service-provider.ts)、[sale-catalog.ts](../src/linepool/workspace-reference/sale-catalog.ts)，还有页面文案里的"30 天价格" | ❌ 前后端多处 | ✅ | 上游商品 / 套餐接口 |
| B4（原 L6） | 平台枚举 Telegram / WhatsApp / Google | [primitives.ts](../packages/contracts/src/primitives.ts) 的 `serviceSchema` | ⚠️ 契约里集中定义，但和 [platform-catalog.ts](../packages/contracts/src/platform-catalog.ts) 里的 50 个平台对不上 | ⚠️ | 上游项目 / 平台列表。现在至少注释说明一下：哪个是"可售"，哪个是"展示目录" |
| B5（原 L6） | 地区枚举 6 个，只开放 `us` | [primitives.ts](../packages/contracts/src/primitives.ts)；[provider-sync.ts:10](../backend/src/provider-sync.ts) 又复制了一份 | ❌ 2 处 | ✅ | 上游国家列表；`provider-sync.ts` 应改为引用 `regionIdSchema` |
| B6（原 L6） | 后台导入号码写死 `provider: 'pingcode-mock'` | [AdminShell.tsx:546](../src/linepool/admin/AdminShell.tsx)，后端 [mock-receiving-provider.ts](../backend/src/providers/mock-receiving-provider.ts) 也按这个值过滤 | ❌ 前后端各一处 | ✅ 名字里带 mock | 改成后端按当前 provider 决定，前端不该传这个值 |
| B7 | 续费方案、用量的模拟数据 | [number-service-provider.ts](../backend/src/number-service-provider.ts) 整个 `MockNumberServiceProvider` | ✅ 集中在一个类 | ✅ 返回 `source: 'mock'` | **这是合格占位的范例**：对接时只需新写一个类，替换 [main.ts:39](../backend/src/main.ts) 的注入 |
| B8（原 O1） | once 价格 `{7: 1200, 30: 3500}`，订单状态 `DEMO_CONFIRMED`，履约 `provider: 'demo'` | 价格在 [business.ts:5](file:///D:/once/backend/src/business.ts)；状态在 [leases.service.ts:26、80](file:///D:/once/backend/src/leases.service.ts)；履约在 [fulfillment.service.ts:35](file:///D:/once/backend/src/fulfillment.service.ts) | ✅ 价格集中在一处 | ✅ 状态名里就带 DEMO | 价格改为来自上游或配置；接入真实支付和履约后再新增真实状态 |

### B 类建议（不急，对接前做完即可）

1. 给上表每一处加上 `// UPSTREAM-PLACEHOLDER` 注释。对接时 `grep -rn "UPSTREAM-PLACEHOLDER"` 一次就能找全。
2. 把 B1–B6 分散的定义收拢到一个文件，比如 `packages/contracts/src/placeholders.ts`，前后端都从这里引用。这样对接时只改一个文件。
3. B7 的写法（抽象类 + mock 实现 + 一处注入）是最好的占位方式，其他占位值可以照这个模式来做。

---

## C. 预留但没接线的代码

### C1 ⚪ `provider-sync.ts` 是同步骨架，目前不会执行（原 L7）

- 位置：[provider-sync.ts](../backend/src/provider-sync.ts)，共 186 行
- 现状：后端没有任何地方 import 它，`main.ts` 也没有注册它。默认使用的适配器 `UnconfiguredInventoryAdapter` 的 `supports()` 永远返回 false。
- 结论：这是给上游库存同步预留的骨架，上游没接，不执行是正常的。**不算 bug**，但要清楚它现在完全不生效，别以为同步功能已经有了。
- 你需要决定：对接时启用它（注册到 `main.ts`，再写一个真实的 adapter），还是删掉，到时候重写。

---

## 对接上游时的替换顺序（参考）

1. 实现真实的 `NumberServiceProvider`、`ReceivingProvider` 和 PingCode transport，在 [main.ts:38-39](../backend/src/main.ts) 替换注入。
2. 让 `isDemo` 由 provider 的 `source` 推算（B1），并把 A2 的 `costStatus` 改为按真实同步状态返回。
3. 按上面 B 表逐项替换占位值，并删掉对应的 `UPSTREAM-PLACEHOLDER` 注释。
4. 决定 provider-sync（C1）是启用还是删除。

---

## 做得好的地方（不需要改）

- [api/client.ts](../src/linepool/api/client.ts)：每个响应都按契约做 zod 校验，失败直接报错，没有静默兜底。
- [number-service-provider.ts](../backend/src/number-service-provider.ts)：mock 实现集中、标明了来源、只在一处注入，这是合格占位的范例。
- [database.ts](../backend/src/database.ts)、[authentication.ts:106](../backend/src/authentication.ts)：只处理认识的错误，其余继续往外抛。
- once [pingcode.client.ts](file:///D:/once/backend/src/pingcode.client.ts)：真实的 HTTP 客户端，区分"确定失败"和"结果不确定"，可以作为 linepool 对接时的参考。
- once [incoming.service.ts:40、97](file:///D:/once/backend/src/incoming.service.ts)：先把失败写入数据库再往外抛；批量处理时一条失败不影响其他条。

## 关于"假测试"

两个项目的测试已经在清理中删除（备份在 `D:\backups\2026-11-02\`）。删除前 linepool 的 PingCode 测试数据"全部来自内存 fixture"，测试通过只能证明代码和它自己造的假数据对得上。上游接通后，如果要补测试，至少用一份上游真实返回的响应样本。

---

## 复核记录

| 编号 | 类别 | 你的结论 | 备注 |
|---|---|---|---|
| A1 | 现在改 | | |
| A2 | 现在改 | | |
| A3 | 现在改 | | |
| A4 | 现在改 | | |
| A5 | 现在改 | | |
| A6 | 现在改 | | |
| A7 | 现在改 | | |
| A8 | 现在改 | | |
| A9 | 现在改 | | |
| B1 | 占位 | | |
| B2 | 占位 | | |
| B3 | 占位 | | |
| B4 | 占位 | | |
| B5 | 占位 | | |
| B6 | 占位 | | |
| B7 | 占位（范例） | | |
| B8 | 占位 | | |
| C1 | 预留 | | |
