# LinePool × ONCE v4.2 本轮状态总结

日期：2026-11-07。执行者：`llinepool-28552`。对应记录：`RUN-20261107-llinepool-28552-02`。

本文是本轮冻结快照；[总执行文档](lp-once-v41-master-plan.md)继续作为唯一持续维护的决定、授权与验收入口。后续接手见[下一 Agent 交接](v42-next-agent-handoff-20261107.md)。旧[RUN-07 后摘要](v42-r5-summary-and-handoff.md)保留历史用途，其中“优先补 A19”的指令已过时，不能据此重做。

## 1. 当前结论

两站的主要业务模块已有源码实现和本机 Mock 场景证据，但不能宣称所有网站功能齐全或已具备真实营业条件。

- LP、ONCE 共用核心源码，各自运行 API、worker，使用独立逻辑数据库、角色、用户、会话和资金。共用 PostgreSQL 服务和机器资源不等于故障、性能完全隔离。
- LP 自营按平台接码；ONCE 自营整号租赁、续租、到期保留/再激活、聊天与收发短信已有实现。两站代理只管理自己的 PC 连接、号码、能力、套餐和验证码，自行销售和收款。
- 已有两站分页失败/完整恢复 A19、本批 ONCE 历史导入、资金/期间/映射核对、零写入重放和旧普通账号接入证据；本轮未重做。
- 本轮只实施 ONCE 密码表单规则调整，补充入口说明和交接。其余五处静态前端缺口尚未修复；真实 PC、真实收款、完整页面验收、容量、正式发布及恢复仍有待办。

## 2. 本轮已完成的密码修改

用户要求将 ONCE 最低密码长度从 12 改为 8。前端现在复用共享 `passwordSchema`，规则为 **8–72 个字符，且 UTF-8 编码最多 72 字节**。不新增复杂度条件，不裁剪或转换密码。

| 文件 | 覆盖内容 |
| --- | --- |
| [PublicPages.tsx](../../apps/once-web/src/pages/PublicPages.tsx) | 登录、注册、确认密码、邮件链接重置密码；HTML 限制、提示和提交校验一致 |
| [PasswordSettings.tsx](../../apps/once-web/src/components/PasswordSettings.tsx) | 账户设置中当前密码、新密码及确认密码；保留原有一致性、新旧密码不同的规则 |
| [admin/actions.tsx](../../apps/once-web/src/admin/actions.tsx) | 管理员重置普通用户密码的输入和提交校验 |
| [admin/mock.ts](../../apps/once-web/src/admin/mock.ts) | 显式后台演示模式使用同一规则；不作为正式请求失败后的回退 |
| [ONCE README](../../apps/once-web/README.md) | 密码规则、代理/管理员入口和身份边界说明 |

后端和共享契约规则本来就是上述范围，本轮没有修改。现有账号、管理员邮箱、已保存密码和会话没有通过本轮脚本重置；“最低 8 位”不表示已替用户把现有密码改成 8 位。

## 3. 实际检查及边界

1. 仓库根目录执行 `npm.cmd run build --workspace once-web`，退出 0；脚本先运行 `tsc --noEmit`，再完成 Vite 生产构建，产物为 `apps/once-web/dist/`。
2. 构建输出含 Zod 注释标记解释警告和大于 500 kB 的 chunk 警告；构建成功。本轮未为这些警告改依赖、拆包或扩展范围。
3. 从现有 ONCE Vite 服务只读获取四个更新模块：`PublicPages.tsx`、`PasswordSettings.tsx`、`admin/actions.tsx`、`admin/mock.ts`，均 HTTP 200、`text/javascript`，均包含共享密码校验及更新提示。实际交付的密码输入 `minLength` 为 8、`maxLength` 为 72；邮箱、备注字段保留各自上限。
4. LP `3010/api/health` 和 ONCE `3011/api/health` 均 HTTP 200，返回 `status=ok`、`database=ok`、`mode=demo`。
5. 六个留用服务的 proc 状态均为 ready、persistent，未重启或停止。ONCE Vite 日志已记录本次模块 HMR。

以上证明本次构建和现有服务模块交付；不等于浏览器表单交互、注册/改密提交或完整 A15 页面流程已通过。遵守原页面观察取消及测试禁令：未运行浏览器、测试套件或测试脚本，未提交登录、注册、密码修改/重置、充值、订单或短信请求。未执行迁移、seed、导入、真实供应商、容量负载、正式发布、退役/删除或 Git 操作。

## 4. 静态核对后仍未修复的五处前端缺口

以下源码接线或覆盖问题已核对；运行时影响属于 **[INFERENCE] 静态推断**，本轮未运行页面复现。密码规则不一致已由第 2 节修复，不再计为待修项。

| 待办 | 证据及影响 |
| --- | --- |
| LP 普通用户取码等待 | [WorkspacePages.tsx](../../apps/linepool-web/src/linepool/workspace-reference/WorkspacePages.tsx) 的收件箱只刷新本地查询；[pc/connections.ts](../../services/core/src/pc/connections.ts) 的等待服务只接受 PinClode 代理。普通自营用户没有等待登记/worker 提频入口；代理已有该能力。不能把已有代理 A18 证据扩展成普通用户已覆盖 |
| LP 订单详情状态 | [OrderSheet.tsx](../../apps/linepool-web/src/linepool/workspace-reference/OrderSheet.tsx) 获取最新详情，但状态徽标仍使用所选列表对象；订单异步完成后可能显示旧状态 |
| ONCE 较早订单退积分入口 | [admin/pages/PointsPage.tsx](../../apps/once-web/src/admin/pages/PointsPage.tsx) 只取用户最近 50 笔订单，退分列表无订单分页；底部分页控制的是流水。后端已有消费退积分接口，更早可退订单缺页面选择入口 |
| ONCE 后台订单状态筛选 | [AdminShell.tsx](../../apps/once-web/src/admin/AdminShell.tsx) 仍提供 `DEMO_CONFIRMED`，后端 [admin-views.ts](../../services/core/src/once/admin-views.ts) 使用实际履约状态，成功为 `COMPLETED`，旧选项没有正确适配 |
| ONCE 套餐操作日志筛选 | 同一后台使用 `PLAN_CREATE/PLAN_UPDATE`，实际 [lease-plans.ts](../../services/core/src/once/lease-plans.ts) 保存 `ONCE_PLAN_SAVE`；应保留必要历史查询，同时补实际事件筛选 |

本次没有发现租号、续租、聊天、代理工作台等整块主模块缺失；也没有据静态覆盖作全功能保证。ONCE 邮箱/联系电话编辑入口未完整开放属于另一个已观察的覆盖边界，总文档未逐字段列为一期必做，不自动新增需求。

## 5. 真实营业前的剩余事项

- **真实 PC**：当前授权、续期和 worker 仍使用 Mock；已有响应解析封装不包含真实 HTTP transport。需要官方契约确认及正式适配，涵盖可信身份、应用/回调、号码/消息/发信、限频和 refresh 期限。当前填写应用 ID 不会自动接通。
- **真实收款**：LP 充值返回 `not_connected`，ONCE 付款仅为本地 Mock；积分钱包和幂等入账已有基础，正式收款确认、对账和可操作入口尚需落实。后台“补偿积分”不等于确认收到现金。平台仍不经手代理销售款。
- **密码找回邮件**：[password-recovery.ts](../../services/core/src/password-recovery.ts) 已实现 Nodemailer SMTP，不缺整套邮件代码；剩正式配置和真实送达验证。本轮没有发邮件。
- **正式部署和数据**：已有 [Linux 模板](../../deploy/README.md)，正式主机、域名/HTTPS、独立正式库/角色、管理员、目录价格、配置及数据范围尚需落地。现有迁移入口限制本机数据库地址，不能把云数据库部署理解成直接照搬迁移命令。
- **A15/A21/A20**：完整页面观察未完成且原取消边界保留；A21 在计时前因本机可用内存不足触发止损，八单元未测，仍暂停，无容量结论；正式分站发布、上一版本与数据库兼容性及实际恢复尚未执行。

两站自营上游账号/可售号码范围需要持续不重叠；号码转站应先停止原站新分配并处理现有占用，再交接，避免旧缓存仍可售。不建设跨库事务或跨站库存协调器。

## 6. ONCE 代理和管理员入口

| 用途 | 本机路径 | 说明 |
| --- | --- | --- |
| 代理工作台 | <http://127.0.0.1:5174/agent> | 登录页也有“使用 PinClode 登录代理工作台”；可信代理身份进入本连接号码、能力、套餐、消息/验证码和等待取码 |
| 管理概览 | <http://127.0.0.1:5174/admin/overview> | 已有本机管理员邮箱 `ops@once.local`；管理员也可从用户工作台右上角账户菜单进入。密码不写入本文 |
| 管理员短信记录 | <http://127.0.0.1:5174/admin/messages> | 当前查询范围是本站自营租约的收发短信，不是任意代理连接的全部消息 |
| 连接与同步 | <http://127.0.0.1:5174/admin/integrations> | 查看本站自营与代理连接状态、自营授权、后台同步 |

普通用户导航不显示管理后台。站内邮箱账号和管理员不是代理身份；管理员访问 `/agent` 会得到切换身份提示。可用不同浏览器或隐身窗口分别体验，避免同一站点 Cookie 被另一身份替换。当前代理授权为本地 Mock，平台不提供代理买家站内购买、代收、分账或自动转发。

## 7. 留用服务快照

下列为本轮实际读取的 proc 状态，均 ready、persistent；PID 只作快照，后续操作前应重新核对进程身份。

| 服务 | proc 记录 PID | 启动日志中的 core PID | 入口/角色 |
| --- | --- | --- | --- |
| `LinePoolWeb28552` | 24656 | — | LP Vite 5178 |
| `OnceWeb28552` | 38988 | — | ONCE Vite 5174 |
| `LinePoolApi28552` | 36168 | 39688 | LP API 3010 |
| `OnceApi28552` | 9040 | 4372 | ONCE API 3011 |
| `LinePoolWorker28552` | 37200 | 35788 | LP worker，SMS_CODE |
| `OnceWorker28552` | 39404 | 22952 | ONCE worker，NUMBER_LEASE |

数据库配置沿 `RUN-20261107-llinepool-28552-01`：`127.0.0.1:5433` 的 `linepool_v42_sandbox/lp_v42_app` 与 `once_v42_sandbox/once_v42_app`，私有应用配置位于 `services/core/.local/r5-20261106-16872/lp-app.env`、`once-app.env`。本轮只观察健康接口，未重新查询数据库身份、余额或历史计数；本轮没有停用既有正常 worker，其日常后台工作继续运行。容量库与夹具不启动。
