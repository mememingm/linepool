# LINEPOOL `#workspace-reference` 工作台实施方案与交接文档

> 历史方案：下文保留原有规划和当时状态。当前后续优化入口为 `#workspace-reference-shell`，原始 `#workspace-reference` 首页只读，不能按下文建议直接修改基线。实际实现、已知缺口与验收要求请看 [workspace-reference-shell 交接文档](workspace-reference-shell-handoff.md)。文中共享数据路径 `shared.ts` 的实际文件为 `shared.tsx`。
>
> 最新后续任务已完成目标工作台的 API 接入及浏览器验收，当前运行目录为 `D:/llinepool/linepool-ui`、前端端口为 5178。本文的本地演示状态、旧目录与端口仅作历史记录；最新结果见 [API 接入验收记录](workspace-api-acceptance.md)。

> 文档状态：待确认，当前只写方案，不修改页面实现。
>
> 目标：将现有 `#workspace-reference` 作为登录后的客户工作台展示方案，围绕“购买号码”和“查收验证码”两个核心任务，完成一套可演示、可交接、可继续接入真实 API 的前端工作台。

## 1. 结论先行

采用 `#workspace-reference` 作为主展示方案。

它的视觉方向是“轻量个人账户中心 + 数据概览”，而不是后台管理系统：左侧承载账户和趋势，右侧承载验证码与号码有效期；页面有明确的展示重点，也能让客户登录后马上看到当前号码状态和最近验证码。

当前基线已经具备：

- 个人账户卡片：头像、账户类型、号码/短信/订单数量。
- 两个核心指标：号码可用率、本月收到短信。
- 常用接码服务：Google、Telegram、WhatsApp。
- 收码趋势图：月份切换、7 天/30 天范围切换、空数据状态。
- 最新验证码列表：搜索、点击查看、复制验证码。
- 号码有效期列表：剩余天数、进度条、即将到期状态。
- 演示提示、原生 `dialog` 验证码详情弹窗、响应式布局和键盘焦点样式。

本方案的实施重点不是推翻已有页面，而是将当前展示版收敛为一套稳定的业务展示基线，并补充清晰的接入边界与交接信息。

## 2. 项目现状与代码边界

### 2.1 路由入口

- 地址：`http://127.0.0.1:5177/#workspace-reference`
- 路由文件：`D:/linepool/linepool-ui/catalog/main.tsx`
- 路由映射：`#workspace-reference` -> `src/linepool/showcase/Reference.tsx`
- 展示组件：`D:/linepool/linepool-ui/src/linepool/showcase/Reference.tsx`
- 样式文件：`D:/linepool/linepool-ui/src/linepool/showcase/Reference.css`
- 共享演示数据：`D:/linepool/linepool-ui/src/linepool/showcase/shared.ts`
- 图片与服务图标：`D:/linepool/linepool-ui/src/linepool/showcase/assets/`

### 2.2 技术栈

- React 19 + TypeScript 5.9。
- Vite 7，开发服务固定为 `127.0.0.1:5177`。
- `lucide-react` 负责图标。
- Beautiful UI 上游的 `Button`、`ProgressRing` 被当前参考页使用。
- 当前页面使用本地演示数据，不连接业务 API。
- 项目要求保持上游源码只读，业务适配放在 `src/linepool/` 与 catalog 路由层。

### 2.3 当前不可混淆的其他入口

项目中还存在其他工作台，它们不是本方案目标：

- `#workspace`：Animata 风格工作台。
- `#workspace-map`：资源地图复刻工作台。
- `#workspace-overview`：白底概览工作台。
- `#workspaces`：工作台方案总览。

本次后续实现只针对 `#workspace-reference`，不能把其他入口改成同一套页面，也不能删除它们。

## 3. 用户与业务目标

### 3.1 目标用户

已登录、准备购买虚拟号码并接收验证码的客户。

### 3.2 两个核心任务

1. 购买一个或多个国家/地区的号码。
2. 查看号码收到的验证码，并快速复制使用。

### 3.3 次级任务

- 了解号码剩余有效期。
- 了解当前使用中的号码数量。
- 查看本月收码量和趋势。
- 了解常用接码服务。
- 进入全部号码、短信收件箱和订单页面。

### 3.4 展示目标

这是一套用于展示和评审的工作台，不在本阶段实现真实支付、真实短信轮询或真实订单提交。所有数据和操作必须明确标记为演示数据，避免被误解为生产能力。

## 4. 页面信息架构

页面保持当前双栏结构：

```text
登录后工作台
├─ 主内容区（约 69%）
│  ├─ 顶部欢迎区
│  │  ├─ LINEPOOL 品牌入口
│  │  ├─ 欢迎语与账户标识
│  │  ├─ 搜索号码/验证码
│  │  └─ 购买号码入口
│  ├─ 账户与核心指标
│  │  ├─ 我的账户
│  │  ├─ 号码可用率
│  │  ├─ 本月收到短信
│  │  └─ 常用接码服务
│  └─ 收码趋势
│     ├─ 时间范围
│     ├─ 月份切换
│     ├─ 短信/号码曲线
│     └─ 当前统计总数
└─ 侧栏（约 31%）
   ├─ 最新验证码
   │  ├─ 日期/时间
   │  ├─ 验证码
   │  ├─ 服务来源
   │  └─ 查看全部短信
   └─ 号码有效期
      ├─ 国家/地区
      ├─ 剩余有效期进度
      ├─ 剩余天数
      └─ 即将到期提示
```

## 5. 视觉与交互方案

### 5.1 视觉基调

- 浅灰蓝页面底色，白色内容卡片。
- 蓝色作为主行动色，用于购买入口、选中月份、进度条和链接。
- 珊瑚色/橙色用于短信和即将到期的提醒，不作为大面积背景。
- 指标卡保留暖色和冷色渐变，用来形成展示层次，但不再增加额外装饰性渐变。
- 圆角卡片保持当前参考图的柔和比例，避免改造成密集后台表格。
- 字体沿用 Inter + 中文回退字体；字距保持 0。

### 5.2 首屏优先级

首屏从上到下、从左到右的优先级为：

1. 我是谁、账户处于什么状态。
2. 有多少号码在使用，近期收到多少验证码。
3. 最近验证码是否可直接查看。
4. 哪些号码即将到期。
5. 收码趋势和服务偏好作为辅助展示。

### 5.3 核心交互

| 交互 | 当前/计划行为 | 生产接入边界 |
|---|---|---|
| 搜索 | 同时过滤验证码来源、验证码、号码 | 接入 API 时改为服务端搜索或增加防抖 |
| 点击验证码 | 打开详情弹窗并标记为已读 | 生产环境需要调用已读接口 |
| 复制验证码 | 写入系统剪贴板并显示提示 | 失败时保留手动复制路径 |
| 购买号码 | 进入购买号码入口 | 生产环境进入真实购买流程，不在本页扣款 |
| 查看全部短信 | 跳转号码/短信工作台 | 目标路由由业务确认后接入 |
| 月份切换 | 切换本地演示统计 | 生产环境按月份请求聚合数据 |
| 7 天/30 天 | 切换趋势统计范围 | 生产环境传递 `range` 参数 |
| 号码有效期 | 展示剩余天数和进度 | 生产环境由服务端有效期计算 |
| 刷新账户 | 当前显示演示数据已更新 | 生产环境刷新账户摘要和缓存 |

### 5.4 空状态与异常状态

必须保留并在后续实现中验证：

- 搜索无匹配：显示“没有匹配的短信”或“没有匹配的号码”。
- 某月份暂无数据：趋势曲线降淡，并显示“暂无收码记录”。
- 某号码暂无短信：显示等待接收，不显示假的验证码。
- 剪贴板失败：显示手动复制提示，不静默失败。
- 号码即将到期：使用橙色/红色提醒，但不遮挡号码和剩余天数。
- 数据加载失败（接入 API 后）：显示可重试状态，不把错误当成 0 条数据。

## 6. 数据契约设计

当前页面使用本地数据，后续接真实 API 时建议保持以下业务形状。字段名可在 API 联调时映射，但不要把接口响应直接散落到 JSX 中。

### 6.1 账户摘要

```ts
type AccountSummary = {
  id: string;
  displayName: string;
  accountType: 'standard' | 'pro' | 'demo';
  numberCount: number;
  messageCount: number;
  orderCount: number;
};
```

### 6.2 号码

```ts
type PhoneNumber = {
  id: string;
  country: string;
  phone: string;
  status: 'ACTIVE' | 'EXPIRED' | 'PENDING';
  remainingDays: number;
  service?: string;
};
```

### 6.3 验证码消息

```ts
type VerificationMessage = {
  id: string;
  numberId: string;
  sender: string;
  code: string;
  body: string;
  receivedAt: string;
  read: boolean;
};
```

### 6.4 趋势数据

```ts
type UsageTrend = {
  month: string;
  range: '7' | '30';
  messageCount: number;
  numberUsage: number[];
  messageUsage: number[];
};
```

### 6.5 购买入口

本页只需要跳转或触发购买入口，不负责支付：

```ts
type PurchaseEntry = {
  country?: string;
  source: 'header' | 'account-card' | 'service-list';
};
```

## 7. 建议的组件边界

后续实施时，优先在 `Reference.tsx` 内拆出以下展示组件；是否物理拆文件可根据修改量决定：

- `ReferenceHeader`：品牌、欢迎语、搜索、购买入口。
- `AccountProfileCard`：账户头像、账户类型、三个数量入口。
- `MetricCard`：可用率和收码量两个指标卡。
- `ServiceStack`：常用服务图标列表。
- `UsageTrendCard`：范围、月份、曲线、空状态。
- `MessageInbox`：最新验证码列表、搜索结果和查看全部入口。
- `ExpiryList`：号码有效期、进度条和到期提示。
- `MessageDialog`：验证码详情、复制、关闭。
- `DemoNotice`：演示操作提示。

拆分原则：只有在组件有独立状态、独立语义或需要复用时才拆分；不为拆分而拆分，避免把页面改成难以追踪的组件树。

## 8. 实施阶段

### 阶段 0：确认方案

- [ ] 确认采用 `#workspace-reference`。
- [ ] 确认展示版保留“演示数据、不连接 API”标识。
- [ ] 确认本轮不实现真实支付、短信轮询和订单接口。
- [ ] 确认“购买号码”后续跳转目标。

### 阶段 1：基线整理

- [ ] 记录实施前的桌面和移动端截图。
- [ ] 记录当前 `Reference.tsx`、`Reference.css`、`shared.ts` 的职责。
- [ ] 确认 `#workspace-reference` 路由不影响其他工作台。
- [ ] 运行 `npm run typecheck`，作为实施前基线。

### 阶段 2：页面结构稳定

- [ ] 保持双栏布局和现有参考图比例。
- [ ] 确认主内容区、侧栏、趋势区域在宽屏下不重叠。
- [ ] 确认 820px 以下切为上下结构。
- [ ] 确认 540px 以下搜索栏、指标卡和侧栏都能独立换行。
- [ ] 统一按钮的 `aria-label`、链接标题和键盘焦点样式。

### 阶段 3：业务文案与演示状态

- [ ] 统一“号码可用率”“收到短信”“验证码”“有效期”等术语。
- [ ] 统一所有演示数据提示，避免误导为真实扣款或真实短信。
- [ ] 补齐无数据、无匹配、暂无短信和复制失败状态。
- [ ] 校验所有数字与共享演示数据一致。

### 阶段 4：交互验收

- [ ] 搜索验证码和号码。
- [ ] 打开验证码详情并复制。
- [ ] 验证标记已读的视觉反馈。
- [ ] 切换月份和统计范围。
- [ ] 点击号码有效期列表和“查看全部短信”。
- [ ] 点击购买号码入口并确认跳转行为。
- [ ] 验证键盘 Tab、Escape 关闭弹窗、Enter 激活按钮。

### 阶段 5：视觉验收

- [ ] 1440px 以上桌面截图。
- [ ] 1024px 平板截图。
- [ ] 390px 手机截图。
- [ ] 对照参考图检查比例、留白、卡片层级、颜色和文字换行。
- [ ] 检查浅色页面没有水平滚动条。
- [ ] 检查动态图表和弹窗在 `prefers-reduced-motion` 下不强制动画。

### 阶段 6：构建与交付

- [ ] `npm run typecheck`
- [ ] `npm run build:catalog`
- [ ] 保持 `verify:upstream` 与 `verify:catalog-upstream` 通过。
- [ ] 输出桌面/移动截图路径。
- [ ] 更新交接文档中的已完成项、未完成项和真实 API 接入点。

## 9. 验收标准

### 功能

- 登录后展示页默认能打开 `#workspace-reference`。
- 客户能在首屏找到购买号码入口。
- 客户能在首屏看到最新验证码、来源和时间。
- 点击验证码可以打开详情弹窗。
- 验证码可以复制，复制成功有明确提示。
- 搜索不会破坏布局，清空搜索后恢复完整列表。
- 号码有效期按剩余天数显示，接近到期时有明显但克制的提醒。
- 趋势数据可以切换月份和时间范围。

### 视觉

- 保留参考方案的浅色双栏、账户卡、双色指标卡、趋势图、验证码侧栏结构。
- 不引入后台系统式的密集表格、过大的标题或无业务意义的装饰。
- 关键文本在桌面和移动端都不溢出、不重叠。
- 任何新增卡片圆角不超过现有设计语言，避免卡片套卡片。

### 工程

- 不修改 `src/vendor/` 中的上游源码。
- 不删除 `#workspace`、`#workspace-map`、`#workspace-overview`、`#workspaces`。
- TypeScript 类型检查通过。
- catalog 构建通过。
- 只改与 `#workspace-reference` 直接相关的文件。

## 10. 风险与处理

| 风险 | 影响 | 处理方式 |
|---|---|---|
| 当前数据文件与接口字段不一致 | 接入 API 时返工 | 先以数据契约隔离 JSX 与接口响应 |
| 参考图布局在小屏空间不足 | 手机端重叠或滚动 | 先做 390px 截图验收，再扩展到更宽尺寸 |
| `#workspace-reference` 与其他入口共享数据 | 改动产生跨页面回归 | 修改前确认 import 关系，避免重写 shared 数据 |
| 视觉渐变过多 | 页面变成营销落地页 | 渐变只保留在两个指标卡，其他区域用纯色和边框 |
| “购买号码”被误解为真实购买 | 展示环境产生业务误会 | 保留演示标识，明确跳转/模拟边界 |
| 上游组件校验失败 | 构建无法交付 | 不改 vendor，使用本地业务封装和现有组件 |

## 11. 交接文档

### 11.1 接手人先读什么

1. 本文件的第 2、3、4、6 节。
2. `D:/linepool/linepool-ui/src/linepool/showcase/Reference.tsx`。
3. `D:/linepool/linepool-ui/src/linepool/showcase/Reference.css`。
4. `D:/linepool/linepool-ui/src/linepool/showcase/shared.ts`。
5. `D:/linepool/linepool-ui/catalog/main.tsx` 中 `#workspace-reference` 的路由分支。

### 11.2 本地启动

```powershell
cd D:\linepool\linepool-ui
npm run dev
```

打开：

```text
http://127.0.0.1:5177/#workspace-reference
```

### 11.3 验证命令

```powershell
cd D:\linepool\linepool-ui
npm run typecheck
npm run build:catalog
```

### 11.4 当前演示数据入口

当前 `Reference.tsx` 从 `./shared` 读取 `balance`、`messages`、`numbers`、`orders`，并在组件内部计算：

- `inbox`：最新验证码列表。
- `activeNumbers`：使用中的号码。
- `activeRate`：号码可用率。
- `chartTotal`：月份和范围对应的演示统计。

接入真实 API 时，建议增加 `services/referenceWorkspace.ts` 或同层数据适配文件，先将 API 响应转成第 6 节的数据契约，再传入展示组件。

### 11.5 允许修改的文件

优先修改：

- `D:/linepool/linepool-ui/src/linepool/showcase/Reference.tsx`
- `D:/linepool/linepool-ui/src/linepool/showcase/Reference.css`
- `D:/linepool/linepool-ui/src/linepool/showcase/shared.ts`（仅在演示数据确实需要调整时）
- `D:/linepool/linepool-ui/catalog/main.tsx`（仅在路由或入口文案需要调整时）
- `D:/linepool/linepool-ui/src/linepool/showcase/assets/`（仅新增与本方案直接相关的素材）

不要直接修改：

- `D:/linepool/linepool-ui/src/vendor/`
- 其他工作台的 CSS 和组件，除非构建或共享类型明确要求。

### 11.6 当前已知的保留项

- 当前“购买号码”入口跳转到 `#workspace-a`，这只是现有展示串联方式，生产前必须由业务确认真实购买页。
- 当前验证码“标记已读”只写入组件本地状态。
- 当前搜索、月份和范围切换只使用本地演示数据。
- 当前统计曲线是固定的演示曲线，不代表真实业务指标。
- 当前账户头像、服务 logo 和号码数据均为演示素材。

### 11.7 交接完成定义

接手人完成以下内容后，才算完成交接：

- 能在本地打开 `#workspace-reference`。
- 能说明两个核心业务任务及其当前演示边界。
- 能定位页面入口、样式、共享数据和素材目录。
- 能完成一次验证码查看、复制和搜索操作。
- 能运行类型检查和 catalog 构建。
- 能指出至少一个真实 API 接入前必须确认的业务问题。

## 12. 待确认问题

以下问题不阻塞展示版页面本身，但会影响后续实施和接入方向：

1. “购买号码”入口是否继续跳转到现有 `#workspace-a`，还是只保留展示按钮，等待真实购买页？
2. 本轮是否保持纯演示数据，不新增购买弹窗和模拟扣款？
3. 账户称呼是否继续使用“林晓 / LP001028”，还是改成更中性的“演示账户 / DEMO-001”？
4. “常用接码服务”是否只展示 Google、Telegram、WhatsApp，还是需要加入更多业务服务？
5. 验收重点是尽量贴近参考截图，还是优先突出号码购买与验证码收取的业务可用性？

## 13. 推荐默认决策

若没有额外要求，建议采用以下默认值：

- 购买入口继续保留，但标记为演示跳转；真实购买流程另设页面。
- 本轮不实现真实支付、真实轮询和真实订单接口。
- 账户使用中性演示身份，避免展示用名称被误认为真实客户信息。
- 保留当前三个常用服务，保证视觉密度与参考图一致。
- 视觉优先级为“参考图结构 60% + 业务信息清晰度 40%”，不追求像素级复制。

## 14. 当前状态

- [x] 已确认目标入口为 `#workspace-reference`。
- [x] 已核对现有入口、组件、样式、共享数据和构建脚本。
- [x] 已完成本实施方案和交接文档草案。
- [ ] 等待方案确认。
- [ ] 方案确认后再开始代码实施。
- [ ] 实施完成后进行桌面、平板、手机截图验收。
