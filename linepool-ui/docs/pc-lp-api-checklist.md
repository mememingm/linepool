# PC-LP API 对接清单

## 1. PC 提供：项目列表

```http
GET /api/projects
```

### 返回

```json
{
  "items": [
    {
      "projectId": "project_telegram_001",
      "name": "Telegram",
      "platform": "telegram",
      "status": "active"
    }
  ]
}
```

必需字段：`projectId`、`platform`、`status`。

## 2. PC 提供：项目号码列表

```http
GET /api/projects/{projectId}/numbers?status=available
```

### 返回

```json
{
  "projectId": "project_telegram_001",
  "items": [
    {
      "numberId": "number_10001",
      "phoneNumber": "+12025550100",
      "status": "available",
      "availableUntil": "2026-02-01T00:00:00Z"
    }
  ]
}
```

必需字段：`projectId`、`numberId`、`phoneNumber`、`status`、`availableUntil`。

如果一个号码支持多个项目，PC 应在不同项目下返回对应关系。

## 3. LP 提供给 PC：短信 Webhook

```http
POST /api/webhooks/pingcode
Content-Type: application/json
X-Webhook-Timestamp: 1767268800
X-Webhook-Signature: sha256=...
```

### 请求参数

```json
{
  "eventId": "evt_000001",
  "event": "sms.received",
  "occurredAt": "2026-01-01T12:00:00Z",
  "data": {
    "projectId": "project_telegram_001",
    "numberId": "number_10001",
    "phoneNumber": "+12025550100",
    "messageId": "msg_000001",
    "from": "+8613800138000",
    "content": "Your code is 123456"
  }
}
```

必需字段：

| 字段 | 要求 |
|---|---|
| `eventId` | 事件唯一 ID，重试时保持不变 |
| `event` | 固定使用 `sms.received` |
| `occurredAt` | PC 产生事件的时间，ISO 8601 |
| `projectId` | 项目唯一 ID |
| `numberId` | 号码唯一 ID |
| `phoneNumber` | E.164 格式 |
| `messageId` | 短信唯一 ID |
| `from` | 发送方号码 |
| `content` | 短信正文 |

### LP 返回

成功或重复事件：

```http
200 OK
```

```json
{
  "success": true,
  "eventId": "evt_000001"
}
```

签名错误：`401`；参数错误：`400`；LP 暂时不可用：`5xx`。

## 4. PC 提供：短信补偿查询（推荐）

用于 Webhook 丢失、重试失败或历史对账。

```http
GET /api/messages/{messageId}
```

### 返回

```json
{
  "messageId": "msg_000001",
  "projectId": "project_telegram_001",
  "numberId": "number_10001",
  "phoneNumber": "+12025550100",
  "from": "+8613800138000",
  "content": "Your code is 123456",
  "occurredAt": "2026-01-01T12:00:00Z"
}
```

如果 Webhook 已经直接包含 `content`，此接口只用于补偿和查询。

## 5. PC 提供：号码状态变化通知（推荐）

仍使用 LP Webhook：

```json
{
  "eventId": "evt_000002",
  "event": "number.status_changed",
  "occurredAt": "2026-01-01T13:00:00Z",
  "data": {
    "projectId": "project_telegram_001",
    "numberId": "number_10001",
    "phoneNumber": "+12025550100",
    "status": "expired",
    "reason": "租期结束"
  }
}
```

支持的状态至少包括：

```text
available
assigned
expired
released
disabled
```



## 7. 供货模式只需确认一种

### 批量供号

PC 提供项目和号码清单，LP 自行销售和分配。



```

## 8. PC 需要回复确认的最小问题

1. 项目列表接口是什么？
2. 项目号码列表接口是什么？
3. `projectId`、`numberId`、`messageId` 是否永久唯一？
4. Webhook 是否直接返回短信正文？
7. 号码过期、释放、禁用如何通知？
