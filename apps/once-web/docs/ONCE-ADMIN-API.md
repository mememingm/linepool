# ONCE 管理后台 API 契约

前后端管理接口已实现，类型定义见 [src/admin/types.ts](../src/admin/types.ts)，上游接入类型见 [src/admin/integrations.ts](../src/admin/integrations.ts)。开发演示实现位于 [src/admin/mock.ts](../src/admin/mock.ts)，实际行为以后端为准。

本地无后端时：`npm run dev:admin-mock`，打开 `http://127.0.0.1:5174/#/admin`。

## v4.2 当前实现：平台自营连接未配置（2026-11-07）

当前本站管理前缀为 `/api/once/admin`，共享 PC 连接接口为 `/api/admin/pc`；以下新增行为以当前 core 实现为准，后文保留旧后端接口历史。

- `GET /summary` 不要求已配置当前接入模式的平台自营连接。返回 `200`，用户、订单、租约及相关统计沿用本站允许读取的自营/历史账号范围，排除代理连接；号码可售状态仍按所选 provider 和原库存条件判断。`integrations.pingcodeConfigured=false` 明确表示平台自营连接缺失，页面将其列为待处理事项。
- `GET /integrations/pingcode` 在可信平台自营连接不存在时仍返回 `200`：`configured=false`、`accountId=null`、`enabled=false`、`authorized=false`、`mappedNumbers=0`，最近任务和检查均为 `null`。此状态表示当前所选平台来源尚未配置，不将其他来源或个人账号的号码计入当前平台连接。
- `IntegrationConfig.accountId` 为 `string | null`。前端在 `configured=false` 时显示未配置说明，不加载当前平台号码列表或提供平台授权、同步表单。原用户和历史列表继续可读。
- 需要操作选定平台连接的接口仍使用严格的 `account()` 校验；缺失时保留 `ONCE_ACCOUNT_UNAVAILABLE`。自营授权仍要求单独预配置的 `SELF_SERVICE` 连接，管理员个人 `AGENT` 连接保留原所有权。

## 通用约定

- 前缀 `/api/admin`，全部接口走 `SessionGuard` + 新增的 `AdminGuard`：每次请求从数据库读取当前用户角色，不信任缓存或前端。
  - 未登录 → `401`；已登录但非管理员 → `403`，body `{ "message": "...", "code": "ADMIN_REQUIRED" }`。
- 错误 body 统一为 `{ message, code? }`。前端按 `code` 显示中文提示（见下文各接口），没有 `code` 时显示 `message`。
- 写接口：
  - `POST` + `Content-Type: application/json`，沿用现有 Origin 校验。
  - 必须带 `Idempotency-Key`（UUID）。同一 key 重放返回首次结果；同 key 不同内容 → `409 IDEMPOTENCY_CONFLICT`。
  - body 必须含 `reason`（去首尾空格后 3–500 字符），否则 `400 VALIDATION_ERROR`。
  - 数据库内业务修改和 `AuditLog` 写入在同一事务内完成。上游检测、同步和配置文件写入使用先占用幂等键、执行、记录结果的方式；外部接口或文件不能和 PostgreSQL 组成单一事务。事件重试先保存审计与处理占用，再调用处理器，最后保存结果。
- 列表接口参数：`page`（从 1 开始）、`pageSize`（10/20/50，默认 20）、`search`、`status`，以及各接口的额外筛选。返回：
  ```json
  { "items": [], "page": 1, "pageSize": 20, "totalItems": 0, "totalPages": 1 }
  ```
  管理列表用页码分页（offset），与 C 端的游标分页不同。
- 时间一律 ISO 8601 UTC 字符串；金额为最小单位整数（`amountMinor`、`priceMinor`），并附 `currency`。

## 需要的数据库变更

| 变更 | 用途 |
|---|---|
| `User.role`：`USER` / `ADMIN`，默认 `USER` | 区分管理员 |
| `User.status`：`ACTIVE` / `DISABLED`，默认 `ACTIVE` | 禁用账号；禁用时撤销该用户的全部 `Session`，登录时拒绝 |
| `User.lastLoginAt`（可空） | 用户列表展示 |
| `AuditLog` 增加 `targetType`、`reason` | 记录操作对象类型和原因。现有 `resourceId` 作为 `targetId` 使用；`userId` 记录执行操作的管理员 |
| `Order.kind` 增加 `ADMIN_ASSIGN`、`ADMIN_EXTEND` | 管理员免费开通和延期，`amountMinor = 0` |
| `Lease.status` 增加 `ENDED`，使用已有的 `endedAt` | 管理员回收 |

另需提供一个运营 CLI，把已有账号设为管理员，例如 `npm run pc:operator -- grant-admin --email=...`。不要开放任何能把用户提升为管理员的 HTTP 接口。

`GET /api/auth/me` 需要返回 `role`。前端据此在用户工作台的账户菜单中显示「管理后台」入口。

## 只读接口

| 方法与路径 | 返回 | 说明 |
|---|---|---|
| `GET /session` | `AdminSession { id, email, role }` | 进入后台时的权限检查；窗口重新获得焦点时会再次调用 |
| `GET /summary` | `AdminSummary` | 概览页的数字、最近 6 笔订单、3 天内到期的 6 条租约、`integrations` 接入状态 |
| `GET /users` | `Page<AdminUser>` | `search` 匹配邮箱或 ID；`status` 取 `ACTIVE`、`DISABLED` 或 `ADMIN`（按角色筛选） |
| `GET /users/:id` | `{ user, leases, orders }` | 订单最多 50 条 |
| `GET /numbers` | `Page<AdminNumber>` | `status` 取 `AVAILABLE`、`OCCUPIED`、`HELD`；`provider` 取 `demo` 或 `pingcode`；`search` 匹配号码、当前用户邮箱、`providerNumberId` |
| `GET /numbers/:id` | `{ number, leases }` | `leases` 为该号码的全部租用历史 |
| `GET /leases` | `Page<AdminLease>` | `status` 取 `ACTIVE`、`EXPIRING`（ACTIVE 且 3 天内到期）、`EXPIRED_HELD`、`ENDED`；支持 `userId`；`search` 匹配号码、邮箱、租约 ID |
| `GET /leases/:id` | `{ lease, orders, messages }` | `messages` 为收发合并后最近 20 条 |
| `GET /orders` | `Page<AdminOrder>` | `status` 取具体状态，或 `TODAY`（24 小时内）、`ATTENTION`（`PENDING`/`PROCESSING`/`UNCERTAIN`/`FAILED`）；支持 `userId` |
| `GET /orders/:id` | `AdminOrder` | |
| `GET /messages` | `Page<AdminMessage>` | 入站 `Message` 与出站 `OutboundMessage` 合并，按时间倒序。`direction` 取 `INBOUND` 或 `OUTBOUND`；支持 `leaseId`；`status` 仅作用于出站记录 |
| `GET /webhooks` | `Page<AdminWebhook>` | 数据库分页，列表不返回 `payload`；支持 `status`、`provider`、`eventType`、`from`、`to`，详见下文 |
| `GET /webhooks/summary` | `{ counts, retryExhausted }` | 全部事件按状态计数 |
| `GET /webhooks/:id` | `AdminWebhook & { history }` | 原始内容与最近 50 次处理记录 |
| `GET /audit` | `Page<AdminAudit>` | `status` 在这里表示 `action`，按操作类型筛选 |

派生字段的计算方式：
- `AdminNumber.saleStatus`：`occupied` 为真 → `OCCUPIED`；否则 `holdReason` 不为空 → `HELD`；其余为 `AVAILABLE`。
- `AdminNumber.currentLease`：当前有效租约，没有则为 `null`。
- `AdminLease.status`：与 `leaseView` 一致，`ACTIVE` 但已过期的显示为 `EXPIRED_HELD`。
- 用户的 `activeLeaseCount`、`leaseCount`、`orderCount` 以及租约的 `messageCount`、`outboundCount` 都是计数。

## 写接口

所有写接口都带 `reason` 和 `Idempotency-Key`，`action` 列为写入审计日志的操作类型。

| 方法与路径 | body | 效果 | `action` | 错误码 |
|---|---|---|---|---|
| `POST /users/:id/status` | `{ status: "ACTIVE" \| "DISABLED", reason }` | 修改用户状态；禁用时撤销该用户全部会话 | `USER_STATUS` | `ADMIN_PROTECTED`（目标是管理员） |
| `POST /users/:id/password` | `{ newPassword, reason }` | 按现有哈希方式重置密码（12–128 字符），撤销全部会话。审计日志中不得出现密码或其哈希 | `USER_PASSWORD_RESET` | `ADMIN_PROTECTED` |
| `POST /numbers/:id/assign` | `{ userId, term: 7 \| 30, reason }` | 锁住用户和号码行后：创建 ACTIVE 租约（`priceMinor = 0`），号码设为 `occupied`，并生成一笔 `ADMIN_ASSIGN` 订单（状态 `COMPLETED`，金额 0）。返回 `AdminLease` | `NUMBER_ASSIGN` | `NUMBER_UNAVAILABLE`、`USER_UNAVAILABLE`（用户不存在、已禁用或是管理员） |
| `POST /numbers/:id/hold` | `{ hold: boolean, reason }` | `hold` 为真时写入 `holdReason = reason`，号码不再出现在库存中；为假时清空 `holdReason`。号码正在被占用时拒绝 | `NUMBER_HOLD` | `NUMBER_UNAVAILABLE` |
| `POST /leases/:id/end` | `{ reason }` | 租约设为 `ENDED`、`endedAt = now`；号码 `occupied = false`，`holdReason` 设为「管理员回收，待人工复核」，**不自动重新上架**；历史短信和订单保留 | `LEASE_END` | `LEASE_NOT_ACTIVE` |
| `POST /leases/:id/extend` | `{ days: 7 \| 30, reason }` | 仅限 ACTIVE 租约：`expiresAt += days`，并生成一笔 `ADMIN_EXTEND` 订单（金额 0）。必须遵守租期不重叠的 SQL 约束 | `LEASE_EXTEND` | `LEASE_NOT_ACTIVE` |
| `POST /webhooks/:id/retry` | `{ reason }` | 对 `FAILED`、`UNMATCHED`、`QUARANTINED`、`RECEIVED` 或占用超时的 `PROCESSING` 事件，按其类型调用处理器。返回处理后的状态；HTTP 成功不代表已经匹配成功。不向上游发新短信或采购请求 | `WEBHOOK_RETRY` | `WEBHOOK_NOT_RETRYABLE`（已处理、仍处理中、账号不匹配或类型不支持） |

所有写操作对应记录不存在时返回 `404 NOT_FOUND`。

## 套餐、号码录入与到期规则（2026-11-02 新增）

迁移 `202611020001_plans_inventory_admin`：新增 `Plan`、`AppSetting` 表；`PhoneNumber` 新增 `source`（`SEED` / `ADMIN` / `SYNC`）和 `note`；租约和订单的租期由「只能 7 或 30 天」放宽为 1–365 天；管理员开通和延期的订单金额允许大于 0，用于记录线下收款。

价格不再写在代码里：用户端通过公开接口 `GET /api/plans` 读取上架的套餐（`{days, price, currency, label, note}`，`price` 单位为美元）；租赁、续费只接受上架套餐的天数，否则返回 `400 PLAN_UNAVAILABLE`。

### 只读

| 方法与路径 | 返回 | 说明 |
|---|---|---|
| `GET /plans` | `AdminPlan[]` | 全部套餐（含下架），`orderCount` 为按该天数首次租用的订单数 |
| `GET /settings` | `{ cooldownDays: number \| null }` | 到期保留天数；`null` 表示只由管理员手动释放 |
| `GET /numbers/stats` | `RegionStock[]` | 按地区统计可售 / 使用中（含到期保留）/ 暂停 / 合计，可售少的排前面 |

- `AdminNumber` 新增 `regionId`、`source`、`note`、`heldSince`、`heldBy`、`autoReleaseAt`、`deletable`；`saleStatus` 新增 `EXPIRED_HELD`（租约已到期，号码仍为上一位用户保留）。
- `AdminOrder` 新增 `note`（线下收款备注）。
- `AdminSummary` 新增 `expiredHeldNumbers`、`lowStock`、`lowStockThreshold`（3）。
- 号码搜索同时匹配州名和备注。

### 写接口（均需 `reason` 和 `Idempotency-Key`）

| 方法与路径 | body | 效果 | `action` |
|---|---|---|---|
| `POST /plans` | `{ days, priceMinor, label, note, active, sortOrder }` | 新建套餐；同天数已存在返回 `409 PLAN_EXISTS` | `PLAN_CREATE` |
| `POST /plans/:id` | 同上，不含 `days` | 修改价格、名称、上下架、排序；不能下架最后一个上架套餐（`409 LAST_ACTIVE_PLAN`）。已有订单的价格不变 | `PLAN_UPDATE` |
| `POST /settings` | `{ cooldownDays: 0–365 或 null }` | 设置到期保留天数 | `SETTINGS_UPDATE` |
| `POST /numbers` | `{ number, countryCode: "US" 或 "CA", regionId, regionName, note? }` | 手动新增号码，统一存为 `+1 AAA NNN NNNN`；重复返回 `409 NUMBER_EXISTS` | `NUMBER_CREATE` |
| `POST /numbers/import/preview` | `{ rows: [...] }` | 只检查不写入，不需要原因和幂等键。返回 `{ valid, errors: [{ line, message }] }`，最多 1000 行 | — |
| `POST /numbers/import` | `{ rows, reason }` | 有任何错误行时整批拒绝（`400 IMPORT_INVALID`）；否则全部写入，每个号码一条日志 | `NUMBER_CREATE` |
| `POST /numbers/:id` | `{ countryCode, regionId, regionName, note? }` | 修改地区和备注；号码本身不可改 | `NUMBER_UPDATE` |
| `POST /numbers/:id/delete` | `{ reason }` | 仅限从未租用、没有订单的号码，否则 `409 NUMBER_IN_USE` | `NUMBER_DELETE` |
| `POST /numbers/batch` | `{ ids: 1–200 个, action: "release" 或 "hold" }` | `release`：到期保留或已暂停的号码重新上架（到期租约转为 `RELEASED`）；`hold`：可售号码暂停。处理不了的号码列入 `skipped`，不会整批失败。返回 `{ changed, skipped }` | 每个号码一条 `NUMBER_RELEASE` 或 `NUMBER_HOLD` |

修改的已有接口：
- `POST /numbers/:id/assign` 改为 `{ userId, term, amountMinor?, note?, reason }`。`term` 必须是已定义套餐的天数（可以是下架套餐）；`amountMinor` 为实际收款，默认 0；备注保存在订单的 `evidence.adminNote`。
- `POST /leases/:id/extend` 改为 `{ days: 1–365, amountMinor?, note?, reason }`。

### 自动释放

维护任务每 30 秒执行一次。设置了 `cooldownDays` 时，把到期超过该天数的 `EXPIRED_HELD` 租约转为 `RELEASED`，号码重新上架，并以原用户的名义写入 `LEASE_AUTO_RELEASED` 日志。未设置时行为与以前相同：到期号码一直保留，直到管理员手动释放。

## 上游接入与事件处理（2026-11-03）

后台入口：`/#/admin/integrations`。以下路径仍以 `/api/admin` 为前缀，只有管理员可访问。

| 方法与路径 | 参数或返回 | 作用 |
|---|---|---|
| `GET /integrations/pingcode` | `IntegrationConfig` | API 地址、账号、密钥是否已配置、回调地址、最近检测和同步结果、能力边界；不返回密钥 |
| `POST /integrations/pingcode` | `{ baseUrl, accountId, apiKey?, receiveWebhookSecret?, sendWebhookSecret?, reason }` | 原子保存到服务端 `.env`，并更新当前实例；密钥留空保留原值；已有 PingCode 号码时禁止直接换平台地址或账号 |
| `POST /integrations/pingcode/check` | `{ reason }` → `IntegrationCheck` | 只读验证 `/me`、账号与权限；返回 `ok`、`connected`、`missingScopes` 和中文结果 |
| `GET /integrations/pingcode/numbers` | `{ items, total }` | 拉取全部上游号码，标记 `imported`；不修改库存 |
| `POST /integrations/pingcode/sync` | `{ rows?, reason }` → `IntegrationSync` | `rows: []` 刷新既有资源；指定元数据时导入，默认暂停；同步缺失资源标记 `UNAVAILABLE`，保留原租约 |

`rows` 元素为 `{ numberId, countryCode, countryName, regionId, regionName }`，地区由运营明确指定，不能通过地址差异保证号段分散。页面每批最多选择 100 个待导入号码。新导入保持暂停，不执行上游采购、发信或扣费。

配置存储适用于当前单实例部署；可用服务端 `ONCE_ENV_FILE` 指定可持久化的配置文件。部署时不要用旧的 `PINGCODE_*` 进程环境变量覆盖此文件；多实例需统一配置存储与密钥管理。签名密钥只写服务端配置，幂等记录与审计中均不保存请求正文或密钥。保存配置后会清除旧连接检测缓存。

事件状态：`RECEIVED`、`PROCESSING`、`UNMATCHED`、`PROCESSED`、`FAILED`、`QUARANTINED`。新增返回 `eventType`、`providerAccountId`、`retryable`、`retryExhausted`。`provider` 为 `pingcode` 或 `demo`（后者按演示命名空间筛选）；`eventType` 支持 `sms.received`、`sms.send.status_changed`；`from/to` 为接收时间的 ISO 8601 边界。

迁移 `202611030002_webhook_history` 新增 `WebhookAttempt`，记录处理来源、前后状态、错误码、耗时和时间，不复制短信正文。历史处理记录从升级后开始累积。人工重试占用事件 2 分钟，重复幂等键不会再次执行；不同键也不能同时人工处理同一事件。自动任务可恢复超时占用，自动重试达到上限后需人工核对；重试不会跳过原始内容、账号、号码和历史租约检查。

操作日志新增 `INTEGRATION_CONFIG_UPDATED`、`INTEGRATION_CHECK`、`INTEGRATION_SYNC`。使用说明见 [ONCE-上游接入说明.md](ONCE-上游接入说明.md)。

## 后续范围

真实支付渠道由支付同事对接；当前 PingCode 开放 API 没有号码采购或上游续费接口，真实 C 端付费交付仍需另行联调，不能把同步成功当作售卖验收。管理员账号创建/降级和短信内容导出不在此次范围。
