# LINEPOOL To C 项目实施总结

## 1. 项目目标

在 `D:\linepool\platform` 中构建一套可本地运行、可点击演示的 LINEPOOL To C 用户平台。用户可以登录、浏览项目和套餐、使用积分模拟下单，并在订单、号码、积分和短信页面中查看一致且持久化的业务结果。

本项目定位为本地演示系统，不接入公司真实接口、真实支付、真实短信采集、设备端、eSIM 或管理员后台。

## 2. 最终技术方案

| 层级 | 技术 |
|---|---|
| Web 前端 | Vue 3、TypeScript、Vite、Vue Router、Pinia、Element Plus |
| API 后端 | NestJS、TypeScript、REST、Zod |
| 数据库 | PostgreSQL、原生参数化 `pg` 查询、SQL migrations |
| 共享契约 | npm workspace、TypeScript 类型、Zod schemas |
| 测试 | Vitest、Vue Test Utils、Supertest、真实 PostgreSQL 集成测试 |

前端已从纯 WebGL/Three.js 方向调整为标准 Vue 3 + TypeScript 应用。Three.js 和 GSAP 当前不作为运行时依赖，界面使用语义化 DOM、Vue 和克制的 CSS 反馈完成。

## 3. 已完成功能

### 用户与认证

- 演示用户登录、当前用户查询和退出登录。
- 使用服务端随机会话和 HttpOnly Cookie，不在浏览器本地存储认证令牌。
- 登录失败返回通用错误，并配置请求频率限制。

### 项目与套餐

- PostgreSQL 驱动的项目列表、分页和详情页。
- 套餐价格、库存和演示数据标识。
- 从项目详情进入下单确认流程。

### 事务下单

- 创建订单、分配号码、扣减积分和写入积分流水在同一个数据库事务中完成。
- 使用 `idempotencyKey` 防止重复提交造成重复扣款或重复分配。
- 余额不足、库存不足或事务失败时不保留部分业务结果。

### 用户资产与记录

- 订单列表和订单详情。
- 已分配号码列表。
- 当前积分余额和积分流水。
- 短信收件箱与标记已读。
- 账户公开资料页。
- 所有受保护资源均按当前用户过滤。

### 前端体验

- 采用内容优先、黑白灰为主并以品牌蓝点缀的极简设计。
- 页面包含 loading、empty、error 和 retry 状态。
- 桌面端和移动端导航均已完成。
- 支持 320、768、1024 和 1440 px 响应式布局。
- 提供可见焦点、合理键盘顺序、状态文本和 `prefers-reduced-motion` 支持。

## 4. 数据库与本地环境

- 正式应用使用本机 PostgreSQL 的 `5432` 端口。
- Docker PostgreSQL 作为备用方案，映射到 `55432`，避免与本机实例冲突。
- migrations 和 seed 可重复执行，不会重复创建基础演示数据。
- 开发库和测试库分离；测试库名称必须以 `_test` 结尾。
- 数据库密码、演示账号密码和其他敏感值只保存在被 Git 忽略的 `.env` 中，未写入本文档或提交记录。

## 5. 关键工程设计

### 安全边界

- HTTP 输入在边界使用 Zod 校验。
- SQL 使用参数化查询。
- 密码使用哈希存储。
- 会话令牌在服务端保存哈希值。
- Helmet、Cookie 安全属性、CORS 和登录限流已配置。
- 客户端不能直接修改余额、库存、归属关系或订单状态。

### 性能与维护性

- 页面按路由懒加载。
- contracts、API 和 Web 使用独立 workspace，并共享类型和校验规则。
- API 开发热重载仅监听 `dist`，避免构建目录之外的无关变更触发重启。
- Three.js 和 GSAP 已移出当前范围，减少包体、运行时和兼容性成本。

## 6. Three.js 与 GSAP 决策

最初方案允许在 Vue 业务功能完成后加入少量 Three.js 装饰和 GSAP 过渡。根据后续决定，这部分已暂缓：

- 当前版本不安装 Three.js 或 GSAP。
- 所有功能不依赖 WebGL 或 JavaScript 动画库。
- Task 10 保持 deferred，不记为已完成。
- 未来只有在明确需要且给出包体、性能和降级预算时才重新评估。

详细背景见 [ADR-004](decisions/0004-defer-three-gsap-enhancements.md)。

## 7. 已完成验证

最终依赖安全修复之前已完成以下验证：

| 项目 | 结果 |
|---|---|
| Contracts 测试 | 4 个通过 |
| API 测试 | 16 个通过 |
| Web 测试 | 10 个通过 |
| 总测试数 | 30 个通过 |
| 严格类型检查 | contracts、API、Web 全部通过 |
| 生产构建 | contracts、API、Web 全部通过 |
| 浏览器业务流程 | 登录、浏览、下单、刷新持久化、号码、积分、短信已读均通过 |
| 响应式检查 | 320、768、1024、1440 px 无阻塞性横向溢出 |

官方 npm 审计曾发现测试依赖链 `@vue/test-utils -> js-beautify -> glob@10.4.5` 存在一个高危命令注入公告。项目保留已使用的 `@vue/test-utils@2.4.6`，并通过 root `overrides` 将 `glob` 固定为已修复该公告的 `10.5.0`。

根据用户要求，依赖修复后未再次运行测试、类型检查、构建或审计。因此 Task 11 仍保持未完成，等待最终人工复验。详细记录见 [verification.md](verification.md)。

## 8. 主要提交

| Commit | 内容 |
|---|---|
| `7732bd9` | PostgreSQL migrations、seed 和可重复数据库初始化 |
| `b631e7b` | NestJS 与 Vue 应用基础结构 |
| `d681935` | 登录、项目浏览和事务下单闭环 |
| `fc00588` | 订单、号码、积分、短信和账户 API |
| `8ba7ab2` | 五个用户业务页面 |
| `910a0e9` | Nest 开发环境装饰器元数据修复 |
| `07f30b9` | 响应式、移动导航、无障碍状态和测试 |
| `a9a807a` | API 热重载范围修复 |
| `99c0bf1` | 暂缓视觉增强、补充交付文档并修复审计依赖 |

## 9. 当前状态

- Task 1-9：已完成。
- Task 10：Three.js/GSAP 增强已暂缓。
- Task 11：文档已完成，依赖修复后的最终验证待执行。
- 公司 API、真实支付、真实短信、生产部署、监控和备份仍不在当前范围内。

本项目目录与仓库根目录中的其他前端实现相互隔离；本轮工作只修改和提交了 `platform/` 内的文件。

## 10. 下一步

在 `D:\linepool\platform` 中执行：

```powershell
npm test
npm run typecheck
npm run build
npm audit --registry=https://registry.npmjs.org
```

四项全部通过后，可将 Task 11 标记为完成。后续如需接入真实公司能力，应先明确 API 文档、认证方式、字段映射、隐私边界和生产部署方案，再新增独立 ADR 和实施任务。
