# WP2-a：F3 错误提示中英文补全与核验

## 范围与实现

- 共享映射唯一来源：`src/linepool/i18n/api-errors.ts` 的 `apiErrorMessages` / `apiFailureMessage`；普通用户 `apiMessage`、代理 `agentError`、管理员 `errorMessage` 均复用它，不显示后端 `message` 原文。
- 本包补齐静态 `ApiFailure` 扫描发现的 `USE_SHARED_NUMBER_INVENTORY`，中英文分别为“代理号码请从总库存选择并分配，不能手工录入”和“Agent numbers must be selected from shared stock and allocated; manual entry is not supported.”。
- `AGENT_NOT_ACTIVE`、`TRANSFER_SCOPE_INVALID` 已在共享映射中，WP2-c 无需修改 i18n。

## 错误码表（来源与覆盖）

下列 125 个码来自 `backend/src/**/*.ts` 中所有静态 `new ApiFailure(status, code, ...)`；逐项均在共享映射中有 zh-CN / en-US 文案：

```text
ACCOUNT_DISABLED, ACTOR_NOT_ACTIVE, ADMIN_PASSWORD_PROTECTED, ADMIN_PROTECTED,
ADMIN_REQUIRED, AGENT_HIERARCHY_INVALID, AGENT_LEVEL_INVALID,
AGENT_MANAGEMENT_REQUIRED, AGENT_NOT_ACTIVE, AGENT_NOT_FOUND, AGENT_REQUIRED,
AGENT_STATUS_FORBIDDEN, AMOUNT_TOO_LARGE, AUTH_REQUIRED, BALANCE_ACCOUNT_NOT_FOUND,
BALANCE_CHANGED, BATCH_EMPTY, BATCH_EXPIRY_REQUIRED, BATCH_RECIPIENT_INVALID,
BATCH_SELECTION_CHANGED, BATCH_TOO_LARGE, CUSTOMER_MANAGEMENT_REQUIRED,
CUSTOMER_NOT_ACTIVE, CUSTOMER_NOT_FOUND, CUSTOMER_TERMINATED, EMAIL_EXISTS,
HOLDING_NOT_ACTIVE, HOLDING_NOT_AVAILABLE, HOLDING_NOT_FOUND, HOLDING_WINDOW_EXCEEDED,
HOLDING_WINDOW_INVALID, IDEMPOTENCY_CONFLICT, INSUFFICIENT_BALANCE,
INSUFFICIENT_POINTS, INSUFFICIENT_STOCK, INVALID_CREDENTIALS,
INVALID_CURRENT_PASSWORD, INVALID_DURATION, INVALID_HOLDING_WINDOW, INVALID_RESET_TOKEN,
MAX_AGENT_LEVEL, MESSAGE_NOT_FOUND, MOCK_CLAIM_STALE, MOCK_DEBIT_MISSING,
MOCK_RESERVATION_CONFLICT, MOCK_TERMINAL, MOCK_TRANSITION, NOT_DEFERRED_MOCK,
NOT_ENROLLED, NOT_FOUND, NUMBER_ASSIGNED, NUMBER_NOT_FOUND, NUMBER_RESERVED,
OFFER_NOT_FOUND, ORDER_NOT_FOUND, ORDER_STATE_CONFLICT, ORIGIN_REJECTED,
OWNERSHIP_CHANGED, OWNER_NOT_FOUND, OWNER_NOT_VISIBLE, PARENT_AGENT_NOT_ACTIVE,
PARENT_AGENT_NOT_FOUND, PASSWORD_RECOVERY_UNAVAILABLE, PAYMENT_AMOUNT_MISMATCH,
PAYMENT_TRANSACTION_REQUIRED, PAYMENT_TRANSACTION_REUSED, PLATFORM_REQUIRED,
PRICE_BUYER_INVALID, PRICE_CHANGED, PRICE_NOT_SET, PRICE_SELLER_INVALID,
PRODUCT_EXISTS, PRODUCT_NOT_OFFERED_UPSTREAM, PROVIDER_ALLOCATION_INACTIVE,
PROVIDER_CURSOR_REPEATED, PROVIDER_EVENT_CONFLICT, PROVIDER_MESSAGE_CONFLICT,
PROVIDER_NUMBER_MISMATCH, PROVIDER_NUMBER_WITHOUT_PHONE, PROVIDER_PAGE_LIMIT,
PROVIDER_PROJECT_DISABLED, PROVIDER_PROJECT_NOT_FOUND, PROVIDER_ROUTE_UNCONFIRMED,
PROVIDER_UNAVAILABLE, QUOTE_REQUIRED, RECEIPT_NOT_FOUND, RECHARGE_AMOUNT_INVALID,
RECHARGE_NOT_CONFIGURED, RECHARGE_ORDER_NOT_FOUND, RECHARGE_ORDER_NOT_PENDING,
RECHARGE_SETTINGS_CHANGED, REGION_INVALID, REGION_NOT_AVAILABLE, RENEWAL_DISABLED,
RESALE_SAME_OWNER, RESALE_SCOPE_INVALID, RESOURCE_EXPIRES_TOO_SOON,
RESOURCE_UNAVAILABLE, SERVICE_INVALID, SERVICE_MISMATCH, STOCK_RESOURCE_EXPIRES,
STOCK_RESOURCE_UNAVAILABLE, STOCK_UNAVAILABLE, SUBAGENT_MANAGEMENT_REQUIRED,
SUBAGENT_NOT_FOUND, SYNC_ALREADY_RUNNING, SYNC_CONFLICT_NOT_FOUND, SYNC_LEASE_LOST,
SYNC_MAPPING_CHANGED, TRANSACTION_NOT_FOUND, TRANSFER_SAME_OWNER,
TRANSFER_SCOPE_INVALID, UNAUTHENTICATED, USER_ALREADY_ENROLLED, USER_NOT_ELIGIBLE,
USER_NOT_FOUND, USER_UNAVAILABLE, USE_SHARED_NUMBER_INVENTORY, VALIDATION_ERROR,
WEBHOOK_ENCODING_UNSUPPORTED, WEBHOOK_EVENT_ID_MISMATCH, WEBHOOK_JSON_REQUIRED,
WEBHOOK_NOT_CONFIGURED, WEBHOOK_SIGNATURE_INVALID, WEBHOOK_TIME_INVALID
```

另外覆盖非 `new ApiFailure` 的面向客户端来源：

- `backend/src/http.ts`：429 → `RATE_LIMITED`，普通异常 → `REQUEST_FAILED`，413 → `PAYLOAD_TOO_LARGE`，坏 JSON → `INVALID_JSON`，数据库/内部异常 → `DATABASE_UNAVAILABLE` / `INTERNAL_ERROR`。
- `src/linepool/api/client.ts`：网络断开 → `NETWORK_ERROR`，超时 → `REQUEST_TIMEOUT`，响应不符合契约 → `INVALID_RESPONSE`，HTTP 响应无法解析 → `HTTP_ERROR`。
- `src/linepool/workspace-reference/detail-data.ts` 的本地响应一致性检查使用 `INVALID_RESPONSE`。
- `providers/pingcode-adapter.ts` 的 `ProviderError` 是后端内部供应商适配器错误，不直接作为前端 `LinepoolApiError`；其未知上游码不会绕过前端兜底。

## 兜底规则

`apiFailureMessage(code, status, locale)` 的顺序是：已知码取对应语言；429 统一 `RATE_LIMITED`；500+ 统一“服务暂时不可用 / The service is temporarily unavailable”；其余未知 4xx 只显示净化后的 `[A-Za-z0-9_-]` 错误码（最长 80 个字符），不显示后端英文 raw message。空码使用 `HTTP_<status>`。

## 手动核验留证

在 `linepool-ui` 安装依赖后，可直接加载映射函数（不运行测试套件）：

```bash
node --import tsx --input-type=module -e "import { apiFailureMessage } from './src/linepool/i18n/api-errors.ts'; console.log(JSON.stringify({accountZh:apiFailureMessage('ACCOUNT_DISABLED',403,'zh-CN'),accountEn:apiFailureMessage('ACCOUNT_DISABLED',403,'en-US'),unknownZh:apiFailureMessage('NOPE<script>',400,'zh-CN'),unknownEn:apiFailureMessage('NOPE<script>',400,'en-US'),serverZh:apiFailureMessage('BACKEND_UNKNOWN',503,'zh-CN'),serverEn:apiFailureMessage('BACKEND_UNKNOWN',503,'en-US')}))"
```

实际使用 Bun 1.4.4 直接加载 TS 映射函数的结果：

```json
{"accountZh":"账号已被停用，如有疑问请联系客服","accountEn":"Your account has been disabled. Please contact support.","unknownZh":"操作未完成，请检查后重试（错误码 NOPEscript）","unknownEn":"The action could not be completed. Please check and try again (error code NOPEscript).","serverZh":"服务暂时不可用，请稍后重试","serverEn":"The service is temporarily unavailable. Please try again later.","agentEn":"The recipient agent is suspended or terminated. Please check their status.","transferZh":"只能转余额给正常启用的直属下级代理"}
```

覆盖扫描结果：`backend/src/**/*.ts` 静态 `ApiFailure` 代码 125 个，共享映射覆盖 125 个，缺失 0 个。未知 4xx 的 `<script>` 已被净化为 `NOPEscript`，未显示 raw message；未知 5xx 未显示错误码或 raw message。

依赖安装尝试：`npm ci` 无法执行，因为该 worktree 没有 `package-lock.json` / `npm-shrinkwrap.json`；未生成或修改锁文件。按约束未运行测试套件。`npm run typecheck` / `npm run api:typecheck` 因缺少本地依赖未执行，待合并到带依赖环境后运行。
