import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { detailOptions, listOptions, webhookSummaryOptions } from '../api';
import { useAdminPage } from '../context';
import { Badge, DateText, Drawer, Facts, IconAction, Pager, State, Table, rowClick } from '../primitives';
import type { AdminPageContext } from '../context';

const errors: Record<string, string> = {
  INBOUND_PROCESSING_FAILED: '收信处理失败。请检查服务状态，或稍后重新处理。',
  OUTBOUND_PROCESSING_FAILED: '发送回执处理失败，系统会自动重试。',
  INBOUND_LEASE_NOT_MATCHED: '事件时间内没有匹配到号码或租约。请先同步号码、核对历史租约，再重新处理。',
  OUTBOUND_TASK_NOT_MATCHED: '尚未匹配到对应的发送任务。可等待发送任务保存后重新处理。',
  INBOUND_IDENTITY_OR_WINDOW_CONFLICT: '号码身份或租约时间存在冲突，已隔离；请先核对归属，避免短信进入错误账户。',
  INBOUND_MESSAGE_CONFLICT: '同一上游短信出现不同内容或归属，已隔离。',
  INVALID_RECEIVE_EVENT: '收信事件内容或完整性检查未通过，不能通过重试绕过校验。',
  INVALID_SEND_RECEIPT: '发送回执内容或完整性检查未通过。',
  SEND_RECEIPT_IDENTITY_CONFLICT: '发送号码或收件人和原任务不一致，已隔离。',
  NO_LEASE_AT_RECEIVE_TIME: '事件发生时没有对应的有效租约。',
  ADMIN_RETRY_FAILED: '重新处理时发生异常，请检查服务和处理记录。',
  EVENT_OUTSIDE_LEASE_WINDOW: '事件不在原租约服务时间内，已隔离。',
};
const eventNames: Record<string, string> = { 'sms.received': '收到短信', 'sms.send.status_changed': '发送回执', 'demo.received': '演示收信' };
function EventDetail({ id, close, openAction }: { id: string; close: () => void; openAction: AdminPageContext['openAction'] }) {
  const query = useQuery({ ...detailOptions('webhooks', id), refetchInterval: 5000 }), event = query.data;
  return <Drawer title="事件详情" onClose={close}><State query={query} columns={2} />{event && <>
    <div className="oa-detail-hero"><strong className="oa-mono">{event.eventId}</strong><span>{eventNames[event.eventType] ?? event.eventType} · {event.provider}</span><div><Badge value={event.status} /></div></div>
    {event.lastError && <p className="oa-warning">{errors[event.lastError] ?? event.lastError}</p>}
    {event.conflictCount > 0 && <p className="oa-warning">上游用相同事件 ID 推送过不同内容，共 {event.conflictCount} 次。系统保留首次内容，未覆盖归属或原始正文。</p>}
    {event.retryExhausted && <p className="oa-warning">已达到自动重试上限。请修复对应问题后，手动重新处理。</p>}
    <Facts rows={[["上游账号", event.providerAccountId || '演示'], ["上游号码 ID", event.providerNumberId ?? '—'], ["上游短信 ID", event.providerMessageId ?? '—'],
      ["归属租约", event.leaseId ? <Link to={`/admin/leases?search=${event.leaseId}`}>{event.leaseId}</Link> : '未匹配'],
      ["事件发生", <DateText value={event.occurredAt} />], ["收到时间", <DateText value={event.receivedAt} />], ["处理时间", <DateText value={event.processedAt} />],
      ["下次自动重试", event.retryExhausted ? '已停止自动重试' : <DateText value={event.nextAttemptAt} />], ["累计处理次数", event.attempts]]} />
    {event.retryable && <div className="oa-detail-actions"><Button onClick={() => { close(); openAction({ kind: 'retry', event }); }}><RefreshCw />重新处理</Button></div>}
    <h3>处理记录</h3><p className="oa-context">展示本地保存的处理状态与原因。重新处理仍校验原始内容和历史归属。</p>
    {event.history?.length ? <div className="oa-attempt-list">{event.history.map(attempt => <article key={attempt.id}><div><DateText value={attempt.createdAt} /><span>{attempt.source === "ADMIN" ? "管理员重试" : "后台处理"}</span></div>
      <p><Badge value={attempt.beforeStatus} /> → <Badge value={attempt.afterStatus} /></p>{attempt.error && <small>{errors[attempt.error] ?? attempt.error}</small>}</article>)}</div> : <p className="oa-context">暂无处理记录。</p>}
    <details className="oa-tech"><summary>原始推送内容（可能包含验证码）</summary><pre className="oa-json">{JSON.stringify(event.payload, null, 2)}</pre></details>
  </>}</Drawer>;
}
function localDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(+date) ? new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
}
export function WebhooksPage() {
  const { input, update, openAction } = useAdminPage(), [selected, setSelected] = useState<string | null>(null);
  const result = useQuery({ ...listOptions('webhooks', input), refetchInterval: 10000 });
  const summary = useQuery({ ...webhookSummaryOptions(), refetchInterval: 10000 });
  const counts = summary.data?.counts;
  return <>
    <div className="oa-webhook-counts" aria-label="全部事件状态">{[['PENDING', '待处理'], ['UNMATCHED', '未匹配'], ['FAILED', '处理失败'], ['QUARANTINED', '已隔离'], ['IMPORTED', '已入库'], ['IGNORED', '已忽略']].map(([status, label]) => <button type="button" key={status} data-active={input.status === status || undefined} onClick={() => update('status', input.status === status ? '' : status!)}><span>{label}</span><strong>{counts?.[status!] ?? (summary.isPending ? '…' : '未提供')}</strong></button>)}</div>
    {summary.isError && <p className="oa-error-text" role="status">暂时无法加载事件统计。</p>}
    <section className="oa-card"><div className="oa-webhook-filters">
      <span>本站本地收件箱</span>
      <label>事件类型<select aria-label="事件类型筛选" value={input.eventType ?? ''} onChange={event => update('eventType', event.target.value)}><option value="">全部类型</option><option value="sms.received">收到短信</option><option value="sms.send.status_changed">发送回执</option></select></label>
      <label>接收开始时间<Input type="datetime-local" value={localDate(input.from)} onChange={event => update('from', event.target.value ? new Date(event.target.value).toISOString() : '')} /></label>
      <label>接收结束时间<Input type="datetime-local" value={localDate(input.to)} onChange={event => update('to', event.target.value ? new Date(event.target.value).toISOString() : '')} /></label>
    </div><p className="oa-context oa-pad">未匹配或失败的事件会由后台核对；隔离事件保留原始冲突证据。<Link to="/admin/integrations">查看本站连接与同步 →</Link></p>
      <State query={result} columns={7} empty={result.data?.items.length === 0} />
      {result.data && result.data.items.length > 0 && <Table label="Webhook 事件" columns={['收到时间', '上游 / 类型', '事件 ID', '上游号码 / 短信', '状态', '处理次数', '']}>
        {result.data.items.map(event => <tr key={event.id} className="oa-clickable" onClick={rowClick(() => setSelected(event.id))}>
          <td><DateText value={event.receivedAt} /></td><td>{event.provider.startsWith('demo-inbox:') ? '演示' : event.provider}<small>{eventNames[event.eventType] ?? event.eventType}</small></td>
          <td className="oa-mono">{event.eventId}{event.conflictCount > 0 && <small className="oa-error-text">内容冲突 {event.conflictCount} 次</small>}</td>
          <td className="oa-mono">{event.providerNumberId ?? '—'}<small>{event.providerMessageId ?? '—'}</small></td><td><Badge value={event.status} />{event.retryExhausted && <small className="oa-error-text">自动重试已停止</small>}</td>
          <td className="oa-numeric">{event.attempts}</td><td><IconAction label="查看事件详情" onClick={() => setSelected(event.id)}><Eye /></IconAction></td>
        </tr>)}
      </Table>}
      <Pager data={result.data} onPage={page => update('page', String(page))} />
      {selected && <EventDetail id={selected} close={() => setSelected(null)} openAction={openAction} />}
    </section>
  </>;
}
