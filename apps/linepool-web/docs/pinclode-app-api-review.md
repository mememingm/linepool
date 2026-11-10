# PinClode 应用接入文档（初版）对照评估

> 来源：`应用接入文档 · PinClode.html`（保存自 `http://120.55.75.51/pingcode/application-integration.html`），评估日期 2026-11-03。
> 只做了对照，没有改代码。

## 1. 这份文档讲的是什么

文档描述了两部分：

1. **应用登录（SSO）**：用户在 PinClode 的"应用目录"里开通你的应用，然后用 **PinClode 账号**登录你的网站。登录流程是 PKCE 授权码模式：浏览器跳转到 `/app-login`，登录后带 code 回调，再由你的服务端调用 `exchange` 换取用户身份和令牌。
2. **应用 API `/api/app/v1`**：拿到的 `accessToken` 只能访问**这个 PinClode 用户自己名下**的号码和短信。

| 接口 | 用途 |
|---|---|
| `POST /api/public/v1/application-sso/exchange` | 用 code 换 subject（用户 ID）、accessToken（1 小时）、refreshToken（7 天，一次性） |
| `POST /api/public/v1/application-sso/refresh` | 续期，同时轮换两种令牌 |
| `POST /api/public/v1/application-sso/status` | 查询用户是否仍处于开通状态 |
| `GET /api/app/v1/numbers`、`/numbers/{id}`、`/numbers/by-phone` | 读取本人号码 |
| `POST /api/app/v1/sms/send`、`GET /sms/outbound/{id}` | 发短信（需要 Idempotency-Key）、查询发送结果 |
| `GET /api/app/v1/sms`、`/sms/{id}` | 短信列表（最多近 30 天）、单条短信 |

## 2. 和现有代码对得上的地方

| 项目 | 对照结果 |
|---|---|
| 号码对象 `id / phoneNumber / iccid / status / expiresAt` | ✅ 与 linepool [pingcode-adapter.ts](../backend/src/providers/pingcode-adapter.ts) 的 `pingCodeNumberSchema` 一致，状态枚举 `READY / ACTIVE / EXPIRED / DISABLED / UNAVAILABLE` 也一致 |
| 短信对象 `id(IN-uuid / OUT-数字) / direction / numberId / phoneNumber / counterparty / content / status / occurredAt / createdAt / errorCode` | ✅ 字段名、ID 格式、发信状态枚举都和 `pingCodeSmsSchema` 一致 |
| 分页 `data + page{limit, nextCursor, hasMore}`、`cursor`、`limit 1–100` | ✅ 结构一致 |
| 错误信封 `error.code` | ✅ linepool 和 once 都读取 `error.code` |
| 发短信：请求体用 `phoneNumber / to / content` 加 `Idempotency-Key`，按 `OUT-` ID 查询结果 | ✅ 和 once [pingcode.client.ts:104-117](file:///D:/once/backend/src/pingcode.client.ts) 的写法一致 |

结论：之前 AI 按"PingCode 文档"写的数据结构**基本是对的**，可以复用。

## 3. 需要改的地方（字段 / 路径级别）

| # | 差异 | 影响位置 |
|---|---|---|
| D1 | 路径前缀从 `/pingcode/api/open/v1` 改为 `{PINCODE_BASE}/api/app/v1` | linepool `pingcode-adapter.ts:60`；once 的 `PINGCODE_BASE_URL` 配置 |
| D2 | **没有 `/me` 接口**，用户身份在 exchange 时拿到 | linepool `adapter.account()`；once `verifyAccount()` 每次发送前都会调用 `/me`，接入后会直接失败 |
| D3 | 返回示例里有 `"errorCode": null`、`"nextCursor": null` | linepool 的 schema 写的是 `errorCode: z.string().optional()`、`nextCursor: z.string().min(1).optional()`，**遇到 null 会校验失败**，必须改成 `.nullable()` |
| D4 | 认证方式从"运营方共用一把 API Key"改为"**每个用户一套 accessToken / refreshToken**" | once `config.ts` 的 `PINGCODE_API_KEY` 和 `PINGCODE_ACCOUNT_ID` 不再适用；两个项目都需要新增一张表来保存每个用户的令牌 |
| D5 | 文档里**没有 webhook** | linepool `/api/webhooks/pingcode`、once `/api/webhooks/pingcode/receive` 的签名校验都没有对应的上游功能 |
| D6 | 文档里没有购买、分配、释放、商品目录接口 | 和之前的判断一致（linepool adapter 里这几个方法都是抛 501 的占位） |

## 4. 模式上的冲突（需要先和 PC 确认）

这份文档把你的网站当成"**PinClode 用户使用的一个应用**"，而 LP / ONCE 现在的设计是"**我们自己的用户、我们给用户分配号码**"。这两种模式有几处直接冲突：

1. **账号体系**：要访问用户的号码，用户必须先有 PinClode 账号，并在应用目录里开通你的应用。那么 LP / ONCE 自己的注册、登录还要保留吗？还是改成"用 PinClode 登录"，或者把两个账号绑定起来？
2. **号码从哪来**：API 只能读取"已经分配到这个用户名下"的号码。LP / ONCE 的"购买号码"流程无法让 PC 把号码分配给用户，必须由 PC 管理员在后台分配，或者 PC 再提供分配接口。
3. **收短信**：没有 webhook，只能用每个用户自己的 token 轮询 `/sms`。可是 refreshToken 只有 7 天，用户 7 天不登录后服务端就无法续期，**也就收不到这个用户的短信**。而且每个用户都得单独轮询，用户一多，请求量会很大。
4. **运营方共享账号**：文档明确说"管理员的应用令牌也只返回本人号码"。所以 once 现在"运营方一个账号、所有 C 端用户共用"的模式，用这套 API 实现不了。

## 5. 建议向 PC 确认的问题

1. 这套应用 API 是给 C 端网站用的正式方案吗？还是另外会有一套"运营方 API"（运营方一个凭证，可以给自己平台的用户分配号码、接收所有号码的短信）？
2. 号码怎么分配到用户名下？有没有分配、释放的接口，还是只能由管理员在后台手动分配？
3. 收信有没有推送（webhook）？如果没有，轮询的频率限制是多少？用户长期不登录、refreshToken 过期之后，他的短信怎么获取？
4. 正式环境的 `PINCODE_BASE` 地址是什么？现在文档挂在 `http://120.55.75.51`，没有 HTTPS。
5. 完整的错误码列表，以及 401 时如何区分"令牌过期"和"开通已撤销"。
6. 限流规则，以及 30 天查询窗口对历史短信的影响。
7. `errorCode` 和 `nextCursor` 会不会返回 null（示例里是 null）。

## 6. 现在就可以做的事（不依赖 PC 的答复）

- **D3**：把 linepool 的 `errorCode`、`nextCursor` 改成 nullable。改动很小，不管最终采用哪种模式都需要。
- **D1**：把 PingCode 的地址前缀改成可配置项（`PINCODE_BASE`），不要再写死在代码里。
- 等 PC 回复第 1 个问题后，再决定要不要做 SSO 登录和用户令牌表（D2、D4）。在此之前不建议动账号体系。
