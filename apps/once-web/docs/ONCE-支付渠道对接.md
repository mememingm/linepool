# ONCE 支付渠道对接

本轮已实现积分账户、充值与退款业务、租号续租扣分、后台审核及模拟联调。具体支付渠道由同事接入。

## 接入位置

- 适配器：`backend/src/payment.gateway.ts`，在 Nest 注入层替换 `PaymentGateway` 或实现其现有方法。
- 业务服务：`backend/src/points.service.ts`，统一处理到账、流水、冻结和退款。
- 用户与管理员接口：`backend/src/points.controller.ts`。
- 数据结构：`backend/prisma/schema.prisma`；迁移：`backend/prisma/migrations/202611030001_points_wallet/`。

## 同事需要实现

| 方法 | 职责 |
| --- | --- |
| `available`、`provider`、`merchant` | 返回实际渠道可用状态、渠道标识及商户标识 |
| `checkout(order)` | 创建收银单，返回渠道、商户、外部单号及收银链接；使用充值单 UUID 保证渠道端幂等 |
| `queryPayment(order, attempt)` | 服务端查单，返回 `PaymentResult`，包含订单、币种、金额、商户、交易号和支付时间 |
| `refund(order)` | 对原充值发起退款，以退款单 UUID 保证幂等；渠道所需原交易信息可按 `rechargeId` 查库 |
| `queryRefund(order)` | 查明退款结果，返回成功、失败或未知；超时不可当作明确失败 |

支付回调路由由渠道接入方增加。完成验签、商户核对、防重放和金额校验后，调用内部方法 `PointsService.receiveTrustedPayment(eventId, result)`。目前没有公开的支付成功回调路由，不允许由浏览器传入成功状态增加积分。

## 已有行为

- 金额以 USD 分计，积分为整数，1 USD = 100 积分；接口字段 `amountMinor` 与首版积分数相同。
- 写入充值、退款申请、租号及续租的请求使用 `Idempotency-Key`；同一编号不得更换金额或业务内容。
- 已确认支付按事件及交易号防重入账；订单金额或渠道身份不符会留异常记录。
- 充值只增加余额，不自动购买或保留号码；用户确认购买时重新核对库存和价格。
- 租号先冻结积分，履约成功后扣除；明确失败解冻，未知结果保留冻结并查单。
- 现金退款走原充值来源，补偿积分不可提现；退款审核时重验余额，未知退款继续冻结并查单。
- `DEMO` 与 `LIVE` 分开记录。当前适配器只在本地演示模式可用，生产环境拒绝模拟收款；真实渠道接入后还需以真实配置联调。

## 验证与边界

- 在 `backend` 目录执行 `npm run test:points`，会编译后端并创建、迁移和删除一次性本地测试库，不迁移应用库。
- 本轮已验证模拟充值、租号、续租、退款申请与后台审核；真实支付、真实退款和真实上游履约未验收。
- 上线前需完成渠道沙箱与真实小额测试，包含重复回调、金额不符、迟到付款、查单超时和退款未知结果。
