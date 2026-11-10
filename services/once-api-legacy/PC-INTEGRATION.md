# PC 托管账号与 ONCE 短信接入

## 业务边界

PC 面向 B 端，ONCE 运营方使用一个 PC 托管账号管理号码。ONCE 面向 C 端，在本地管理用户、号码使用权和消息权限。100 个 ONCE 用户不需要 100 个 PC 账号。

- `PINGCODE_ACCOUNT_ID` / `PINGCODE_API_KEY`：ONCE 运营方的 PC 账号与服务端凭据。
- `PhoneNumber.providerAccountId` / `providerNumberId`：上游托管账号及号码标识。
- `Lease.userId` / `phoneNumberId` / `startedAt` / `expiresAt`：C 端用户对本地号码的使用关系与时间范围。
- 发信号码由登录用户的租约决定；收信按托管账号、号码及上游短信发生时间归属到历史租约。
- 自动任务仅处理当前配置的托管账号。切换账号不会用新凭据重发旧账号任务。

本次提供服务端运营命令，不增加 C 端配置凭据或自行导入/绑定号码的入口。运行命令需要部署服务器及数据库访问权限。

## 接入条件

1. 运营方的 PC 账号、有效 API Key 和 `/me` 返回的账号 ID。建议使用专属普通用户账号；管理员 Key 的可见范围是 PC 全平台，不应据此把全部号码导入 ONCE。
2. Key 权限：`numbers:read`、`sms:read`、`sms:send`。
3. 至少一个 PC `ACTIVE` 号码，以及 PC 明确返回的资源有效期。上游未返回到期时间时保留为空，不能自动分配给 C 端；缺省到期时间的业务含义继续待定。
4. 已注册的 ONCE 用户、运营方明确指定的使用时间、金额与币种。
5. 公网 HTTPS 地址转发到 ONCE `/api/webhooks/pingcode/receive`，以及 PC 创建收信 Webhook 时返回的密钥。PC 目前的普通用户收信通知应在对应托管账号下配置。

在 `backend/.env` 或部署环境中设置：

```dotenv
PINGCODE_BASE_URL=https://pc.example.com/api/open/v1
PINGCODE_ACCOUNT_ID=12
PINGCODE_API_KEY=pc_live_REPLACE_ON_SERVER
PINGCODE_RECEIVE_WEBHOOK_SECRET=REPLACE_ON_SERVER
```

`PINGCODE_BASE_URL` 必须包含实际部署前缀。凭据仅保存在服务端。修改运行环境后需重启后端。

## 运营步骤

先构建，再检查托管账号与权限：

```powershell
npm --prefix backend run build
npm --prefix backend run pc:operator -- check
```

`check` 只读 `/me`，返回账号、权限、收信密钥是否配置以及回调路径，不返回 API Key 或密钥。账号 ID 与 Key 实际身份不匹配时拒绝执行。发送和状态查询也会验证 `/me`，同一后端进程共享 60 秒校验缓存。

读取 PC 号码并刷新已经导入的资源：

```powershell
npm --prefix backend run pc:operator -- sync
```

首次执行只列出未导入号码。PC 号码对象没有 ONCE 所需的国家/地区字段，所以新导入号码须由运营方提供元数据。将以下数组保存为本地 JSON 文件，替换为真实数据：

```json
[
  {
    "numberId": 101,
    "countryCode": "US",
    "countryName": "美国",
    "regionId": "new-york",
    "regionName": "纽约"
  }
]
```

```powershell
npm --prefix backend run pc:operator -- sync C:/private/once/number-metadata.json
```

同步会遍历上游分页，并在全部响应校验通过后事务写入。仅显式列出的新号码会被导入；新号码为 `OPERATOR_ASSIGNMENT_REQUIRED`，等待运营方绑定，不进入现有演示选号列表。已映射号码会刷新上游状态、资源到期时间和同步时间；不再可见的号码标记为 `UNAVAILABLE`。同步不改变用户归属、租约期限、订单、历史消息或本地短信开关。上游号码 ID 对应的手机号变化时拒绝同步并回滚，留待人工调查。

将使用权安排保存为另一个本地 JSON 文件。下列日期仅演示格式，必须替换为已确认且覆盖当前时间的区间；`termDays` 沿用现有 7 或 30 日租期，起止时间差必须与之对应；`priceMinor` 与 `currency` 必须明确提供，0 也需显式写出：

```json
{
  "reference": "once-assignment-unique-0001",
  "numberId": 101,
  "userEmail": "customer@example.com",
  "startedAt": "2026-10-22T00:00:00Z",
  "expiresAt": "2026-10-29T00:00:00Z",
  "termDays": 7,
  "priceMinor": 0,
  "currency": "USD"
}
```

```powershell
npm --prefix backend run pc:operator -- assign C:/private/once/assignment.json
```

绑定前会重新核对上游账号、号码身份、状态和资源覆盖期；只允许从未绑定过的待分配号码。操作锁定用户与号码，在同一事务中创建租约、占用号码并记录 `PC_NUMBER_ASSIGNED` 审计。同一账号下 `reference` 是稳定操作标识：重复相同请求返回原租约，改变内容则拒绝；并发操作不能重复分配。此命令用于运营方明确分配使用权，不生成订单、支付或已付款证明，也不延长 PC 资源。

在显式区间内、此前因缺少租约而未匹配的收信事件会恢复为可重试，由后台在后续恢复批次中处理。身份或内容冲突隔离的事件不会被自动放行。

## 短信收发与验证

- **发送**：C 端登录 → ONCE 验证本人有效租约 → 共享运营方 Key 调用 PC `/sms/send`。
- **状态**：使用 `/sms/outbound/{messageId}` 查询，不依赖发送 Webhook。`SENT` 不等于 `DELIVERED`。
- **接收**：PC 推送签名 `sms.received` → ONCE 验签、去重 → 根据账号、号码和发生时刻匹配租约 → 用户会话。
- **故障恢复**：已接收事件持久化后可重试；一个用户事件失败不阻塞同批其他用户事件。完全未到达 ONCE 的上游短信仍需后续补拉能力。
- **可选兼容**：`/api/webhooks/pingcode/send` 保留发送项目 JSON 回执接收能力。PC 普通单条发送与发送项目、xin GET 回调协议不同，不能假定单条发送会推送项目事件。

真实联调需确认：ONCE 发出 → 手机收到 → 手机回复 → 对应 ONCE 会话出现回复；另一用户看不到该消息，且发送结果查询正常。

## 保留事项

号码如何成为可售库存、C 端到期保留期、自动回收与重新分配、续费是否联动 PC 资源继续待定。本次不自动放开真实选号、续费、回收、重新绑定、彩信或通话。已有到期保留行为继续使用。
