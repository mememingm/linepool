# LP 对接 PC 联调页

用 LP 的视角测试 PC：主动查询接码项目和账号号码，接收 PC 实际发送的短信 Webhook，并查看原始响应。

```powershell
node D:/llinepool/webhook-lab/webhook-lab.mjs
```

打开 http://127.0.0.1:8890/ 。

1. 填当前有效的 PC API Key，点击「查询项目」或「查询账号号码」。查询会实际请求 PC，展示 HTTP 状态、原始返回，以及号码状态、资源到期时间；失败不会展示为成功或空列表。
2. 展开「接口地址」可以填写 PC 最新提供的查询路径。API 根地址默认 `http://120.55.75.51/pingcode/api/open/v1`，账号号码默认 `/numbers?limit=50`。当前公开说明尚未列出接码项目查询接口，因此项目路径默认留空；需填写上司提供的实际路径，不用短信发送项目 `/sms/projects` 代替。
3. 将可达的 LP 公网接收地址填到 PC「接收 Webhook」，并将 PC 生成的签名密钥填入本页保存。这把密钥与 API Key 不同。
4. 在 PC 测试推送或触发真实短信。在本页查看原始正文、验签结果、保存结果，并与本次号码查询结果对照。号码对照只针对返回的当前页；缺少 `projectId` 时明确显示无法核对平台归属。

查询使用 GET，作用是读取 PC 数据；Webhook 则是 PC 向 LP 的 `/api/webhooks/pingcode` 发 POST。页面没有发送短信、创建项目或购买号码的功能。

## 公网接收

线上 PC 无法访问本机的 `127.0.0.1:8890`。需要将真实公网域名的 `/api/webhooks/pingcode` 转发到这里。在页面填写 URL 仅用于记录/复制地址，不会自动建立转发。尚未接通公网时，页面明确提示，不能当作线上回调验收通过。

只有接收路径用于外部投递，管理页保留在本机。按 PC 当前说明，用 `HMAC-SHA256(secret, timestamp + '.' + 原始请求体)` 校验 `X-PingCode-Signature`；本工具采用 5 分钟时间窗。同一事件重复推送返回 200、不重复保存事件。

API Key 和回调签名密钥只保存在进程内，重启后重新填写。可用环境变量 `PINGCODE_API_KEY`、`PINGCODE_API_ROOT`、`PINGCODE_PROJECT_PATH`、`PINGCODE_WEBHOOK_SECRET`、`PINGCODE_WEBHOOK_URL` 设置启动值。接口路径、最近查询及接收证据保存在 `.local/pc-live`，浏览器展示最近 300 次回调尝试。

该工具的回调返回 200 表示已保存到测试接收端，不代表正式 LP 用户收件箱已入库，也不代表订单或平台映射完成。PC 的测试事件也不代表真实收到验证码。
