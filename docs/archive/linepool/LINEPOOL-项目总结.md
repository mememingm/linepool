# LINEPOOL 项目实现总结

> 历史交接记录：本文件从根目录归档，文中的“当前”和验证结果对应编写时的版本。最新架构与资料入口见[目录导航](../../README.md)。

## 1. 当前产品范围

本总结记录 LINEPOOL 当前短期短信接收服务的产品范围、已完成实现、数据边界和验证结果。后续接入 PingCode 时，应以服务端数据提供层替换为主，保持现有前端页面和用户流程不变。

**LINEPOOL 提供 7 天或 30 天的短期短信接收服务。用户选择平台、国家和服务期限后，系统自动分配号码，在有效期内查看短信。当前不提供长期独享租号、发送短信或续费。**

此前的续费开发仅作为历史实现保留，不再代表当前开放功能。客户续费入口已移除，查询续费方案和新建续费申请均由服务端拒绝；历史记录保留供后台核对。原有号码到期日期、倒计时及短信读取逻辑不变。

## 2. 项目位置与架构

- 根目录：`D:/llinepool`。
- 唯一应用：`D:/llinepool/linepool-ui`，不使用已经移除的旧 Vue `platform/`。
- 技术栈：React、Vite、NestJS、PostgreSQL、TypeScript / Zod 共享契约。
- 本地页面：`http://127.0.0.1:5178/app/purchase`；API：`http://127.0.0.1:3010/api`。
- 沿用 Beautiful UI / Magic UI 组件、Cookie 登录、业务 API 客户端、积分账本与数据库事务。未新增依赖、微服务、支付系统或供应商连接。
- `src/vendor/**`、`public/**`、`upstream-lock.json` 保持只读边界。

## 3. 新购买流程

1. 选择平台：首先展示平台 Logo 网格，支持搜索、常用平台优先及展开全部平台。品牌配置来自共享配置，通过目录接口返回，是否可购买由实际套餐和库存决定。
2. 选择国家：只显示该平台已有套餐配置的国家，无库存不可继续。
3. 号码分配：默认自动分配；美国在有实际区号库存时可选择指定区号。其他国家不增加虚构的城市或区号选项。
4. 服务期限：仅接收短信，前台只展示已有配置中的 7 天或 30 天短期服务，默认数量 1，保留原 1 至 10 的数量限制。价格来自数据库已有配置，未重新定价。
5. 确认创建服务：展示平台、国家、分配方式、服务类型、服务期限、数量、单价、合计、余额及创建服务后的余额，用户确认后才提交。
6. 模拟购买完成：仅在服务端订单返回后展示分配号码、实际到期时间和订单号，可复制号码或进入原有短信中心；明确标记为模拟订单，不宣称可接收真实短信。

支持返回前一步；切换平台或国家清除下游失效选项。草稿按账户保存在同一浏览器标签页的 sessionStorage；网络超时后保留原幂等请求，重试不另建购买意图。订单记录可用于核对不确定结果。

导航移除了按国家划分的主购买入口，采用「购买服务」「我的订单」「短信中心」命名，保留我的号码、积分和账户功能。没有新建与原有号码、短信功能重复的使用页面。

## 4. 数据与服务端约束

- 复用 `GET /api/catalog`、`POST /api/orders`、订单查询、号码查询和短信查询。这些是 LINEPOOL 内部接口，不是 PingCode 的真实地址。
- 目录增加品牌元数据以及每个套餐的美国区号库存；页面不推测区号库存或额外编造可售平台。
- 订单请求可携带内部字段 `areaCode`；共享校验限制为美国三位区号，其他国家不能指定。
- 订单保存所选区号和产品快照；幂等校验包含区号，避免相同请求键切换区号。
- 服务端只销售 7/30 天、`RECEIVE`、不允许续费的现有配置。
- 下单仍在原事务中校验账户、积分和库存；号码行使用 `FOR UPDATE SKIP LOCKED` 防止并发重复分配，积分和账本同步更新。
- 指定区号严格匹配库存；不足返回错误，不回退到其他区号，不完成扣款或半成品订单。
- 继续使用现有号码归属与短信按用户隔离机制，没有新增共享号码复用或改变上游短信路由。未来真实共享模式必须先明确订单、平台、用户和短信的路由规则。
- 新续费方案查询及申请返回 `RENEWAL_DISABLED`；历史申请读取和管理员核对功能保留。

平台 Logo 取自用户提供的 `D:/llinepool/output/platform-logos`，复制到业务资源目录，保留 50 个 SVG、manifest 与来源 README。只有原有实际配置的平台可售，其余品牌显示不可用。

## 5. Mock 与真实业务边界

购买流程、订单和工作台均增加明确的 Mock 提示。当前目录、号码、积分扣减及订单是本地演示流程，尚未接入真实号码服务或真实支付。模拟订单写入本地数据库，不代表真实采购、实际支付或短信可达。

原有「查看用量」继续展示明确标注的 Mock 快照，包括不限量、无套餐、不支持查询和错误状态。语音/流量演示不代表本次产品支持相应业务。

没有修改套餐既有价格、接收次数或号码复用规则。未编造 PingCode URL、字段、鉴权方式或响应格式，也未修改 PingCode、NexSim 或其他上游系统。

## 6. 权限保持不变

- `ADMIN` 可进入普通工作台及独立管理后台；入口只在管理员工作台右上角显示。
- `USER` 只能使用普通业务功能；左侧没有管理后台菜单。
- 未登录不得访问受保护页面。
- 管理 API 继续由 `SessionGuard` 和 `AdminGuard` 校验；页面保护沿用 Vite 与生产 Nginx 的会话校验机制。
- 本轮未改动登录、角色守卫及页面保护代码。生产仍须正确启用 `auth_request`，不能只配置 SPA 静态回退。

## 7. 本轮实际修改文件

下列路径相对根目录；构建产物及本地日志、备份不作为源码改动列入。

| 文件 | 改动 |
| --- | --- |
| `linepool-ui/src/linepool/workspace-reference/PurchasePage.tsx` | 新购买流程、草稿恢复、确认、重试、结果展示 |
| `linepool-ui/src/linepool/workspace-reference/PurchasePage.css` | 平台网格、步骤、响应式与主题样式 |
| `linepool-ui/src/linepool/workspace-reference/WorkspacePages.tsx` | 接入新购买页、移除续费入口、订单信息适配、补充短期服务说明 |
| `linepool-ui/src/linepool/workspace-reference/detail-data.ts` | 地区/订单详情改用服务方案、服务期限和服务号码文案 |
| `linepool-ui/src/linepool/workspace-reference/WorkspaceDetails.tsx` | 统一品牌 Logo、订单区号及 Mock 信息 |
| `linepool-ui/src/linepool/workspace-reference/WorkspaceReferenceShell.tsx` | 导航调整、演示提示，保留管理员专属入口 |
| `linepool-ui/src/linepool/workspace-reference/WorkspaceReferenceShell.css` | 演示环境提示样式 |
| `linepool-ui/src/linepool/workspace-reference/navigation.ts` | 导航及页面标题命名 |
| `linepool-ui/src/linepool/workspace-reference/workspace-data.ts` | 新错误状态中文提示 |
| `linepool-ui/src/linepool/i18n/purchase-messages.ts` | 新购买流程英文文案 |
| `linepool-ui/src/linepool/i18n/messages.ts` | 接入购买文案 |
| `linepool-ui/src/linepool/admin/AdminShell.tsx` | 续费关闭说明，历史核对保留 |
| `linepool-ui/src/linepool/assets/platform-logos/*.svg` | 用户提供的 50 个平台 Logo |
| `linepool-ui/src/linepool/assets/platform-logos/manifest.json` | 保留品牌素材清单 |
| `linepool-ui/src/linepool/assets/platform-logos/README.md` | 保留素材来源说明 |
| `linepool-ui/packages/contracts/src/platform-catalog.ts` | 由素材清单整理的品牌配置 |
| `linepool-ui/packages/contracts/src/index.ts` | 平台、区号库存和订单区号共享契约 |
| `linepool-ui/backend/src/workspace.ts` | 目录与区号库存查询、订单映射 |
| `linepool-ui/backend/src/ordering.ts` | 区号分配、幂等校验、短期接收套餐约束 |
| `linepool-ui/backend/src/number-services.ts` | 服务端关闭续费方案和新申请 |
| `linepool-ui/backend/db/migrations/006_short_term_allocation.sql` | 订单新增可空区号及约束，兼容历史数据 |
| `linepool-ui/backend/db/migrations/007_short_term_offer_names.sql` | 将既有 7/30 天方案名称统一为短期服务，兼容历史目录数据 |
| `linepool-ui/backend/scripts/backup-local-db.mjs` | 本地迁移前备份工具，不连接生产环境 |
| `LINEPOOL-项目总结.md` | 当前产品范围与交接更新 |

## 8. 验证与运行状态

已执行构建、类型检查与上游完整性检查：

- `npm --prefix D:/llinepool/linepool-ui run build` 通过，包含共享契约编译、Vite 前端构建、声明生成和上游完整性校验。
- `npm --prefix D:/llinepool/linepool-ui run typecheck:all` 通过，包含前端、后端、共享契约及测试类型配置检查。
- 上游完整性校验：117 个文件未改变。

遵守 `linepool-ui/AGENTS.md` 保留的「不运行测试」要求，本轮没有执行测试套件、浏览器交互或视觉验收，不能宣称功能验收全部通过。

本地迁移目标已确认是 `127.0.0.1:5433/linepool_react`（开发环境）。迁移前生成完整数据库备份：

`linepool-ui/backend/.local/backups/before-short-term-2026-10-16T03-38-02-799Z.dump`

迁移 `006_short_term_allocation.sql` 已应用；仅追加订单字段和约束，没有重置账户、订单、积分、短信或号码权益。其他环境仍需先备份再运行项目迁移命令。代码回退时可保留新增可空列；如需恢复整库，应在确认期间新增数据的保留边界后操作，不能盲目覆盖。

本地 Vite 保持在 5178 端口运行，API 已重启为本次构建，启动日志无报错。未部署公网或改动生产服务。

仍待功能验收：完整购买、平台切换、自动与指定区号、无库存、套餐切换、价格计算、积分不足、失败及超时重试、重复点击、刷新恢复、移动端、浅深色及管理员/普通用户权限回归。历史权限验证不能代替本轮验收。

## 9. PingCode 待提供能力

1. 正式文档、联调环境、鉴权、稳定资源 ID、错误码、限流及超时语义。
2. 平台与国家可售关系、实际服务能力，以及 7 天/30 天产品标识。
3. 按平台、国家、可选区号和套餐查询可售库存；号码预占、分配和并发规则。
4. 权威报价、价格单位、有效期、积分结算/采购扣款边界；以服务端报价为准。
5. 幂等创建订单、异步受理状态、超时后查单、失败原因，以及完成后号码分配结果。
6. 实际生效时间、到期时间、短信接收资格、接收次数和平台复用规则。
7. 短信按订单/用户/平台的归属关联、唯一消息标识、增量拉取或可信回调、延迟与失败状态。
8. 如需保留真实套餐用量展示，提供总量、已用、剩余、单位、采集时间，以及不限量/无套餐/不支持查询的表达。

当前不需要对接发送或续费 API。前端继续调用既有 LINEPOOL 内部接口，由服务端适配供应商能力；真实数据不得继续标为 Mock，也不得未经确认就改为真实成功。

## 10. 相关文档

- [根目录说明](../../../README.md)
- [应用运行说明](../../../linepool-ui/README.md)
- [生产部署说明](../../../deploy/README.md)
