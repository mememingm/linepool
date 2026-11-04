# LinePool × ONCE 合并 · 执行方案（交给 agent）

编写：2026-11-04
设计依据：[../unified-architecture.md](../unified-architecture.md)（为什么这样设计）。本文件只写**怎么做、能动什么、不能动什么**。

> 给执行者：**一次只执行一个步骤。** 完成后按第 9 节的模板汇报，然后停下，等用户确认后再开始下一步。任何超出本步骤范围的改动，都要先停下来问，不要自行扩大范围。

---

## 1. 已定决策（不要重新讨论）

| # | 决策 |
|---|---|
| D1 | LinePool 和 ONCE 合并成**一个核心后端**，以 LinePool 现有的 NestJS 后端为基础。ONCE 的后端最终停用 |
| D2 | `D:\llinepool` 改成多应用仓库（monorepo）。用户已同意修改 AGENTS.md 中"唯一的 React 应用"这一条 |
| D3 | 号码按 PC 账户划分：**PC 账户 A 只给 LinePool，PC 账户 B 只给 ONCE**。两个门店的号码互不调配，因此不需要跨门店的互斥规则 |
| D4 | 语音（SIP）**不接 LinePool**。电话站是**单独的网站**，也是主业务，作为第三个门店 `phone` 挂在同一个核心后端上（2026-11-04 更新）。ONCE 是否也加语音，以后再定 |
| D5 | 钱包使用**积分**，LinePool 和 ONCE 的 C 端用户共用一套积分钱包 |
| D6 | **不做白标，暂不做开放 API。** 代理的客户继续使用 LinePool 网站；客户归属沿用 `customers.agent_id`（为空表示平台直营）。不新增商户层（tenants），不改邮箱唯一规则。⚠ 2026-11-04：同事提出"每个代理要有自己的域名"，可能推翻这一条，正在确认。在确认之前，S2 不要把门店写死成固定的几个（见 S2） |
| D7 | LinePool 和 ONCE 的 C 端账号共用（同一个 `users` 表） |

## 2. 全局规则（每一步都必须遵守）

**绝对不能做：**
1. 不跑任何测试。包括 `npm test`、ONCE 的 `test:points`、`test:integrations`，以及任何 `*.test.*` 或测试脚本。只允许 build、typecheck、`verify:upstream`、`verify:catalog-upstream`。
2. 不 commit、不 push、不建分支、不改 git 配置，除非用户在对话里明确要求。
3. 不修改 `src/vendor/**`、`public/**`、`upstream-lock.json`、`catalog-upstream-lock.json` 的**内容**。S1 中随目录整体移动是允许的，但内容必须逐字节不变（`verify:upstream` 必须通过）。不重新生成任何 upstream lock。
4. 不接任何真实上游或支付：不接真实 PingCode/PC、SIP、支付渠道，不写入真实密钥。上游一律使用现有或新增的 Mock 实现。
5. 不删除 `D:\once`、`oneoff-sms/`、`webhook-lab/`、`ccam/`、`output/`、`tmp/`、`deploy/` 中的任何东西。也不要去改 `oneoff-sms/`，它是另一个独立实验项目（ONCE V2 共享池），和本次合并无关。
6. 不改 ONCE 前端的视觉风格（保持现在安静的工作台风格），不改 LinePool 的视觉组件。LinePool 的业务代码只能写在 `src/linepool/**`，通过组合方式使用上游组件。
7. 不做"顺手优化"：不重构无关代码，不升级依赖版本，不改格式化配置，不批量改名。
8. 不修改已存在的数据库迁移文件，只新增迁移。迁移编号接在当前最大编号之后（目前最大是 `030`，`027` 本来就缺，不要补）。
9. 只能对本机开发数据库执行数据库迁移，不连接任何远程数据库。

**遇到以下情况，停下来汇报，不要自己决定：**
- 需要改动本步骤"允许改动"以外的文件；
- 发现决策 D1–D7 和代码现状冲突；
- 构建或类型检查失败，且修复需要改业务逻辑；
- 需要删除任何已被 git 跟踪的文件。

## 3. 执行顺序

```
前置（用户做） → S1 目录重组 → S2 门店配置 → S3 统一积分钱包 → S4 迁入 ONCE 功能
             → S5 ONCE 前端切换 → S6 合并运营后台 → （S7 不做） → S8 电话站
             → 收尾清理（需用户批准）
```

S3 和 S4 必须**先写设计说明，等用户批准后再写代码**。

---

## 4. 前置条件（由用户完成，agent 不要代劳）

1. **提交或暂存两个仓库的未提交改动：**
   - `D:\llinepool` 目前有已修改和未跟踪的文件（docs、`messages.ts`、`DashboardOverview.css`、`TrendChart.*` 等）。
   - `D:\once` 有 78 处未提交改动，包括尚未提交的 Prisma 迁移 `202611020001_*`、`202611030001_*`、`202611030002_*`。S1 会从 `D:\once` 复制当前工作区，所以务必先提交，保证 D:\once 留有一份完整、干净的版本。
2. 关闭所有开发服务器和占用这些目录的编辑器窗口（Windows 下目录被占用会导致移动失败）。
3. 确认 Node.js 22.12 及以上。

agent 开工前先检查：`git -C D:\llinepool status` 和 `git -C D:\once status` 都应该是干净的。不干净就停下，告诉用户。

---

## 5. S1 · 目录重组（只移动，不改逻辑）

### 目标结构

```
D:\llinepool
├─ package.json              新增：根工作区
├─ package-lock.json         新增：根目录唯一锁文件
├─ AGENTS.md                 新增：全局规则
├─ apps/
│  ├─ linepool-web/          ← 原 linepool-ui（去掉 backend/ 和 packages/）
│  └─ once-web/              ← 复制自 D:\once（不含 backend/）
├─ services/
│  ├─ core/                  ← 原 linepool-ui/backend（共用核心）
│  └─ once-api-legacy/       ← 复制自 D:\once\backend（过渡期保留，不加入工作区）
├─ packages/
│  └─ contracts/             ← 原 linepool-ui/packages/contracts
└─ deploy/ docs/ oneoff-sms/ webhook-lab/ output/ tmp/ ccam/   原样不动
```

### 具体步骤

1. **记录基线**（改动前做，结果写进汇报）：
   - 在 `linepool-ui/` 执行 `npm ls --depth=0 --workspaces`，保存输出。
   - 执行 `npm run verify:upstream` 和 `npm run verify:catalog-upstream`，确认原本就通过。
2. **用 git 移动 LinePool**（保留历史）：
   - `git mv linepool-ui apps/linepool-web`
   - `git mv apps/linepool-web/backend services/core`
   - `git mv apps/linepool-web/packages/contracts packages/contracts`，并删除空掉的 `apps/linepool-web/packages/` 目录
   - 被忽略的本地文件（如 `backend/.env`、本地数据库目录）会随目录一起移动。移动后确认 `services/core/.env` 仍在；它不会也不应被 git 跟踪。
3. **复制 ONCE**（D:\once 保持原样，只读）：
   - D:\once 根目录下除 `backend/` 以外的内容复制到 `apps/once-web/`；`D:\once\backend` 复制到 `services/once-api-legacy/`。
   - 两处都**排除**：`.git`、`node_modules`、`dist`、`output`、`.pi`、`.playwright-cli`、`.claude`。
   - `.env*` 文件可以复制，用于本地运行，但会被根目录 `.gitignore` 忽略，不要强行加入 git。汇报中列出复制了哪些 `.env*` 文件，并确认里面没有真实密钥；有就停下报告。
   - ONCE 原来的 `package-lock.json` 不再使用（`apps/once-web` 的依赖由根锁文件管理）；`services/once-api-legacy/package-lock.json` 保留，因为它不加入工作区。
4. **建立根工作区**：
   - 新建根 `package.json`：`private: true`、`type: module`、`engines.node >=22.12`；`workspaces` 只包含 `packages/contracts`、`services/core`、`apps/linepool-web`、`apps/once-web`。**不包含** `services/once-api-legacy`，它继续独立安装，避免 Prisma 依赖和核心依赖互相干扰。
   - 把原来 `linepool-ui/package.json` 里**负责多个包协同**的脚本搬到根目录，名字保持不变：`dev:all`、`build:all`、`typecheck:all`、`contracts:*`、`api:*`、`db:*`。路径从 `backend` 改为 `services/core`。
   - `apps/linepool-web/package.json` 只保留前端自己的脚本（`dev`、`build`、`build:web`、`preview`、`typecheck`、`verify:*`），删除它的 `workspaces` 字段。包名 `@linepool/ui-react` 不变。
   - 生成锁文件：先把原来 `linepool-ui/package-lock.json`（已随目录移动到 `apps/linepool-web/`）**复制**到根目录作为起点，在根目录执行 `npm install`（不要用 `npm update`），然后删除 `apps/linepool-web/package-lock.json`。
   - 再执行一次 `npm ls --depth=0 --workspaces`，和第 1 步的基线对比：LinePool 已有依赖的版本不能变。版本变了就停下报告。
   - `apps/once-web` 引入后依赖版本可能和它原锁文件略有差别，在汇报里列出差异即可。
5. **修路径引用**（只改下面这些文件里的路径，不改其他内容）：
   - 根目录 `README.md`、`docs/README.md`、`deploy/README.md`、`deploy/*.example`：`linepool-ui/backend` → `services/core`，`linepool-ui/web-dist` → `apps/linepool-web/web-dist`，`linepool-ui/` 作为安装目录 → 仓库根目录。
   - `apps/linepool-web` 里的 `vite.config.ts`、`tsconfig*.json`、`scripts/*.mjs`：如果引用了 `backend/` 或 `packages/contracts` 的相对路径，改成新位置。
   - `services/core` 里的 `tsconfig.json` 等：如果引用了 `../packages/contracts`，改成新的相对路径。
   - `.claude/launch.json`（如有）里的工作目录。
   - `apps/linepool-web/docs/**` 和其他文档里的链接**不要改**。在汇报中列出失效的链接即可。
6. **AGENTS.md**：
   - `apps/linepool-web/AGENTS.md`（随目录移过来的那份）只改一句："This is the sole React application, with its API in `backend/` and shared contracts in `packages/contracts/`" 改为说明它是 monorepo 中的 LinePool 前端，API 在 `services/core/`，共享契约在 `packages/contracts/`，ONCE 前端在 `apps/once-web/`。其余规则一字不改。
   - 新建根目录 `AGENTS.md`：写入第 2 节的全局规则（精简版），说明目录结构，并指向 `apps/linepool-web/AGENTS.md`。
7. **端口保持不变**：LinePool 前端 5178、核心 API 3010、ONCE 前端 5174、ONCE 旧 API 3000。S1 期间 `apps/once-web` 仍然代理到旧 API（3000）。

### S1 允许改动
- 上面列出的移动和复制；
- 根目录 `package.json`、`package-lock.json`、`AGENTS.md`、`README.md`；
- `docs/README.md`、`deploy/**` 中的路径；
- `apps/linepool-web/package.json`、`apps/linepool-web/AGENTS.md` 中的那一句；
- 第 5 步列出的配置文件中的路径；
- 删除重新生成的构建产物：`node_modules`、`dist`、`web-dist`。

### S1 验收（全部在根目录执行）
1. `npm install` 成功。
2. `npm run build:all` 成功。
3. `npm run typecheck:all` 成功。
4. `npm run verify:upstream --workspace @linepool/ui-react` 和 `verify:catalog-upstream` 通过。
5. `npm run build --workspace once-web` 成功（以 `apps/once-web/package.json` 里的实际包名为准）。
6. `npm --prefix services/once-api-legacy install`，然后执行 `db:generate` 和 `build`，都成功。
7. `git status` 中，LinePool 文件显示为重命名（renamed），而不是删除后新增。
8. `D:\once` 没有任何变化（`git -C D:\once status` 仍然干净）。

---

## 6. S2 · 门店配置

**目标：** 核心知道有 LinePool 和 ONCE 两个门店，以及每个门店对应哪个 PC 账户。**LinePool 现有行为完全不变。**

**允许改动：** `services/core/db/migrations/031_*.sql`（新增）、`services/core/src/**` 中与门店和上游账户相关的新文件，以及少量装配代码、`packages/contracts/src/**`（新增类型）、`services/core/.env.example`。

**做法：**
1. 新增迁移：
   - `storefronts` 表：`id`（文本主键，**不要用 CHECK 限定成只有两个值**，以后还会有 `phone` 门店，可能还有代理自己的门店）、`name`、`product`（`SMS_CODE`、`NUMBER_LEASE`、`VOICE`）、`voice_enabled`（默认 false）、`created_at`。只写入 `linepool` 和 `once` 两条初始数据。
   - `upstream_accounts` 表：`id`、`provider`、`external_account_id`、`storefront_id`（外键）、`status`、`created_at`，`(provider, external_account_id)` 唯一。**不存密钥**，密钥仍然放在环境变量里。
   - `phone_numbers` 增加 `storefront_id`（非空，默认 `'linepool'`，现有数据全部归 LinePool）。如有必要，再增加可空的 `upstream_account_id`。
2. 环境变量：LinePool 现有的 PingCode 变量名保持不变，视为"LinePool 门店的账户 A"。在 `.env.example` 里为 ONCE 预留一组变量名，只写占位符。
3. 号码同步（`provider-sync` 等）在写入号码时带上门店。只给 Mock 实现加这个参数，不碰真实对接。
4. 在 contracts 中新增 `StorefrontId` 等类型。

**不做：** 不改登录和会话，不改价格，不改前端，不新增 tenants 表（D6）。

**验收：** 在本地数据库执行 `db:migrate` 成功，`build:all` 和 `typecheck:all` 成功；LinePool 现有的接口和页面不需要任何改动。

---

## 7. S3 · 统一积分钱包（先出设计说明，批准后再写代码）

**第一阶段只写文档：** `docs/design/s3-points-wallet.md`，写完停下，等用户批准。设计说明要包含：

1. **现状盘点：**
   - LinePool：`users.points_balance`、`point_ledger`、`balance_accounts` / `balance_ledger`（代理和客户的币种余额，用于结算）。
   - ONCE：`PointAccount`、`PointLot`、`PointLedger`、`PointReservation`、`PointAllocation`、`RechargeOrder`、`RefundOrder`（在 `services/once-api-legacy/prisma/schema.prisma`）。
   - 列出每处读写这些表的代码位置。
2. **目标模型：** C 端用户一套积分钱包，具备以下语义：
   - 冻结 → 扣除 / 解冻 → 退款；
   - 用业务 ID 保证幂等；
   - 流水只追加不修改，并记录变动后的余额；
   - 是否保留 ONCE 的"积分批次（lot）"：需要说明理由，以及对退款的影响。
3. **代理结算余额**（`balance_accounts`）：建议保持不变，单独列为"需要用户确认"的问题，也就是代理的余额是否也改成积分。
4. LinePool 现有的扣积分流程（下单、续费失败退回等）怎么迁到新钱包；旧的 `users.points_balance` 和 `point_ledger` 怎么处理。现在没有生产数据，可以直接转换。
5. 新增的迁移清单和接口变化清单。

**第二阶段（批准后）：** 按设计实现。允许改动 `services/core/**`、`packages/contracts/**`，以及 `apps/linepool-web/src/linepool/**` 中显示积分的部分（只限接口适配）。

**验收：** `db:migrate`、`build:all`、`typecheck:all` 成功；在汇报中逐条说明 LinePool 原有积分流程对应到新钱包的位置。

---

## 8. 后续步骤

### S4 · 迁入 ONCE 功能（先出设计说明，批准后再写代码）
- **设计说明：** `docs/design/s4-once-in-core.md`。逐个对照 `services/once-api-legacy/src/**` 的功能，说明它在核心里的落点：
  - 整号租约（Lease）：租期价格改为后台可配置，不要写死 7 天 $12、30 天 $35；
  - 收信归属：按租约时间窗口判断归谁；
  - 发短信（OutboundMessage）：带幂等键，并跟踪状态；
  - 充值和退款订单：使用 Mock 支付；
  - 管理端接口、Webhook 收件箱。
- **接口原则：** 尽量保持 ONCE 现有接口的路径和数据结构（见 `services/once-api-legacy/API.md`），以减少 S5 的前端改动。必须有差异的地方，在设计说明里列成表。
- **只对 `storefront = 'once'` 的号码生效。** 上游一律使用 Mock（PC 账户 B）。
- ONCE 的 `pingcode.client` 和 `payment.gateway` **不复制**，统一复用核心已有的上游层，或在核心中新增 Mock。
- **不做：** 不删除 `services/once-api-legacy`，不改 `apps/once-web`。

### S5 · ONCE 前端切换到核心
- **允许改动：** `apps/once-web/src/lib/api.ts` 和相关的数据请求代码、`apps/once-web/vite.config.ts` 的代理目标（3000 → 3010）、`apps/once-web/package.json`（引入 `@linepool/contracts`）。
- **不做：**
  - 不改页面布局、样式和文案（保持安静风格）；
  - `apps/once-web/src/admin/**` 先不动；
  - 不删除 `services/once-api-legacy`。
- **验收：** `build --workspace once-web` 成功；在汇报中列出每个页面用到的接口，以及它们对应的核心接口。

### S6 · 合并运营后台
- 在 LinePool 管理后台（`apps/linepool-web/src/linepool/admin/**`）加入 ONCE 的运营功能：套餐和价格、租约、发信记录、充值和退款。号码、短信、订单列表增加按门店筛选。
- 遵守 `apps/linepool-web/AGENTS.md`：只能用组合方式和上游组件现有的属性，不改上游组件。
- **不做：** 不删除 `apps/once-web/src/admin/**`。是否删除由用户在收尾时决定。

### S7 · 不做
对应决策 D6。

### S8 · 电话站（单独网站，主业务）
- 新建 `apps/phone-web`，作为门店 `phone` 挂在核心后端上，和 LinePool、ONCE 共用账号、积分钱包和运营后台。不另起后端。
- 计费和拨号设计按 `D:\phone\DESIGN.md`：美国区号白名单、6+6 计费、最低 $0.07/分钟、先冻结后结算。
- 上游先用 Mock 的 VoiceProvider。同事的 SIP 就绪后再接真实上游，接入需要用户授权。
- 开始前，单独写一份设计说明交用户批准。
- 前端界面不受 LinePool vendor 规则约束，按 `D:\phone\DESIGN.md` 的技术栈来做（Tailwind + shadcn/ui）。

### 收尾清理（必须有用户的明确批准）
- 删除 `services/once-api-legacy`、`apps/once-web/src/admin`（如果已由 S6 替代），以及移动后残留的空目录。
- 修复 S1 中列出的失效文档链接。

---

## 9. 汇报模板（每一步结束时按这个格式回复）

```
## SX 完成情况
- 结果：完成 / 部分完成 / 停下等待确认
- 改动的文件：（按 新增 / 修改 / 移动 / 删除 分组列出）
- 执行过的检查及结果：（命令 + 通过 / 失败；失败时附关键输出）
- 没做的事及原因：
- 发现的问题或需要用户决定的事：
- 和本方案不一致的地方：（没有就写"无"）
```

## 10. 给 agent 的开场提示词（复制使用，把 SX 换成具体步骤）

```
请阅读 D:\llinepool\docs\handoff\lp-once-unification-plan.md，只执行其中的 SX。
严格遵守第 2 节全局规则和 SX 的"允许改动"范围：不跑测试，不 commit，不接真实上游或支付，不改 vendor/public/upstream-lock 的内容。
需要超出范围时先停下问我。完成后按第 9 节模板汇报，然后停下。
```
