# LINEPOOL `workspace-reference` React 独立重写方案

> 历史方案：以下“待确认、只写方案”的状态对应当时讨论。现已实现独立的 `#workspace-reference-shell` 外层壳层，原始 `#workspace-reference` 保持不变。当前能力、只读边界与后续优化请以 [workspace-reference-shell 交接文档](workspace-reference-shell-handoff.md) 为准；下文保留为历史方案，不表示完整重写或业务接入已经完成。

> 状态：待确认。本文只包含方案和生图提示词，不实施代码。

## 一、唯一目标

使用 React 在 `D:/linepool/linepool-ui` 内独立重写 `http://127.0.0.1:5177/#workspace-reference`。

`workspace-reference` 是唯一界面标准。主页面必须按参考页 1:1 复刻，不能重新设计、不能重新排版、不能替换卡片样式，也不能加入 5174 的视觉或结构。

## 二、不可违反的约束

- 不引用 5174 的任何代码、组件、样式、图片、路由、类型或数据。
- 不修改 5177 原有 `workspace-reference` 页面。
- 不把新页面做成后台管理系统、表格系统或新的数据仪表盘。
- 主页面保留参考页原有布局：主内容区约 69%，右侧栏约 31%。
- 主页面保留参考页原有顺序和比例：顶部欢迎区、账户卡、号码可用率、收到短信、常用服务、收码趋势、最新验证码、号码有效期。
- 保留参考页的浅灰蓝背景、白色卡片、蓝色按钮、珊瑚色提醒、两张渐变指标卡、圆角、阴影、字体、留白、图表和响应式断点。
- 左侧导航只能作为参考页面外部的独立壳层，不能改变参考页主内容的 DOM 层级、卡片比例、颜色和排版；导航本身也必须使用参考页的视觉语言。
- 生图只用于确认构图，不得让生图结果替代真实参考页面。

## 三、页面复刻规则

### 主页面

主页面直接以 `workspace-reference` 为模板进行复刻：

```text
外层：左侧导航壳层（导航样式以用户提供的侧边栏参考图为准）
└─ 参考页主画布：保持原有内容和顺序
   ├─ 顶部：LINEPOOL 标识、欢迎语、账户说明、搜索、购买号码按钮
   ├─ 第一行：我的账户、号码可用率、本月收到短信、常用接码服务
   ├─ 第二部分：收码趋势、月份切换、7 天/30 天范围切换、曲线和统计总数
   └─ 右侧：最新验证码、查看全部短信、号码有效期和剩余天数
```

“主页面 1:1”指参考页主画布的视觉和结构必须一一对应。不能因为增加导航而把参考页改造成新的三栏布局，也不能压缩、放大或重排参考页的卡片。

### 左侧导航：严格参照用户提供的导航图

左侧导航不是重新设计，直接按照用户提供的侧边栏截图复刻：

- 整体为窄而高的浅灰白侧栏，右侧有细分隔线，内容上下留白充足。
- 顶部是白色圆角账户卡：左侧圆形头像，右侧显示 `LINEPOOL`、`Lin Chen · 演示账户`，最右侧为小型下拉按钮。
- 账户卡下方是主导航：`工作台`、`购买号码`、`短信收件箱`、`账户设置`。
- `工作台`是白色圆角选中项，带轻微边框和阴影；其他项目保持透明背景。
- 导航项目使用浅灰线性图标、深灰文字，短信收件箱右侧显示浅灰徽标 `3`。
- 中部使用小号浅灰分组标题 `号码与订单`，下面依次为 `我的号码`、`订单记录`、`积分明细`。
- 下方使用小号浅灰分组标题 `地区服务`，第一项为 `全部地区`，右侧显示 `+`；下面依次为 `美国号码`、`英国号码`、`加拿大号码`、`新加坡号码`，使用文件夹图标。
- 侧栏底部固定一张白色圆角到期提醒卡：标题为 `2 个号码即将到期`，右上角有关闭 `×`，显示 `最近到期：2 天后`、多段彩色进度条和 `查看号码 →`。
- 导航文字、图标、分组间距、账户卡、底部提醒卡的比例以截图为准，不加入额外菜单、头像菜单、装饰插画或大面积品牌色。
- 在窄屏端，导航可以折叠，但展开后的内容、顺序和视觉仍必须保持截图结构。

### 其他页面

购买号码、我的号码、短信收件箱、订单记录、账户设置都使用参考页的同一套视觉规则：

- 相同页面背景、字体、颜色、圆角、阴影和间距。
- 相同的标题、筛选、列表、卡片和按钮质感。
- 相同的空状态、错误状态、加载状态和弹窗风格。
- 页面内容可以根据业务变化，但不能产生另一套设计语言。

## 四、只提取业务流程，不依赖 5174

业务只保留这些核心流程：

1. 购买号码：选择国家/地区、服务和有效期，查看确认结果。
2. 管理号码：查看号码、服务、状态和有效期。
3. 接收验证码：查看短信、打开详情、复制验证码、标记已读。
4. 查看订单：查看购买记录、号码、服务和订单状态。
5. 查看账户：查看账户名称、号码数量、短信数量和订单数量。

第一阶段使用 React 项目内独立的演示数据。数据结构独立定义，后续如需接 API，只增加独立 adapter，不引用 5174 的任何业务实现。

## 五、React 实施边界

建议的独立结构：

- `WorkspaceShell`：只负责左侧导航和外层页面承载，导航必须按用户提供的侧边栏截图复刻。
- `SidebarAccountCard`：头像、LINEPOOL、Lin Chen · 演示账户和下拉按钮。
- `SidebarPrimaryNav`：工作台、购买号码、短信收件箱、账户设置。
- `SidebarBusinessGroups`：号码与订单、地区服务两组导航。
- `SidebarExpiryNotice`：底部号码到期提醒卡。
- `ReferenceWorkspace`：完整复刻参考页主画布。
- `ReferenceHeader`：参考页顶部区域。
- `AccountProfileCard`：参考页账户卡。
- `MetricCard`：参考页两张指标卡。
- `ServiceStack`：参考页常用服务区域。
- `UsageTrend`：参考页趋势图区域。
- `MessageInbox`：参考页最新验证码区域。
- `ExpiryList`：参考页号码有效期区域。
- `MessageDialog`：参考页验证码弹窗。

实施时优先复刻现有参考页的尺寸和 CSS 关系，再接入业务状态。不能先设计一套新页面再套参考色彩。

## 六、实施顺序

1. 固定参考页截图和尺寸，记录桌面端、平板端、手机端的准确布局。
2. 先完成参考页主画布的 1:1 React 复刻，不加入业务页面改造。
3. 在主画布外增加左侧导航，确认导航不改变参考页内容比例。
4. 将购买号码、号码、短信、订单、账户等核心流程接入现有参考组件结构。
5. 补齐搜索、复制、已读、弹窗、筛选、空状态和错误状态。
6. 以参考截图逐像素检查位置、尺寸、颜色、文字换行和响应式表现。

## 七、验收标准

- 新实现完全独立于 5174。
- 参考页主画布与 `workspace-reference` 的结构、顺序、比例和视觉一致。
- 左侧导航只存在于外层，不侵入参考页主内容。
- 首页首屏仍然是参考页的账户卡、双色指标卡、常用服务、趋势图、验证码和有效期布局。
- 其他业务页面只改变内容，不改变参考页的视觉系统。
- 1440px、1024px、390px 下没有重排错误、重叠或横向溢出。
- 5177 原有页面保持不变。

## 八、生图提示词

### 主提示词

```text
Use the supplied screenshot of LINEPOOL workspace-reference as the exact visual and structural reference. Recreate the same logged-in personal workspace with extremely high fidelity. This is a UI reference reconstruction, not a creative redesign.

Keep the exact composition and hierarchy of the reference: a very light gray-blue page background; a wide main canvas with the same 69/31 proportion between the main content and right sidebar; the same top header with the LINEPOOL mark, welcome text, account label, rounded search field, and circular purchase button; the same large white account profile card; the same two colorful warm and cool gradient metric cards; the same gray common services strip with Google, Telegram, and WhatsApp logos; the same usage trend chart with month buttons, 7-day/30-day selector, tooltip, curves, legend, and total number; the same right sidebar with latest verification messages, dates, times, sender logos, arrow affordances, and number expiry progress rows.

Preserve the reference page's exact spacing, card proportions, border radii, shadows, typography scale, icon size, muted gray text, cobalt blue actions, coral warning color, gradient direction, chart placement, and responsive behavior. Use realistic fictional Chinese demo content while keeping the same text density and line lengths as the reference.

Add the left sidebar from the supplied sidebar reference image exactly. It is a narrow, tall, very light gray-white navigation rail with a thin right divider. At the top place a white rounded account card with a circular female avatar, the text “LINEPOOL”, the subtitle “Lin Chen · 演示账户”, and a small rounded dropdown button on the right. Below it place the primary navigation items “工作台”, “购买号码”, “短信收件箱”, and “账户设置”; make “工作台” the selected white rounded item with a subtle border and shadow, use small light-gray line icons, and show a pale notification badge “3” on the right side of “短信收件箱”.

Below the primary navigation add the muted group title “号码与订单” with “我的号码”, “订单记录”, and “积分明细”. Then add the muted group title “地区服务”, a row “全部地区” with a plus sign on the right, followed by folder rows “美国号码”, “英国号码”, “加拿大号码”, and “新加坡号码”. At the bottom of the sidebar place a fixed white rounded expiry notice card with “2 个号码即将到期”, a close x button, “最近到期：2 天后”, a segmented multicolor progress bar, and “查看号码 →”. Match the screenshot’s typography, icon scale, spacing, card radius, and restrained gray palette. Do not add extra menu items or illustrations.

The main workspace to the right must preserve the supplied workspace-reference screenshot exactly:
```

### 负面提示词

```text
extra navigation items, oversized navigation, floating navigation, dark sidebar, colorful sidebar, gradients in the sidebar, missing account card, missing grouped sections, missing bottom expiry notice, wrong labels, wrong icon style, wrong badge placement, redesigned navigation, compressed reference canvas, changed card order, changed chart, changed gradients, different typography, different spacing, glassmorphism, neon colors, 3D illustration, large hero image, marketing landing page, finance dashboard, crypto UI, excessive pills, excessive borders, random widgets, extra charts, fake phone photos, unreadable tiny text, mismatched icons, inconsistent card radii, visual clutter, horizontal scrolling, visual style drift from the supplied workspace-reference screenshot
```

## 九、确认后再实施

在本方案确认前，只保留文档和生图提示词，不写 React 代码、不修改页面。
