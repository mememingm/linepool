import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import type { ApiRequestOptions } from '../../api/client';
import { workspaceApi as api } from '../../api/query-client';
import { Card } from '../../ui/card';
import { ActionButton, DateText, State, Table } from '../../admin/primitives';
import { CopyValue } from '../../business';
import RecordPagination from '../../workspace-reference/RecordPagination';
import SelectField from '../../SelectField';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { navigate } from '../../../app/router';
import { PcConnectionStatus, pcError } from '../pc-components';
import { canReceive, numberState, NumberStateBadge, PcEmpty, PcFeedback, smsEnabled, usePcMessages, type PcPageProps } from './shared';

export default function MessagesPage({ user, session, connection, numberId }: PcPageProps) {
  const p = useDisplayPreferences();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<5 | 10 | 20>(20);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [waitingUntil, setWaitingUntil] = useState<string | null>(null);
  const [, setClock] = useState(Date.now());
  const now = Date.now();
  const waiting = Boolean(waitingUntil && Date.parse(waitingUntil) > now);
  const selected = session.numbers.find(number => number.id === numberId);
  const canWait = numberId ? Boolean(selected && canReceive(selected, connection, now)) : smsEnabled(connection);
  const messages = usePcMessages(user.id, connection.id, { numberId, page, pageSize }, waiting ? 5_000 : 15_000);
  const waitRequest = useRef<{ numberId: string | null; version: number } | null>(null);
  const version = useRef(0);
  const waitBusy = useRef(false);
  const waitQueue = useRef<Promise<void>>(Promise.resolve());
  const requestWait = useCallback((input: { numberId: string | null; waiting: boolean }, options?: ApiRequestOptions) => {
    const result = waitQueue.current.then(() => api.pcWait(input, options));
    waitQueue.current = result.then(() => {}, () => {});
    return result;
  }, []);
  // A wait belongs to one connection and number; switching either, or leaving the page, ends it.
  useEffect(() => {
    const current = ++version.current;
    setPage(1);
    setWaitingUntil(null);
    setBusy(state => state === 'wait' ? '' : state);
    return () => {
      version.current++;
      const demand = waitRequest.current;
      if (demand?.version === current) {
        waitRequest.current = null;
        void requestWait({ numberId: demand.numberId, waiting: false }, { keepalive: true }).catch(() => {});
      }
    };
  }, [connection.id, numberId, requestWait]);
  useEffect(() => {
    if (!waitingUntil) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitingUntil]);
  async function toggleWait() {
    if (waitBusy.current) return;
    waitBusy.current = true;
    const current = version.current;
    const target = numberId || null;
    const start = !waiting;
    setBusy('wait'); setError(''); setNotice('');
    try {
      const result = await requestWait({ numberId: target, waiting: start });
      if (version.current !== current) {
        if (start) await requestWait({ numberId: target, waiting: false }, { keepalive: true });
        return;
      }
      waitRequest.current = start ? { numberId: target, version: current } : null;
      setWaitingUntil(result.data.waitingUntil); setClock(Date.now());
      setNotice(p.t(start && result.data.waitingUntil ? '已开始等待新验证码' : '等待已结束'));
    } catch (cause) { if (version.current === current) setError(pcError(cause)); }
    finally { waitBusy.current = false; if (version.current === current) setBusy(''); }
  }
  async function markRead(ids: string[]) {
    if (busy || !ids.length) return;
    setBusy('read'); setError(''); setNotice('');
    try { const result = await api.pcRead(ids); await messages.refetch(); setNotice(p.t('已读状态已保存') + ` (${result.data.changed})`); }
    catch (cause) { setError(pcError(cause)); }
    finally { setBusy(''); }
  }
  const rows = messages.data?.data ?? [];
  const unread = rows.filter(message => !message.isRead).map(message => message.id);
  return <>
    <PcFeedback error={error} notice={notice} />
    <div className="lp-agent-account-summary">
      <div><span>{p.t(selected ? '当前号码' : '查看范围')}</span><strong>{selected ? selected.phoneNumber : p.t('全部号码')}</strong></div>
      <div><span>{p.t('短信总数')}</span><strong>{messages.data ? p.n(messages.data.pagination.totalItems) : '—'}</strong></div>
      <div><span>{p.t(selected ? '号码状态' : '连接状态')}</span><strong className="lp-agent-summary-badge">{selected ? <NumberStateBadge state={numberState(selected, now)} /> : <PcConnectionStatus connection={connection} />}</strong></div>
      <div><span>{p.t('等待新验证码')}</span><strong className="lp-agent-summary-small">{waiting ? <>{p.t('等待至')} <DateText value={waitingUntil} /></> : p.t(canWait ? '未开始' : '当前不可等待')}</strong></div>
    </div>
    <Card id="pc-messages" className="lp-admin-section lp-agent-page-card">
      <div className="lp-pc-message-toolbar lp-agent-message-toolbar">
        <SelectField aria-label={p.t('选择取码号码')} value={numberId} onValueChange={value => navigate(value ? `/agent/messages?numberId=${encodeURIComponent(value)}` : '/agent/messages')} options={[{ value: '', label: p.t('全部号码') }, ...session.numbers.map(number => ({ value: number.id, label: number.phoneNumber }))]} />
        <ActionButton variant={waiting ? 'outline' : 'accent'} busy={busy === 'wait'} disabled={Boolean(busy) || (!waiting && !canWait)} onClick={() => void toggleWait()}>{p.t(waiting ? '停止等待' : '等待新验证码')}</ActionButton>
        <ActionButton disabled={Boolean(busy) || !unread.length} busy={busy === 'read'} onClick={() => void markRead(unread)}>{p.t('本页标为已读')}</ActionButton>
        <ActionButton busy={messages.isFetching} onClick={() => void messages.refetch()}><RefreshCw size={15} />{p.t('刷新短信')}</ActionButton>
      </div>
      {waitingUntil && !waiting && <p className="lp-pc-wait" role="status">{p.t('本次等待已到期，可重新开始等待。')}</p>}
      {!canWait && !waiting && <p className="lp-pc-wait" role="status">{p.t(smsEnabled(connection) ? '该号码当前不能等待新验证码，仍可查看历史短信。' : '连接未启用短信验证码，仍可查看历史短信。')}</p>}
      {(messages.isPending || messages.error) && <State loading={messages.isPending} error={messages.error ? pcError(messages.error) : ''} retry={() => void messages.refetch()} />}
      {messages.data && (rows.length ? <Table label="PC 连接短信" columns={[p.t('接收时间'), p.t('号码 / 发信方'), p.t('内容'), p.t('验证码'), p.t('已读状态')]}>{rows.map(message => <tr key={message.id} data-unread={!message.isRead || undefined}>
        <td><DateText value={message.receivedAt} /></td><td><strong>{message.phoneNumber}</strong><small>{message.sender}</small></td><td className="lp-pc-message-body">{message.body}</td>
        <td>{message.verificationCode ? <CopyValue inline value={message.verificationCode} label={p.t('复制验证码')} /> : p.t('未提取验证码')}</td>
        <td>{message.isRead ? p.t('已读') : <ActionButton size="sm" disabled={Boolean(busy)} onClick={() => void markRead([message.id])}>{p.t('标为已读')}</ActionButton>}</td>
      </tr>)}</Table> : <PcEmpty icon={MessageSquare} title="暂无短信记录">{p.t(selected ? '该号码还没有收到短信。' : '同步到本连接的短信会显示在这里。')}</PcEmpty>)}
      <RecordPagination busy={messages.isFetching} page={page} pageSize={pageSize} totalItems={messages.data?.pagination.totalItems ?? 0} totalPages={messages.data?.pagination.totalPages ?? 0} controls="pc-messages" onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
    </Card>
  </>;
}
