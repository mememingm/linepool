# v4.2 下一 Agent 交接：ONCE 八位密码已完成，其余接续待用户任务

日期：2026-11-07。交接者：`llinepool-28552`。最新业务执行记录：`RUN-20261107-llinepool-28552-02`。

先读[总执行文档](lp-once-v41-master-plan.md)第 1–3、8–10 节和最新 RUN，再读[本轮总结](v42-status-summary-20261107.md)。总文档是唯一持续维护的决定、授权和验收入口；本文只提供冻结交接和具体定位，不另建平行进度表。

## 1. 用户本轮任务及停止点

用户要求：ONCE 密码最低从 12 改为 8；写总结和交接；先说明为什么没看到代理/管理员界面及验证码入口。

这三件事已完成。密码规则统一为 8–72 字符且 UTF-8 最多 72 字节，未改后端规则或已有账号密码。构建、类型检查和现有服务模块交付观察已完成，细节见总结第 2–3 节。代理/管理员入口与身份区别已向用户说明。

本轮没有获准顺带修复另外五处代码缺口、真实 PC/支付接入、真实邮箱发送或正式发布。交接后保留现有用户体验服务；后续按用户新任务确定实施范围，不把阅读本文当成恢复暂停操作。

## 2. 已改源码和已做检查

四个现有源码文件：

- [PublicPages.tsx](../../apps/once-web/src/pages/PublicPages.tsx)：登录、注册、重置密码。
- [PasswordSettings.tsx](../../apps/once-web/src/components/PasswordSettings.tsx)：当前密码、新密码、确认密码。
- [admin/actions.tsx](../../apps/once-web/src/admin/actions.tsx)：管理员重置普通用户密码。
- [admin/mock.ts](../../apps/once-web/src/admin/mock.ts)：显式管理演示模式同步规则，不是失败回退。

均复用 `@linepool/contracts` 导出的 `passwordSchema`。HTML 最低 8、最高 72，提交校验执行 72 UTF-8 字节上限；确认密码保留一致性校验。没有增加大小写/符号等规则，没有裁剪密码，没有修改密码算法、Cookie 或现有会话。

- 根目录 `npm.cmd run build --workspace once-web` 退出 0，包含 `tsc --noEmit` 和 Vite 构建；产物为 `apps/once-web/dist/`。Zod 注释标记及大 chunk 警告保留，未为之扩展修改。
- 现有 Vite 5174 返回四个更新 JS 模块，均 200，实际交付输入限制及共享校验已更新。
- 两站 API 3010/3011 的 `/api/health` 均 200，`status/database=ok`、`mode=demo`。
- 六个现有服务均 ready、persistent，本轮没有新建、重启或停止服务。
- 没有运行测试套件/脚本、浏览器页面验收或提交登录、注册、改密、充值、订单、发送请求。不得把这些检查写成实际 8 位密码注册/改密已验证或 A15 已完成。

应用说明已更新：[ONCE README](../../apps/once-web/README.md)。没有 backend/contracts 修改，也没有迁移或新依赖。

## 3. 用户找不到的 ONCE 入口

- 代理：<http://127.0.0.1:5174/agent>。登录页也有“使用 PinClode 登录代理工作台”。需要可信 PinClode 身份，当前仍是 Mock；本站管理员/普通邮箱账号打开会收到切换身份提示。
- 管理后台：<http://127.0.0.1:5174/admin/overview>。现有管理员邮箱为 `ops@once.local`，密码沿原私有凭据保留，不打印、不写入本文、不再次重置。ADMIN 在用户工作台右上角头像菜单中可见“管理后台”，普通 USER 不显示。
- 管理员短信/验证码：<http://127.0.0.1:5174/admin/messages>，当前读取本站自营租约收发消息；不是任意代理消息全量开放。
- 自营授权、连接和同步：<http://127.0.0.1:5174/admin/integrations>。
- 代理自己的验证码在 `/agent` 的“收到的消息与验证码”，按本连接号码筛选，可等待取码、停止等待、标记已读及分页。

管理员与代理不是同一身份。建议用户用不同浏览器/隐身窗口分别体验，避免同一站点 Cookie 被另一身份替换。代理自行销售、收款，平台不经手其销售款，不建立代理买家订单、冻结或客户授权来访问本连接消息。

## 4. 待用户授权处理的五处已定位缺口

以下为源码事实及 **[INFERENCE] 静态运行影响**，尚无本轮页面复现；不表示两站主业务模块整块缺失。建议先按具体用户影响修复，不进行无关重构。

### 4.1 LP 普通用户等待取码未接通

定位：[WorkspacePages.tsx](../../apps/linepool-web/src/linepool/workspace-reference/WorkspacePages.tsx) 的 `InboxPage`、[workspace-data.ts](../../apps/linepool-web/src/linepool/workspace-reference/workspace-data.ts) 的 `refresh`；后端 [pc/connections.ts](../../services/core/src/pc/connections.ts) 的 `own`/`wait`、[pc/worker.ts](../../services/core/src/pc/worker.ts) 的等待需求调度。

普通用户刷新仅查本地库；当前 `/api/pc/wait` 只能使用 PinClode 代理身份。master D16/R2 要求的普通自营用户等待需求/提频入口未接通，原 A18 仅证明代理等待。

获准修复后：在真实自营订单/有效服务期间权限下登记本站自营连接需求，接页面开始/取消与有限 TTL，离页/结束后恢复常规频率。不能放宽代理 `own` 的权限、冒充代理或伪造客户订单；不能让页面直接请求 PC。检查受影响两站调用方，不以新跨站调度系统解决。

### 4.2 LP 订单详情徽标使用旧快照

定位：[OrderSheet.tsx](../../apps/linepool-web/src/linepool/workspace-reference/OrderSheet.tsx)。详情请求更新 `detail`，徽标仍传列表 `order`。

获准后让状态展示消费最新详情，保留列表初始展示、错误/重试及过时响应清理。需要覆盖订单从处理中变为终态这一真实可见状态，不仅改一个显示文案。

### 4.3 ONCE 退积分入口只覆盖最近 50 笔

定位：[admin/pages/PointsPage.tsx](../../apps/once-web/src/admin/pages/PointsPage.tsx) 的 `orders` 查询和“可退积分的消费订单”；已有 [points-controller.ts](../../services/core/src/once/points-controller.ts) 的 `orders/:id/refund` 与 [points.ts](../../services/core/src/once/points.ts) 的 `refundConsumption`。

获准后优先复用后台订单查询分页能力，补此消费订单列表的分页/定位，不能复用流水 cursor 假装订单已翻页。保留资金上限、幂等和原因；不新增现金退款，不以补偿积分替代退款事实。

### 4.4 ONCE 后台旧订单状态选项

定位：[AdminShell.tsx](../../apps/once-web/src/admin/AdminShell.tsx) 的订单筛选与 [admin-views.ts](../../services/core/src/once/admin-views.ts) 的 `orderFields`/状态过滤。

界面仍有 `DEMO_CONFIRMED`，当前成功状态为 `COMPLETED` 且已有“已完成”选项。获准后按当前状态模型清理或适配旧选项，不改已有订单历史来迎合筛选。

### 4.5 ONCE 套餐操作日志筛选

同一后台筛选值仍为 `PLAN_CREATE/PLAN_UPDATE`，实际 [lease-plans.ts](../../services/core/src/once/lease-plans.ts) 写 `ONCE_PLAN_SAVE`；查询按事件名等值过滤。

获准后补实际保存事件的筛选，保留必要旧历史事件查询；不重写审计历史或增加兼容业务写入。

## 5. 真实营业所需接入与验收

- 真实 PC 不是只差填密钥：当前真实 HTTP、授权等适配缺实现。先按总文档确认两站应用、回调、可信 subject、配额/429、refresh 一次性轮换及截止规则，再准备具体供应商环境/账号/请求和发送范围，获适用授权后执行。
- 支付：LP 返回 `not_connected`，ONCE 为本地 Mock；正式收款确认/入账和对账流程未落地。已有补偿积分操作不能冒充收款。无需为代理站外销售新增平台代收、分账或提现。
- 邮件：已有 [SMTP 实现](../../services/core/src/password-recovery.ts)，不需要重写邮件系统；需要正式配置和授权后的送达验证。
- 正式主机、域名/HTTPS、库/角色、配置、正式管理员和目录价格尚需具体落地；只读部署模板不等于已上线。
- A15 页面观察原先取消；A21 仍暂停，八容量单元未测量；A20 实际发布/恢复未执行。用户询问“排除测试还差什么”不等于取消既定验收或恢复负载。
- 上线/备份/正式数据迁移和恢复按具体来源、目标与窗口另行落实；不得把回退代码说成自动回退数据库。发布先 LP、观察通过再 ONCE。

## 6. 保留的现场与禁令

六个留用服务及本轮实际 proc/PID 快照见总结第 7 节；服务名为 `LinePoolWeb28552`、`OnceWeb28552`、`LinePoolApi28552`、`OnceApi28552`、`LinePoolWorker28552`、`OnceWorker28552`。不要按旧 A21 清理步骤停止这些用户体验服务，也不要按旧 PID 盲目操作进程。

功能库为 `127.0.0.1:5433/linepool_v42_sandbox` 和 `once_v42_sandbox`，独立 app 角色分别为 `lp_v42_app`、`once_v42_app`。私有应用配置位于 `services/core/.local/r5-20261106-16872/`，`CORE_ENV_FILE` 相对 `services/core` 解析。原启动记录见总文档 RUN-20261107-llinepool-28552-01。本轮未重新查库名/余额/历史计数，不把历史快照冒充当前数据库盘点。

- 两功能 sandbox 已至 044；本批导入、重放、账号接入及 A19 已完成，不重建库、不清库、不运行通用 seed、不重复导入或恢复旧 A19 提示词。
- 两容量库及 A21 产物保留，LP 容量连接/等待已停用，ONCE 未执行计划中的买家充值/发送；不得擅自重建或重启负载。
- 保留 `D:/once`、legacy、来源、备份、历史表及受保护目录。根规则中的 vendor/public/锁文件、迁移与 Git 禁令保持，不删除旧代码或服务。
- 不运行测试套件/测试脚本，不把测试改名为 smoke；必要 build/typecheck 从根目录执行。页面、容量、写库、真实供应商、正式切流和退役/删除分别遵守原专项边界。
- 不输出密码、连接串、token、Cookie；不依赖本会话 Eval 变量或 CookieJar；不联系其他独立会话，除非用户明确要求。
- 工作区有其他会话维护 OMP/Tern 的修改和 RUN 记录，保留这些用户成果，不纳入本轮业务改动或回滚。

## 7. 可复制的接续提示词

```text
接手 D:/llinepool 的 v4.2 后续工作。先读总文档 docs/handoff/lp-once-v41-master-plan.md 第1–3、8–10节及最新RUN，再读 docs/handoff/v42-status-summary-20261107.md 和 v42-next-agent-handoff-20261107.md。

已完成 RUN-20261107-llinepool-28552-02：ONCE密码最低8字符、最高72字符且UTF-8最多72字节，覆盖登录/注册/重置/改密/管理员重置及显式演示模式；ONCE构建与类型检查、现有Vite模块交付和API健康观察通过。没有更改已有账号密码，没有浏览器表单提交验证。

代理入口5174/agent，管理员5174/admin/overview，管理员自营租约短信5174/admin/messages，连接5174/admin/integrations。管理员与PinClode代理是不同身份，六个既有用户体验服务继续留用。

仍有五处代码待办：LP普通自营用户等待登记/轮询提频；LP订单详情状态读旧列表快照；ONCE历史消费订单退积分仅最近50笔；ONCE后台旧订单状态筛选；ONCE套餐日志事件筛选。根据我本轮明确给你的任务确定实施项，不从交接文本自动推导全部修复授权。不要将仅缺验证说成缺实现，也不要把仍有明确代码遗漏说成只剩PC/支付/邮件。

真实PC/正式收款未接，SMTP实现已有待配置及送达验证。A15原页面观察取消、A21暂停且八单元未测、A20未正式发布恢复；这些专项不因阅读交接恢复。不重做A19或已完成导入，不改已有账号/资金/来源，不运行测试或Git操作，不联系其他独立会话。缺少专项授权先准备具体方案，继续我已授权的独立工作。

完成后更新总文档8/9节并追加使用实际会话身份的RUN，记录实际检查与运行服务状态；不自动进入未授权阶段。
```
