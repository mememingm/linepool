# PingCode 与 LINEPOOL 接口对照及 Mock 适配说明

## 1. 依据与本次范围

依据用户提供的本地文档 `C:/Users/27792/Downloads/API Reference · PingCode.html`（页内 `DEVELOPER / REFERENCE v1`，共 19 个接口及接收/发送 Webhook 说明）。本文“已支持”仅指**这份文档已描述且本次有 Mock 适配/测试**，不代表真实服务联调通过；“尚未提供”指这份文档未提供，不推断 PingCode 内部一定不存在此能力。

文档原文根地址为 `http://120.55.75.51/pingcode/api/open/v1`，认证为 `Authorization: Bearer pc_live_…`，时间为 UTC ISO 8601。本次仅使用文档中的相对路径，**没有配置或请求该地址、加载 API Key、执行在线调试、开启公网 Webhook，也没有启用真实供应商或生产业务**。

前端页面、LINEPOOL 内部 API、7/30 天 RECEIVE 套餐、积分定价、库存匹配、区号规则、订单幂等和关闭续费等既有规则不变。价格/套餐仍来自本地数据库。购买写事务中的资源选择与分配抽到统一 `ReceivingProvider`，运行时明确固定为 `MockReceivingProvider`；PingCode 文档支持的读取操作统一由其 `reader: PingCodeAdapter` 提供，数据传输由可注入的 `PingCodeTransport` 隔离。本次唯一具体传输实现是内存 `MockPingCodeTransport`。

## 2. LINEPOOL 所需接口清单

以下路径均相对于文档的 `/pingcode/api/open/v1`，Webhook 为 PingCode 主动推送，不是可查询的 PingCode 路径。

| LINEPOOL 所需能力 | PingCode 文档接口/机制 | 状态 | 本次落实及边界 |
| --- | --- | --- | --- |
| 确认账号与读取权限 | `GET /me` | 已支持 | `account()` 校验 `id/username/scopes/expiresAt`；Mock 验证，不涉及 LINEPOOL 登录或用户角色 |
| 查询已有号码资源 | `GET /numbers` | 已支持 | `numbers()`；`limit/cursor/status`；保留五种上游状态与上游资源到期时间，缺省值规范化为 null |
| 按号码查询详情 | `GET /numbers/by-phone` | 已支持 | `number(phoneNumber)`；统一前导 `+`；不将查询当成采购或分配 |
| 拉取收到的短信 | `GET /sms` | 已支持 | `messages()` 固定 `direction=INBOUND`，按明确号码查询；支持游标及 `createdAfter` 参数 |
| 查询单条收件详情 | `GET /sms/{id}` | 已支持 | `message(IN-UUID)`；阻止出站消息进入收件流程 |
| 接收新短信事件 | 接收 Webhook：`sms.received` | 已支持（本地解码）/待确认（账号覆盖） | 原始字节 HMAC、时间戳和事件 ID 校验；测试事件忽略；本地幂等入库。未开放 HTTP 接收路由。文档明确普通用户可配置、管理员全平台 Webhook 暂未开放 |
| 平台/国家/7 天和 30 天商品目录 | 未描述 | 尚未提供 | 不把“发送项目”当作可售平台，不从号码猜测商品关系 |
| 按平台/国家/期限/区号查询可售库存 | 未描述 | 尚未提供 | `GET /numbers` 是已有资源查询，不能代表可采购库存；`ACTIVE` 也不能代表可销售 |
| 权威报价、币种/积分单位及报价有效期 | 未描述 | 尚未提供 | 本地原价不变，不编造上游报价字段 |
| 采购下单、幂等购买、超时查单、失败撤销 | 未描述 | 尚未提供 | 本地原下单事务继续 Mock；`PingCodeAdapter.purchase()` 明确抛 `PURCHASE_NOT_DOCUMENTED` |
| 号码预占、分配、归属变更、占用时效 | 未描述 | 尚未提供 | 本地行锁与分配不变；`allocate()` 抛 `ALLOCATION_NOT_DOCUMENTED`；不能用查询接口代替分配 |
| 到期释放、回收、归还及停用通知 | 未描述 | 尚未提供 | `release()` 抛 `RELEASE_NOT_DOCUMENTED`；本次维持本地到期状态，不自动归还、复售或退款 |
| 订单/平台/用户的短信归属关联 | 号码、短信都有 `numberId`，没有商品平台/订单/LINEPOOL 用户字段 | 待确认 | 仅在隔离 Mock 流程显式给出可信分配/平台路由；真实业务不能据正文猜平台 |
| 实际生效时间与接收资格、共享/复用规则 | 只有号码状态与资源 `expiresAt` | 待确认 | 不以写卡到期时间改写用户服务有效期；不能据此宣称支持跨平台共享 |
| 接收次数、额度、已用/剩余及计费 | 未描述相关读取接口/字段 | 尚未提供 | 不用短信条数、发送策略速率或发送资源组数量拼成接收额度 |
| 事件丢失后的补偿、迟到消息、保留时间与重试节奏 | 近 30 天短信查询、`createdAfter`、Webhook 最多 6 次尝试 | 待确认 | 文档明确的行为保留；未说明的 SLA、重试间隔、游标稳定性/有效期、迟到与跨分配期归属仍待确认 |
| 生产 HTTPS、测试凭据、账号隔离和限流参数 | Bearer Key、读取/发送限流当前均为 0 | 待确认 | 当前没有生产配置；无退避调度或自动重试；错误对象保留 `Retry-After` 秒数供未来调用方处理 |

文档中的以下功能与当前 LINEPOOL 接收短信产品无关，本次不接入：

- `POST /sms/send`、`GET /sms/outbound/{id}`。
- `/sms/projects` 的列表/创建、`/resources`、项目详情、`/strategy`、`/targets/import`、批次与项目启动、批次详情、逐条发送结果，共 10 个发送项目接口。
- `POST /xin/sms/send`、`POST /projectapi/sms/importnumber` 和发送 Webhook。
- 续费不在当前产品范围；文档也没有短期服务续费接口。

其中 `/sms/projects/resources` 的 `availableCount` 是**可发送号码数**，不能映射成短期接码可售库存。发送接口的 `Idempotency-Key` 只说明发送任务幂等，不能推导出采购接口幂等。

## 3. 资源、账号与订单字段映射

| PingCode 字段 | LINEPOOL 内部字段/用途 | 处理与限制 |
| --- | --- | --- |
| `/me.id` | 供应商账号标识（仅读取返回） | 整数，不是 API Key ID，也不是 `users.id` UUID；不自动新建/修改本地账号 |
| `/me.username`、`scopes` | 账号描述、供应商权限 | 不映射为本地 USER/ADMIN；未来至少确认 `numbers:read`、`sms:read` |
| `/me.expiresAt` | Key 到期时间 | 可缺省；不是号码或购买服务的到期时间 |
| 号码 `id` | `ProviderNumber.externalNumberId` → `provider_resource_bindings.external_number_id` | 外部整数转内部字符串，保留稳定 ID；通过独立绑定表关联本地 `phone_numbers.id` UUID，不覆盖本地 ID |
| `phoneNumber` | `ProviderNumber.phoneNumber` | 保留完整号码并统一为前导 `+`；缺省为 null，缺号码不能绑定；不自动导入到可售池 |
| `iccid` | `ProviderNumber.iccid` | 可缺省；仅适配层资源元数据，不暴露为客户短信字段，不自动修改本地号码记录 |
| 号码 `status` | `ProviderNumber.status` | 原样保留 `READY/ACTIVE/UNAVAILABLE/EXPIRED/DISABLED`；不直接覆盖本地 `resource_status`、`sale_enabled` 或服务状态 |
| 号码 `expiresAt` | `ProviderNumber.resourceExpiresAt` | 文档定义为关联写卡记录中最晚的到期时间；**不是用户购买 7/30 天的结束时间**，不写入本地 `phone_numbers.expires_at` 或 `number_allocations.expires_at` |
| `data`、`page.limit/hasMore/nextCursor` | 适配层游标页 | 原样传递不透明 cursor；`hasMore=true` 缺 cursor 拒绝；不编造总条数，也不替换前端页码分页 |
| 文档无对应字段 | `region/service/plan/durationDays/areaCode` | 继续由本地套餐与订单提供，不能从 `/numbers` 假设出来 |
| 文档无对应字段 | `unitPoints/totalPoints/idempotencyKey/orderNumber` | 继续用本地报价、账本与订单；不伪装为 PingCode 采购响应 |
| 文档无对应字段 | `number_allocations.id/user_id/order_id/assigned_at/expires_at` | 属于 LINEPOOL 用户权益，保留本地事务与触发器维护；Mock 路由必须提供明确的分配记录 ID |

号码列表状态枚举为 `UNAVAILABLE`（设备离线），而发送错误文字中还出现 `DEVICE_OFFLINE`。本次读取校验按号码接口正式字段表执行，不把错误描述中的文字擅自添加为返回枚举；实际环境是否存在差异列为待确认。

## 4. 短信字段映射

| PingCode 轮询字段 | Webhook 字段 | LINEPOOL 适配/落库 | 说明 |
| --- | --- | --- | --- |
| `id` | `data.messageId` | `externalMessageId` → `provider_message_receipts.external_message_id` | 入站为 `IN-UUID`；同一供应商下唯一，不覆盖本地短信 UUID |
| `numberId` | `data.numberId` | `externalNumberId` → 资源绑定表 | 必须匹配显式绑定、本地号码与有效分配 |
| `phoneNumber`（可缺省） | `data.phoneNumber` | `phoneNumber` → 号码一致性校验 | 不单独据号码字符串决定本地用户归属 |
| `counterparty` | `data.from` | `sender` → `sms_messages.sender` | 不据发信方猜商品平台 |
| `content` | `data.content` | `body` → `sms_messages.body` | 保存完整正文；文档无验证码字段，`verification_code` 维持 null，不新增正则解析规则 |
| `occurredAt` | 顶层 `occurredAt` | `receivedAt` → `sms_messages.received_at` | 短信发生/接收时间，必须在指定分配的有效期内；Mock 不接收已到期或未来消息 |
| `createdAt` | 文档无此字段 | `upstreamCreatedAt` → `provider_message_receipts.upstream_created_at` | 轮询的增量依据；Webhook 为 null，不能用接收时间捏造入库时间 |
| `direction=INBOUND` | `event=sms.received` | 接收方向校验 | 不导入 OUTBOUND；`status=RECEIVED` 与方向/ID 需一致 |
| 文档无对应字段 | 文档无对应字段 | `sms_messages.user_id/number_id` | 由本地明确的号码与分配归属提供，不能使用上游账号 ID 代替 |
| 文档无对应字段 | 文档无对应字段 | `MockInboundRoute.service` | 仅测试侧显式可信上下文；PingCode 文档无法证明验证码属于 Telegram/WhatsApp 等哪个商品平台 |
| 无 | `eventId` 与 `X-PingCode-Event-Id` | `provider_event_receipts.event_id` | 头部与正文 ID 必须相同，事件 ID 与消息 ID 两级去重 |
| 无 | `test` / `X-PingCode-Test` | 忽略测试事件 | 不生成用户短信或去重回执 |

## 5. 适配层与现有后端关系

- `src/providers/receiving-provider.ts`：统一业务入口 `ReceivingProvider`，资源选择 `reserve()`、分配 `allocate()` 和供应商读取入口 `reader`；`allocationStatus()` 复用原来的时间比较。
- `src/providers/mock-receiving-provider.ts`：保留原 `FOR UPDATE SKIP LOCKED` 查询、美国区号严格匹配和原分配 SQL；仍在 `Ordering.create()` 的同一事务中，抛错全部回滚，没有外部采购副作用。
- `src/providers/pingcode-adapter.ts`：文档支持的 5 个读取接口、Zod 校验、字段规范化、错误及 429 信息、接收 Webhook 本地解码。只有方法/相对路径/查询参数，无 HTTP 实现、地址、Key 或网络请求。
- `src/providers/mock-pingcode-transport.ts`：内存模拟文档响应；Mock 游标使用 `mock-N`，只是测试不透明 token，不宣称 PingCode 真实游标格式。
- `src/providers/receiving-sync.ts`：内部 Mock 资源绑定、分页拉取与入库；绑定和平台/分配上下文缺失时拒绝。无 controller、定时任务或公开接收接口，不会后台自动同步。
- `src/main.ts`：Nest 仅注册固定 Mock provider 与内部同步服务，没有生产切换开关。
- `src/ordering.ts`：仅把资源查询/分配委托给 provider；账户锁、套餐选择、总价、幂等匹配、积分、订单与账本逻辑不变，订单快照来源仍为 `mock`。
- `src/workspace.ts`：服务状态改用同等含义的 `allocationStatus()`；现有目录、号码、订单、短信 API 和前端契约不变。
- `db/migrations/008_mock_provider_receipts.sql`：新增资源绑定、消息回执、事件回执表；资源与消息的 provider 限制为 `pingcode-mock`。不修改历史数据/现有表，不改变号码释放/复用规则。

数据库迁移目前**只在隔离测试 schema 执行**，未应用到 `linepool_react` 业务库，也未重启在用 API。现有 Mock 购买不依赖新增表，绑定/同步仅在测试中显式调用。未来在开发库手动使用同步助手前仍需先备份再迁移，不能直接开启生产。

## 6. 幂等、到期与可靠性边界

1. 本地订单沿用原用户锁和幂等键；同键更换区号等参数返回冲突，失败不扣款，不产生半成品订单。
2. 消息以 `(provider, external_message_id)` 去重；事件另以 `(provider,event_id)` 去重，并校验两者一致。事务级 advisory lock 处理并发轮询/回调，内容或路由冲突拒绝，不静默覆盖。
3. 接收 Webhook 只计算 `HMAC-SHA256(secret, timestamp + '.' + rawBody)`，比较原始请求字节；300 秒时间窗是本地回放策略，**不是文档保证的容差**。文档未给出重试间隔，未来需确认重试时是否重签及时间窗口兼容性。
4. 轮询仅最近 30 天数据，文档要求以 `createdAt` 而不是 `occurredAt` 增量。适配方法支持 `createdAfter`，本次 Mock 同步每次按号码重拉并去重，**未实现持久化增量游标、调度、失败补偿或服务 SLA**；每轮有 100 页保护，异常页不能宣称同步完成。
5. 服务有效期继续由本地分配记录决定。Mock 到期后拒绝新入库，历史短信可见、重复消息幂等，资源不自动释放或重新销售，也不退款/续费。上游资源仍 ACTIVE/更晚到期不能延长本地用户权益；真实迟到投递的处理规则仍待确认。
6. 常规及简写错误信封均读取 `error.code`，不匹配 `message`；保留状态码、`Retry-After`。本次不做网络重试，更不会将未知响应转成成功或未知库存转成可售。

## 7. 本次验证与复现

当前用户明确要求 Mock 测试，本次仅运行相关测试，覆盖：

- 7 项适配单元测试：账号/号码/游标、缺省字段、短信映射与时间、五类上游状态、本地到期边界、非法字段/方向、双错误信封/429/超时、未提供写操作拒绝、Webhook 签名/篡改/时间戳/测试标记。
- 6 项数据库流程测试：购买与同键重试、指定区号、跨账户幂等隔离；库存/余额不足与分配后账本异常回滚；最后一个资源并发抢占；购买→绑定→拉取→入库→用户收件箱；重复轮询/回调去重与冲突；错误号码/平台/旧分配拒绝；7/30 天到期后停收、保留历史、不退款或回收。
- 结果：**13 项通过，0 失败，0 跳过**。全部供应商响应来自内存 fixture，数据库为 `127.0.0.1:5433/linepool_react_test`，每项流程独立随机 `test_…` schema，结束自动删除 schema。未调用 PingCode，未向业务库插入 Mock 订单或短信。
- 流程测试中的时间推进通过修改隔离 fixture 的日期实现，并仅在对应事务临时禁用/恢复号码分配触发器，避免把时间变化误当成新分配；业务触发器与运行代码没有更改。

在准备好的**本地独立测试库**上复现（`TEST_DATABASE_URL` 需事先通过既有项目规则校验，不能指向业务库；凭据通过环境提供）：

```text
npm --prefix linepool-ui/backend run build
npm --prefix linepool-ui/backend run test:pingcode
```

此外，原业务相关的 6 项回归测试全部通过（迁移幂等/校验和、重复 seed 保留既有数据、登录会话、资源与短信用户隔离、订单重试、失败回滚）。最终版本后端构建、测试代码编译、项目 `typecheck:all` 和 117 个文件的上游完整性检查均通过；使用独立测试库在临时 loopback 端口启动 Nest 应用并查询 `/api/health` 返回 200，确认新增 provider 注入可启动，随后关闭临时进程。在用 3010 API 未重启，业务数据库未迁移。浏览器页面未改，本次不宣称已通过真实供应商联调或生产验收。

## 8. 对接前必须补齐的信息

- 可售平台、国家、区号、7/30 天产品稳定 ID，以及报价、库存、预占、采购、取消、分配和释放的正式接口与示例。
- 采购幂等/超时查单/扣款退款边界；发送接口的幂等规则不能作为采购的依据。
- PingCode 接码平台与 LINEPOOL 商品平台/订单/用户的可靠关联；是否支持同号码跨平台复用及如何隔离。仅号码级查询无法证明“只收到购买平台验证码”。
- Key 的数据范围、管理员全平台读取与普通账号 Webhook 的部署组合、生产 HTTPS、测试账号和支持范围。
- 上游写卡到期与用户权益到期的关系、资源失效通知、迟到消息与历史分配隔离，以及 30 天窗口外的补偿策略。
- Webhook 签名重试时间戳、间隔、重复/乱序与游标有效期、限流/延迟承诺；如需额度再补独立查询能力。

这些信息缺失前，本次交付定位为**有文档依据的读取适配层和本地 Mock 验证**，不把本地购买成功当作 PingCode 采购成功。
