import { useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronDown, Copy, FileJson, KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminUpstreamStatus } from '@linepool/contracts/admin';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { adminHref } from './navigation';
import './integration.css';

function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const p = useDisplayPreferences();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); toast.success(p.t("已复制")); }
    catch { toast.error(p.t("复制失败，请手动选择内容复制。")); }
  }
  return <Button type="button" variant="outline" className="lp-admin-button" onClick={() => void copy()} aria-label={label}>
    {copied ? <Check size={15} /> : <Copy size={15} />}{label}
  </Button>;
}
function CodeBlock({ children, label }: { children: string; label: string }) {
  const p = useDisplayPreferences();
  return <div className="lp-api-code"><div><span>{label}</span><CopyButton value={children} label={p.t("复制代码")} /></div><pre><code>{children}</code></pre></div>;
}
function ContractNote() {
  const p = useDisplayPreferences();
  return <div className="lp-integration-note"><ShieldCheck size={18} aria-hidden="true" /><p><strong>{p.t("上游契约待确认")}</strong>{p.t("LP 接收入口已实现。带项目标识的请求结构、全平台推送权限及签名规范，仍需与 PC 确认后再开展正式联调。")}</p></div>;
}

export function WebhookManagement({ status, children }: { status: AdminUpstreamStatus; children: ReactNode }) {
  const { webhook, receipts } = status;
  const p = useDisplayPreferences();
  const endpoint = `${window.location.origin}${webhook.path}`;
  const date = (value: string | null) => value ? p.date(value, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : p.t("暂无记录");
  return <div className="lp-integration-page">
    <div className="lp-integration-intro"><p>{p.t("管理 PC 推送到 LINEPOOL 的短信接收入口与处理记录。")}</p><a href={adminHref('api-docs')}><BookOpen size={16} />{p.t("查看 API 文档")}<ArrowRight size={15} /></a></div>
    <ContractNote />
    <section className="lp-webhook-card" aria-labelledby="lp-webhook-receive-title">
      <div className="lp-webhook-card-label"><span className="lp-webhook-icon"><ArrowDownToLine size={23} /></span><span className="lp-integration-eyebrow">PC → LINEPOOL</span><h2 id="lp-webhook-receive-title">{p.t("接收 Webhook")}</h2><p>{p.t("上游收到新短信时，将事件推送到此地址。LP 验签后保存，并匹配号码、平台和用户服务。")}</p><span className="lp-admin-status" data-tone={webhook.secretConfigured ? 'success' : 'warning'}>{webhook.secretConfigured ? p.t("接收入口已启用") : p.t("未配置签名密钥")}</span></div>
      <div className="lp-webhook-card-body"><div className="lp-webhook-address-heading"><strong>{p.t("接收地址")}</strong><span className="lp-integration-method">POST</span></div>
        <div className="lp-webhook-address"><Input aria-label={p.t("Webhook 接收地址")} readOnly value={endpoint} onFocus={event => event.currentTarget.select()} /><CopyButton value={endpoint} label={p.t("复制地址")} /></div>
        <p className="lp-integration-caption">{p.t("当前站点地址。正式联调时，请将可被 PC 访问的 HTTPS 地址配置到上游；本机地址仅用于本地联调。")}</p>
        <details className="lp-webhook-details">
          <summary><span>{p.t("接入详情")}</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <dl className="lp-webhook-settings"><div><dt>{p.t("订阅事件")}</dt><dd><code>sms.received</code><span>{p.t("收到短信")}</span></dd></div><div><dt>{p.t("请求签名")}</dt><dd>HMAC-SHA256<span>{p.t("时间戳有效窗口 ±")}{webhook.replayWindowSeconds}{p.t(" 秒")}</span></dd></div><div><dt>{p.t("签名密钥")}</dt><dd>{webhook.secretConfigured ? p.t("已配置 · 密钥不回传") : p.t("未配置 · 入口返回 503")}<span>{p.t("服务端配置 PINGCODE_WEBHOOK_SECRET，修改后重启后端")}</span></dd></div><div><dt>{p.t("处理策略")}</dt><dd>{p.t("先保存，再匹配归属")}<span>{webhook.secretConfigured ? p.t("未匹配记录每 {value1} 秒自动重新处理，单轮最多 100 条", { value1: webhook.retryIntervalSeconds }) : p.t("配置密钥并重启后启用自动处理；已保存记录仍可手动处理")}</span></dd></div><div><dt>{p.t("上游 API")}</dt><dd>{p.t("读取传输：{transport}", { transport: status.providerTransport })}<span>{p.t("代理连接的授权与轮询状态请查看 PC 连接。")}</span></dd></div></dl>
        </details>
      </div>
    </section>
    <section className="lp-webhook-metrics" aria-label={p.t("PC 接收统计")}>{[
      [p.t("已保存短信"), receipts.total, p.t("通过验签的唯一短信")], [p.t("已分发"), receipts.imported, p.t("已进入对应用户收件箱")],
      [p.t("待处理"), receipts.pending, p.t("已保存，等待归属处理")], [p.t("未匹配"), receipts.unmatched, p.t("需核对项目、号码与服务期")],
    ].map(([label, value, hint]) => <div key={String(label)}><span>{label}</span><strong>{Number(value).toLocaleString()}</strong><small>{hint}</small></div>)}</section>
    <section className="lp-webhook-records" aria-labelledby="lp-webhook-records-title"><div className="lp-admin-section-heading"><h2 id="lp-webhook-records-title">{p.t("接收记录")}</h2><span>{receipts.eventCount.toLocaleString()}{p.t(" 个事件 · ")}{receipts.deliveryCount.toLocaleString()}{p.t(" 次投递 · 同事件重投 ")}{receipts.redeliveryCount.toLocaleString()}{p.t(" 次")}</span></div>
      <p className="lp-admin-context">{p.t("最近短信保存：")}{date(receipts.lastReceivedAt)}{p.t(" · 最近处理：")}{date(receipts.lastProcessedAt)}{p.t("。仅展示 PC 业务事件；连通性检查与验签失败不会写入此列表。")}</p>{children}
    </section>
  </div>;
}

const payload = JSON.stringify({
  eventId: 'pc-event-001', event: 'sms.received', occurredAt: '2026-03-14T08:30:00.000Z',
  data: { messageId: 'pc-message-001', projectId: 'telegram-project', numberId: 'pc-number-001',
    phoneNumber: '+15551234567', from: 'Telegram', content: 'Your verification code is 123456' },
}, null, 2);
const signatureExample = `import { createHmac, randomUUID } from 'node:crypto';

const endpoint = process.env.LP_WEBHOOK_URL;
const secret = process.env.PINGCODE_WEBHOOK_SECRET;
if (!endpoint || !secret) throw new Error('Set LP_WEBHOOK_URL and PINGCODE_WEBHOOK_SECRET');

// Signed connection check: does not save a message or trigger routing.
const eventId = randomUUID();
const body = JSON.stringify({
  eventId,
  event: 'sms.received',
  occurredAt: new Date().toISOString(),
  test: true,
});
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = 'sha256=' + createHmac('sha256', secret)
  .update(timestamp + '.' + body)
  .digest('hex');
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-PingCode-Timestamp': timestamp,
    'X-PingCode-Signature': signature,
    'X-PingCode-Event-Id': eventId,
  },
  body,
});
console.log(response.status, await response.text());`;
const upstreamReads = [
  ['GET', '/numbers', '已有号码列表', 'limit、cursor；page.hasMore、page.nextCursor'],
  ['GET', '/sms', '收到的短信', 'direction=INBOUND、createdAfter、cursor'],
];
const fields = [
  ['eventId', 'string', '必须', '1–200 字符；与 X-PingCode-Event-Id 一致'],
  ['event', 'string', '必须', '固定为 sms.received'],
  ['occurredAt', 'datetime', '必须', '包含时区的 ISO 8601；短信原始接收时间，不得晚于 LP 时钟 5 分钟'],
  ['test', 'boolean', '可选', 'true 表示连通性检查，必须放入已签名的正文'],
  ['data.messageId', 'string', '业务事件必须', '唯一短信 ID，1–200 字符'],
  ['data.projectId', 'string / integer', '业务事件必须', '可信项目标识；整数需为安全正整数'],
  ['data.numberId', 'string / integer', '业务事件必须', '上游号码标识；整数需为安全正整数'],
  ['data.phoneNumber', 'string', '业务事件必须', '带 + 的国际号码，7–15 位数字'],
  ['data.from', 'string', '业务事件必须', '发信方，最长 500 字符，允许空串'],
  ['data.content', 'string', '业务事件必须', '短信正文，最长 16,000 字符；仍受请求体上限约束'],
];
const errors = [
  ['200', 'received: true', '验签并保存成功；或已通过签名的连通性检查。未匹配归属也返回 200'],
  ['400', 'INVALID_JSON / VALIDATION_ERROR / WEBHOOK_EVENT_ID_MISMATCH / WEBHOOK_TIME_INVALID', '正文结构、事件 ID 或业务事件时间不符合要求'],
  ['401', 'WEBHOOK_SIGNATURE_INVALID', '签名错误、缺少签名或时间戳超过 ±300 秒'],
  ['409', 'PROVIDER_EVENT_CONFLICT / PROVIDER_MESSAGE_CONFLICT', '事件 ID 被复用，或短信 ID 对应的内容、项目等发生变化'],
  ['413', 'PAYLOAD_TOO_LARGE', '整个 JSON 请求体超过 16 KiB'],
  ['415', 'WEBHOOK_JSON_REQUIRED / WEBHOOK_ENCODING_UNSUPPORTED', '请使用 application/json；不支持压缩请求体'],
  ['429', 'RATE_LIMITED', '请求过于频繁；按实际响应中的 Retry-After 等待'],
  ['500', 'INTERNAL_ERROR', 'LP 内部处理异常，保留事件标识并重试'],
  ['503', 'WEBHOOK_NOT_CONFIGURED / DATABASE_UNAVAILABLE', '签名密钥未配置，或数据库暂时不可用'],
];
function ReferenceTable({ headings, rows }: { headings: string[]; rows: string[][] }) {
  return <div className="lp-api-reference-table" role="region" tabIndex={0} aria-label={headings.join('、')}><table><thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row[0] + row[1]}>{row.map((cell, index) => <td key={index}>{index === 0 ? <code>{cell}</code> : cell}</td>)}</tr>)}</tbody></table></div>;
}
export function ApiDocumentation() {
  const p = useDisplayPreferences();
  const endpoint = `${window.location.origin}/api/webhooks/pingcode`;
  return <div className="lp-integration-page">
    <div className="lp-integration-intro"><p>{p.t("PC 与 LINEPOOL 上游对接参考 · 当前 LP 实现")}</p><a href={adminHref('webhooks')}>{p.t("查看 Webhook 状态")}<ArrowRight size={15} /></a></div><ContractNote />
    <div className="lp-api-layout"><nav className="lp-api-toc" aria-label={p.t("API 文档目录")}><span>{p.t("对接指南")}</span>{[
      ['overview', p.t("接入概览")], ['pc-api', p.t("PC API 读取能力")], ['webhook', p.t("Webhook 接收接口")], ['signature', p.t("签名与连通性检查")], ['routing', p.t("去重与归属处理")], ['responses', p.t("响应与错误")], ['pending', p.t("正式联调待确认")],
    ].map(([id, label]) => <a key={id} href={`#lp-api-${id}`}>{label}</a>)}</nav>
    <article className="lp-api-document">
      <section id="lp-api-overview"><span className="lp-integration-eyebrow">INTEGRATION GUIDE</span><h2>{p.t("上游 API 与 Webhook")}</h2><p>{p.t("LP 通过 PinClode 应用授权连接 PC，后台轮询同步号码和短信，页面读取本地数据。实际传输由服务端配置；下图与以下 Webhook 说明保留为历史接收契约。")}</p><div className="lp-api-flow"><span>{p.t("PC 上游")}</span><ArrowRight size={18} /><code>sms.received</code><ArrowRight size={18} /><span>{p.t("LP 验签 · 保存 · 匹配用户")}</span></div><p>{p.t("后台 API 使用管理员会话；PC 推送入口使用 HMAC 签名。此页面面向上游联调，不提供代理或客户的对外 API Key。")}</p></section>
      <section id="lp-api-pc-api"><h2><KeyRound size={20} />{p.t("PC API 读取能力")}</h2><p>{p.t("以下路径来自 PinClode 应用 API，相对于 ")}<code>/api/app/v1</code>{p.t("。服务端使用每个连接的访问令牌：")}<code>Authorization: Bearer &lt;accessToken&gt;</code>{p.t("。代理通过 PinClode 登录；应用密钥和访问令牌由服务端管理。")}</p><ReferenceTable headings={[p.t("方法"), p.t("相对路径"), p.t("用途"), p.t("关键字段 / 参数")]} rows={upstreamReads} /><p className="lp-integration-caption">{p.t("号码购买、上游续期与划拨在 PC 完成。LP 自营接码须等待可信的平台项目标识协议确认。")}</p></section>
      <section id="lp-api-webhook"><h2><FileJson size={20} />{p.t("Webhook 接收接口")}</h2><div className="lp-api-endpoint"><span className="lp-integration-method">POST</span><code>{endpoint}</code><CopyButton value={endpoint} label={p.t("复制地址")} /></div><p>{p.t("请求类型为 ")}<code>application/json</code>{p.t("，整个请求体上限 16 KiB，不支持压缩正文。下例为业务事件；联调时需替换为真实绑定的项目、号码和接收时间。")}</p><CodeBlock label={p.t("业务事件 JSON")} >{payload}</CodeBlock><ReferenceTable headings={[p.t("字段"), p.t("类型"), p.t("要求"), p.t("说明")]} rows={fields} /></section>
      <section id="lp-api-signature"><h2>{p.t("签名与连通性检查")}</h2><ReferenceTable headings={[p.t("请求头"), p.t("取值")]} rows={[
        ['Content-Type', 'application/json'], ['X-PingCode-Timestamp', p.t("10 位 Unix 时间戳，单位为秒，允许与 LP 时钟偏差 ±300 秒")], ['X-PingCode-Event-Id', p.t("与正文 eventId 完全一致")], ['X-PingCode-Signature', p.t("sha256= + 64 位十六进制 HMAC")],
      ]} /><CodeBlock label={p.t("签名规则")}>{'signature = "sha256=" + HMAC_SHA256(secret, timestamp + "." + rawBody).hex()'}</CodeBlock><p>{p.t("签名使用发送时的原始 UTF-8 字节。生成签名后，请直接发送同一份正文；重新格式化 JSON 会改变签名。服务端的 ")}<code>PINGCODE_WEBHOOK_SECRET</code>{p.t(" 必须为 32–512 字节，双方通过独立渠道约定，不随请求传输。")}</p><p>{p.t("下面的 Node.js 示例仅发送 ")}<code>test: true</code>{p.t(" 连通性检查，不入库、不分发短信。先设置 ")}<code>LP_WEBHOOK_URL</code>{p.t(" 与相同的签名密钥，再运行示例。")}</p><CodeBlock label={p.t("Node.js · 签名连通性检查")}>{signatureExample}</CodeBlock></section>
      <section id="lp-api-routing"><h2>{p.t("去重与归属处理")}</h2><ol><li>{p.t("验证签名、时间戳、事件 ID 和请求结构，再持久化保存事件与短信。")}</li><li>{p.t("同一事件 ID 只能关联一条短信。同一短信 ID 的项目、号码、发信方、内容和原始接收时间必须一致；一致的重投不会创建重复短信。")}</li><li>{p.t("按可信项目、号码与原始接收时间匹配唯一的用户服务，使用接收时的有效归属处理迟到推送。")}</li><li>{p.t("未匹配事件会被保留并返回确认，接收密钥配置并重启后，每 30 秒自动扫描重试，单轮最多 100 条；管理页也可填写原因后手动重新处理。")}</li></ol><p>{p.t("服务有效期为开始时间包含、到期或释放时间不包含。没有唯一归属时，短信不会进入任何用户收件箱。")}<code>received: true</code>{p.t(" 表示已确认保存，不保证已经分发。")}</p></section>
      <section id="lp-api-responses"><h2>{p.t("响应与错误")}</h2><CodeBlock label={p.t("成功响应 · HTTP 200")}>{'{ "received": true }'}</CodeBlock><ReferenceTable headings={[p.t("HTTP 状态"), p.t("返回内容 / 错误码"), p.t("含义")]} rows={errors} /><p>{p.t("若发送后未收到确认，应保留原事件 ID、短信 ID、业务内容和原始接收时间，使用新的投递时间戳重新签名后重试。网络重试间隔及最大重试次数仍需双方确认。")}</p></section>
      <section id="lp-api-pending"><h2>{p.t("正式联调待确认")}</h2><ul><li>{p.t("PC 是否支持当前账号覆盖全部所需号码，以及全平台 Webhook 推送权限。")}</li><li>{p.t("PC 是否提供可信 projectId 或等价的平台标识，及其与 LP 平台配置的对应关系。")}</li><li>{p.t("PC 是否接受本页请求体和签名规则，事件 ID、短信 ID 的唯一范围及重试约定。")}</li><li>{p.t("测试账号、正式 HTTPS 接收地址，以及采购、报价、分配、释放和补偿查询能力。")}</li></ul><a className="lp-api-next" href={adminHref('webhooks')}>{p.t("查看配置状态与接收记录")}<ArrowRight size={16} /></a></section>
    </article></div>
  </div>;
}
