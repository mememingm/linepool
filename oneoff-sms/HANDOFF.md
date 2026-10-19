# ONCE 项目交接文档

> 交接对象：ONCE 一次性接码平台本地演示项目  
> 项目目录：`D:/llinepool/oneoff-sms`  
> 当前版本：V2 共享号码池业务模型 + 本地 SQLite 演示环境  
> 最近更新：平台 Logo 与平台目录补全

## 1. 项目定位

ONCE 面向一次性验证码接收场景。用户购买的是：

> 指定平台 + 指定国家 + 一次接码服务

用户不是购买号码所有权，也不能直接挑选或管理整个号码池。号码属于后台资源，由系统自动分配、接收短信、匹配订单、结束任务并按规则释放。

当前项目是**本地演示和业务验证环境**，不是生产接码平台：

- 使用本机 SQLite。
- 使用明确标记的 Mock 号码、价格、库存能力、余额和短信。
- 不连接真实 PingCode。
- 不连接支付网关。
- 不向真实平台发送或接收验证码。
- 不修改 LINEPOOL 长期号码租赁业务。
- 不影响 eSIM 托管网站。

## 2. 当前完成情况

### 已完成

- 平台选择 → 国家选择 → 查看价格和有效期 → 确认接码的用户流程。
- 共享号码池的数据结构和显式平台能力模型。
- 同一号码同一时间只能有一个有效任务。
- 号码结束后按平台使用历史和冷却规则处理复用。
- 订单、任务、支付预占、结算、退款和操作日志的本地模型。
- 短信事件去重、订单匹配、迟到短信隔离和异常隔离模型。
- 客户端市场、我的订单、订单详情、历史、钱包、帮助和账户页面。
- 独立管理员入口及本地运营页面。
- Radix Dialog/Popover 与 cmdk 统一的弹窗、下拉框和搜索交互。
- GSAP 页面及弹窗动效，并支持 reduced-motion。
- 50 个 Logo 素材接入，加上已有 WeChat、RedNote，共 52 个平台目录项。
- 平台 Logo、名称和简介使用共享配置，前台和后台共用。

### 最近一次 Logo 补全的边界

Logo 只代表平台目录身份，不代表：

- 该平台有真实库存。
- 该平台可以接收验证码。
- 号码已经具备该平台能力。
- PingCode 支持该平台。
- 该平台已经可以真实下单。

新导入的平台没有自动获得号码能力，默认不能产生真实可售库存。Logo 补全后按要求**未重新运行测试、构建或浏览器验证**，接手人需要在后续修改后自行验证。

## 3. 技术栈

- Node.js `24.x`
- React `19`
- TypeScript `5.9`
- Vite `7`
- SQLite：Node 内置 `node:sqlite`
- UI：Radix Dialog、Radix Popover、cmdk、Lucide React
- 动效：GSAP、`@gsap/react`
- API：Node 原生 HTTP Server
- 数据库：本地 SQLite，事务使用 `BEGIN IMMEDIATE`

没有引入第二套前端框架，也没有重写 LINEPOOL。

## 4. 目录说明

```text
oneoff-sms/
├─ server/
│  ├─ index.mjs              # API 入口、数据库打开、过期任务定时处理
│  ├─ db.mjs                 # SQLite 表结构、初始化数据、目录同步
│  ├─ migrate-v2.mjs        # V2 数据迁移
│  ├─ platform-catalog.mjs   # 从 shared/platforms.json 补平台和国家商品
│  ├─ service.mjs            # 订单、分配、短信、钱包、管理员业务逻辑
│  ├─ http.mjs               # HTTP 路由、Cookie、CORS/Host 防护、SSE
│  ├─ providers.mjs          # Mock Provider 与 PingCode 适配边界
│  ├─ secrets.mjs            # 本地管理员密钥和 Webhook 密钥
│  └─ *.test.mjs             # 后端测试
├─ src/
│  ├─ App.tsx                # 页面路由和应用外壳
│  ├─ pages.tsx              # 市场、订单、历史、钱包、帮助页面
│  ├─ dialogs.tsx            # 创建订单、订单详情、取消、反馈等弹窗
│  ├─ admin.tsx               # 管理员页面
│  ├─ components.tsx         # 公共图标、弹窗、搜索、状态、分页组件
│  ├─ select.tsx              # 统一下拉框
│  ├─ catalog.ts              # 平台名称、简介、Logo 映射
│  ├─ motion.tsx              # GSAP 和 reduced-motion 封装
│  ├─ styles.css              # 客户端全局样式和响应式布局
│  └─ operations.css          # 管理员页面样式
├─ shared/
│  └─ platforms.json          # 52 个平台的 id、名称、简介
├─ public/
│  ├─ services/               # 平台 SVG Logo
│  └─ flags/                  # 国家旗帜
├─ data/
│  ├─ once.sqlite             # 本机运行数据库，不提交 Git
│  ├─ local-secrets.json      # 本地管理员/Webhook 密钥，不提交 Git
│  └─ backups/                # SQLite 备份
├─ output/playwright/         # 浏览器脚本和截图，不提交 Git
├─ README.md                  # 项目说明和 V2 设计记录
└─ HANDOFF.md                 # 本交接文档
```

## 5. 本地启动

要求 Node.js `24.x` 和 npm。从项目目录执行：

```powershell
cd D:/llinepool/oneoff-sms
npm install
npm run dev
```

地址：

- 客户端：<http://127.0.0.1:5188/#/market>
- 管理员：<http://127.0.0.1:5188/#/admin>
- API：<http://127.0.0.1:3028>

项目刻意只允许回环地址。使用 `127.0.0.1`，不要使用局域网地址或其他 Host。

其他命令：

```powershell
npm run dev:api   # 只启动 API，监听 3028
npm run dev:web   # 只启动 Vite，监听 5188
npm start         # 使用 dist 启动 API 和构建后的前端
npm run build     # TypeScript 检查和前端生产构建
npm test          # 后端测试
```

当前已有服务可能占用 3028 和 5188。重复启动前先确认端口，避免误以为代码没有生效。

## 6. 数据库和初始化行为

数据库默认位置：

```text
D:/llinepool/oneoff-sms/data/once.sqlite
```

数据库由 `server/index.mjs` 通过 `openDatabase()` 打开。启动时依次执行：

1. 创建基础表。
2. 执行 `migrateV2()`。
3. 执行 `syncPlatformCatalog()`。
4. 启动过期任务处理器。

### 平台目录同步

`shared/platforms.json` 是前后端共用的平台身份配置，当前包含：

- Logo 素材目录中的 50 个平台。
- 已有的 WeChat。
- 已有的 RedNote。

`server/platform-catalog.mjs` 会为缺失的平台创建服务和国家商品，但使用本地演示价格与时长。它不会覆盖已经存在的价格、规则或启用状态，也不会向 `number_services` 写入号码能力。

因此：

- 新平台会出现在平台市场。
- 新平台可以有商品配置。
- 如果没有号码能力映射，则库存为 0。
- Logo、商品和号码能力是三个不同层次，不能混为一谈。

### 重要数据表

| 表 | 作用 |
| --- | --- |
| `resources` | 号码资源、国家、来源、在线状态、成本和全局冷却 |
| `services` | 平台服务 |
| `products` | 平台 + 国家 + 价格 + 时长 + 规则 |
| `number_services` | 号码对平台的显式能力和状态 |
| `tasks` | 用户接码任务及状态快照 |
| `orders` | 订单主记录 |
| `assignments` | 号码与任务的独占分配区间 |
| `usage_history` | 号码历史使用记录 |
| `incoming_sms` | 去重后的短信事件及隔离状态 |
| `messages` | 已确认归属任务的短信 |
| `wallets` | 本地测试余额和预占余额 |
| `wallet_transactions` | 测试额度、预占、结算、退款流水 |
| `order_events` | 订单状态变更历史 |
| `audit_log` | 管理员操作审计 |

当前演示号码是虚构的 `+120255501xx`，不能用于真实验证。数据库默认有 100 个资源，能力集合按资源配置，且仅用于演示共享池逻辑。

## 7. 用户流程

1. 用户打开接码市场。
2. 选择平台，例如 TikTok、WeChat 或 RedNote。
3. 在弹窗内搜索并选择国家。
4. 查看当前本地商品的价格、时长、库存和规则。
5. 确认测试额度提示。
6. 后端重新校验价格、余额、国家、平台能力和库存。
7. 以事务方式预占测试额度并分配号码。
8. 进入订单详情，查看虚构号码和接码状态。
9. 收到明确匹配的 Mock 短信后展示验证码。
10. 任务成功、超时、取消或异常后关闭分配并记录历史。

前端按钮防重复点击，但真正的幂等、防并发和资金保护在后端完成。订单创建请求继续使用：

```json
{
  "productId": "...",
  "expectedPriceCents": 120,
  "idempotencyKey": "..."
}
```

同一个用户使用相同幂等键重试会返回原订单；相同幂等键提交不同内容会被拒绝。

## 8. 号码分配、复用和短信匹配

当前本地规则：

- 同一号码同一时间只能存在一个有效分配。
- 分配前必须满足在线、国家、平台能力、未占用和冷却条件。
- 一个号码可以按显式能力服务不同平台，但不能自动推断全部平台都支持。
- 某平台成功使用后，平台能力状态会保留历史使用限制，不能被管理员直接改回全新资源。
- 任务结束后保留 `usage_history`，并根据测试规则应用冷却。
- 延迟短信不能因为号码被重新分配就展示给后续客户。

短信匹配必须同时验证：

- Provider。
- event ID 和 message ID 去重。
- resource ID。
- service ID。
- assignment ID。
- 订单有效时间。
- 事件时间不能在未来，不能晚于有效窗口。
- 验证码格式必须明确且不产生歧义。

无法明确归属的短信进入 `QUARANTINED`，不展示给客户。

## 9. PingCode 对接边界

当前项目**没有真实接入** `http://121.40.200.35/pingcode/`。代码中保留的是可替换 Provider 边界：

- `MockSmsProvider`：本地演示和测试使用。
- `PingCodeProvider`：当前未配置，故意失败关闭。
- `/api/providers/pingcode/webhook` 当前返回 `503 PINGCODE_NOT_CONFIGURED`。

接入 PingCode 前需要对方提供并确认：

1. 真实 API 根地址和鉴权方式。
2. 号码查询、库存、国家、在线状态和资源 ID 字段。
3. 号码分配、占用、释放或租赁关联接口。
4. 平台兼容能力和号码重复使用限制。
5. 短信事件 ID、消息 ID、号码、来源、发生时间和重试语义。
6. Webhook 签名校验、重放防护和补偿查询接口。
7. 失败、超时、限流、数据保留和费用规则。
8. 不能与 LINEPOOL 长期客户号码冲突的资源边界。

不能因为页面能访问或有某个接口名称，就默认 PingCode 已经支持自动分配、回收或平台兼容判断。

## 10. 管理员入口

管理员入口是独立会话，不使用客户 Cookie。管理员本地密钥位于：

```text
D:/llinepool/oneoff-sms/data/local-secrets.json
```

也可通过环境变量覆盖：

```text
ONCE_ADMIN_TOKEN
ONCE_MOCK_WEBHOOK_SECRET
```

不要把本地密钥写入前端、截图、日志或 Git。

管理员页面可查看和处理：

- 平台和国家商品。
- 号码资源、在线状态和成本。
- 号码平台能力及限制原因。
- 订单和异常任务。
- 本地 Mock 短信注入。
- 待处理结算。
- 收入、成功率、平台排名和号码复用统计。
- 操作审计。

管理员手工操作不能绕过短信匹配和结算规则伪造成功。

## 11. 主要 API

客户侧：

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| `GET` | `/api/bootstrap` | 当前工作区、平台商品、任务、钱包和账本 |
| `GET` | `/api/tasks/:id` | 当前用户自己的订单详情 |
| `POST` | `/api/tasks` | 幂等创建订单并分配资源 |
| `POST` | `/api/tasks/:id/cancel` | 按订单规则取消 |
| `POST` | `/api/tasks/:id/feedback` | 保存本地反馈 |
| `PATCH` | `/api/preferences` | 保存主题偏好 |
| `GET` | `/api/events` | 当前用户范围的 SSE 更新通知 |
| `POST` | `/api/wallet/test-credit` | 添加明确标记的测试额度 |

管理员和 Provider：

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| `POST` | `/api/admin/login` | 管理员登录 |
| `GET` | `/api/admin/snapshot` | 管理员数据快照 |
| `POST` | `/api/admin/mock-sms` | 通过真实匹配逻辑注入本地测试短信 |
| `POST` | `/api/providers/mock/webhook` | 签名校验的本地 Mock Webhook |
| `POST` | `/api/providers/pingcode/webhook` | 真实 PingCode 边界，当前未启用 |

所有变更请求要求 `application/json`，请求体上限 8192 字节。错误格式为：

```json
{ "error": { "code": "...", "message": "..." } }
```

## 12. 最近 Logo 接入改动

本次补全涉及：

- 新增 `shared/platforms.json`。
- 新增 `server/platform-catalog.mjs`。
- 修改 `server/db.mjs`，启动时同步平台目录。
- 修改 `src/catalog.ts`，从共享配置读取简介和 Logo 路径。
- 修改 `src/components.tsx`，通过共享 Logo 映射显示平台图标。
- 修改 `src/styles.css`，使用 Logo 原色并统一图标容器。
- 将 `D:/llinepool/output/platform-logos/logos/*.svg` 复制到 `public/services/`。
- 更新 `README.md` 的平台数量和素材说明。

素材来源、文件哈希和许可说明：

```text
D:/llinepool/output/platform-logos/manifest.json
D:/llinepool/output/platform-logos/README.md
```

注意：平台 Logo 的商标权仍属于各自权利人，素材库不代表平台授权或背书。

## 13. 当前验证状态

V2 核心功能在 Logo 补全之前已有后端和浏览器验证记录，详情见 `README.md` 和 `output/playwright/`。

但是，最近一次 Logo 补全后按需求没有运行：

- `npm test`
- `npm run build`
- Playwright 浏览器验证
- 生产环境验证

因此接手人正式继续开发前，建议先执行：

```powershell
cd D:/llinepool/oneoff-sms
npm run build
npm test
```

然后启动本地服务，检查市场页面是否显示 52 个平台以及新增 Logo 是否能正常加载。

## 14. 建议后续顺序

### P0：确认当前源码可运行

- 构建并运行后端测试。
- 打开市场页检查平台数量、Logo、搜索和弹窗。
- 检查旧数据库启动迁移不会覆盖已有商品配置。
- 检查没有新增平台被错误赋予号码能力或库存。

### P1：整理平台配置来源

- 将价格、时长、可售状态从 Logo 身份配置中彻底分离。
- 明确哪些平台是真正运营平台，哪些只是待配置目录项。
- 为商品增加明确的 `catalog/demo/unavailable` 展示状态。
- 不要把“平台已展示”当成“平台可售”。

### P2：PingCode 适配

- 先拿到正式 API 和 Webhook 契约。
- 在 `server/providers.mjs` 中实现独立适配器。
- 增加真实资源 ID 与本地 `resources` 的映射。
- 增加签名、重放、断线补偿和轮询对账。
- 先在沙箱或只读模式联调，不直接开放客户购买。

### P3：生产化

- 正式客户账户和权限。
- 管理员 RBAC 和操作审批。
- HTTPS、Secure Cookie、限流和密钥托管。
- 真实支付通知、余额对账和退款。
- 多实例 SSE/队列/定时任务。
- 备份、监控、告警、数据保留与删除策略。
- 上线前完成同号并发、跨平台复用、串码防护和迟到短信测试。

## 15. 交接结论

当前项目可以作为一个**本地可运行的 ONCE 业务原型和技术验证基线**：

- 前台卖的是平台国家接码服务。
- 后台管理共享号码资源。
- 号码跨平台复用需要显式能力和规则。
- 同号并发被禁止。
- 短信无法明确匹配时不会展示。
- 所有余额和短信都属于本地测试数据。
- PingCode、支付和真实库存尚未接入。

接手人最先要做的是确认 Logo 补全后的构建和运行状态，然后再推进 PingCode 接口确认，不要先开放真实交易。

## ONCE V3 独占租约演示

当前默认客户入口是 ONCE 号码商城：客户选择指定虚构号码和 7/30 天方案，成功后获得同号独占租约。租约权益是资源排他和持续收信，不是收到一次短信就结束；普通文本和验证码都可在租期内保存，续费从当前到期时间追加同一号码的租期，开通和续费均使用本地测试账本并带幂等请求键。

V3 在 `server/migrate-v3.mjs` 增量建立 `lease_plans`、`leases`、`lease_orders`、`lease_events` 和租约入站短信表。仅指定的未使用 Mock 号码进入初始独占池；遗留共享任务和历史短信不会转换成长租。租约资源与共享分配有数据库触发器互斥，过期号码先进入 `REVIEW` 待回收，不自动进入共享池；回收/重新上架必须由管理员记录理由。客户自带资源用途不能转入平台可售池。

管理员在独占租赁页可调整 7/30 天测试方案、查看租约、注入明确标记的 Mock 普通短信或验证码，并处理资源用途和待回收状态。发送短信、真实支付、真实上游续费、用量查询、设备管理、写卡和真实短信均未启用，页面显示为禁用或未知，不伪造成功。客户 Cookie 仍只是本地演示工作区。

数据库启动方式：`ONCE_DB_PATH` 可指向临时 SQLite；已有数据库在首次 V3 迁移前自动用 `VACUUM INTO` 写入 `data/backups/pre-v3-<timestamp>.sqlite`。本地演示默认使用 `data/once.sqlite`，启动不会重置旧任务、余额、流水或短信。

验证：`npm test`（34 项，包含租约服务、HTTP、SQLite 并发、迁移和隔离测试）与 `npm run build` 均通过。浏览器验证脚本草稿位于被忽略的 `output/playwright/lease-v3-check.mjs`；本次收尾以隔离临时库的服务/HTTP测试为准，未宣称生产可用。
