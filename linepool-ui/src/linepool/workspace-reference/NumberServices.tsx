import { useEffect, useRef, useState } from 'react';
import { BarChart3, Clock3, Database, MessageSquare, Phone, RefreshCw, X } from 'lucide-react';
import { ActionButton } from '../components';
import { StatusPill } from '../../vendor/beautiful/src/components/atoms/StatusPill';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { LinepoolApiError } from '../api/client';
import { createRenewalInputSchema, type AssignedNumber, type CreateRenewalInput, type NumberUsage,
  type PaginatedResponse, type RenewalOptions, type RenewalRecord, type UsageQuota, type UsageScenario } from '../api/contracts';
import { apiMessage, type WorkspaceActions } from './workspace-data';
import './NumberServices.css';

type Selection = { number: AssignedNumber; kind: 'renewal' | 'usage' };
export type NumberServiceSelection = Selection;
type Props = { selection: Selection; userId: string; actions: WorkspaceActions; onClose: () => void };
function storageKey(userId: string, numberId: string) { return `linepool:renewal:${userId}:${numberId}`; }
function readIntent(key: string): CreateRenewalInput | null {
  try { const parsed = createRenewalInputSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null')); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
function saveIntent(key: string, input: CreateRenewalInput | null) {
  try { if (input) sessionStorage.setItem(key, JSON.stringify(input)); else sessionStorage.removeItem(key); }
  catch { /* The mounted form also retains the request key for retries. */ }
}
function SourceNotice({ source, usage = false, loading = false }: { source?: 'mock' | 'live'; usage?: boolean; loading?: boolean }) {
  const p = useDisplayPreferences();
  return <div className="lp-number-service-notice" role="note">
    <StatusPill tone={source === 'mock' ? 'orange' : 'neutral'}>{p.t(source === 'mock' ? '模拟数据' : source === 'live' ? '服务数据' : loading ? '正在确认数据来源' : '数据来源暂不可用')}</StatusPill>
    <p>{p.t(source === 'mock' ? usage ? '以下为本地演示快照，不代表此号码的真实套餐或剩余额度。' : '当前仅保存本地续费申请，价格待确认；未接入支付和真实续费，不会延长有效期。'
      : source === 'live' ? usage ? '用量以服务端最近一次查询结果为准。' : '提交后等待服务端确认，只有续费成功才会更新到期日期。' : loading ? '正在读取服务信息，请稍候。' : '服务信息暂不可用，请重试。')}</p>
  </div>;
}
function RenewalPanel({ number, userId, actions, onBusy }: { number: AssignedNumber; userId: string; actions: WorkspaceActions; onBusy: (busy: boolean) => void }) {
  const p = useDisplayPreferences();
  const key = storageKey(userId, number.id);
  const [pending, setPending] = useState(() => readIntent(key));
  const [options, setOptions] = useState<RenewalOptions | null>(null);
  const [days, setDays] = useState<number | null>(pending?.durationDays ?? null);
  const [tab, setTab] = useState<'apply' | 'records'>('apply');
  const [records, setRecords] = useState<PaginatedResponse<RenewalRecord> | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [optionError, setOptionError] = useState('');
  const [recordError, setRecordError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const refreshed = useRef('');
  const { renewalOptions, renewals, createRenewal, refresh } = actions;
  useEffect(() => {
    const controller = new AbortController();
    setOptions(null); setOptionError('');
    void renewalOptions(number.id, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setOptions(value); setDays(current => value.options.some(option => option.durationDays === current) ? current : value.options[0]?.durationDays ?? null);
    }).catch(failure => { if (!controller.signal.aborted) setOptionError(apiMessage(failure)); });
    return () => controller.abort();
  }, [number.id, renewalOptions, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setRecordError('');
    void renewals(number.id, { page, pageSize: 3 }, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setRecords(value);
      const confirmed = value.data.filter(record => record.status === 'SUCCESS' && record.source === 'live').map(record => record.id).join(',');
      if (confirmed && confirmed !== refreshed.current) { refreshed.current = confirmed; void refresh(); }
    }).catch(failure => { if (!controller.signal.aborted) { setRecords(null); setRecordError(apiMessage(failure)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [number.id, renewals, refresh, page, revision]);
  const selected = options?.options.find(option => option.durationDays === days);
  const openApplication = records?.data.some(record => record.status === 'PENDING');
  async function submit() {
    if (lock.current || (!pending && !selected) || !options) return;
    const input = pending ?? createRenewalInputSchema.parse({ durationDays: days, originalExpiresAt: options.currentExpiresAt, idempotencyKey: crypto.randomUUID() });
    lock.current = true; setBusy(true); onBusy(true); setError(''); setNotice('');
    setPending(input); saveIntent(key, input);
    try {
      const record = await createRenewal(number.id, input);
      setPending(null); saveIntent(key, null);
      setNotice(record.status === 'FAILED' ? '申请处理失败，请查看申请记录。' : record.status === 'SUCCESS' ? '服务端已确认续费成功。' : '申请已保存，状态为待处理；到期日期尚未变更。');
      setTab('records'); setPage(1); setRevision(value => value + 1);
    } catch (failure) {
      setError(failure instanceof LinepoolApiError && failure.code === 'REQUEST_TIMEOUT' ? '续费申请结果待确认，请复用原申请重试，或查看申请记录。' : apiMessage(failure));
      if (failure instanceof LinepoolApiError && failure.status >= 400 && failure.status < 500 && failure.status !== 429) {
        setPending(null); saveIntent(key, null); setPage(1); setRevision(value => value + 1);
        if (failure.code === 'RENEWAL_PENDING') setTab('records');
      }
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  const date = (value: string | null | undefined) => value ? p.date(value) : p.t('待确认');
  return <>
    <div className="lp-number-service-tabs" role="group" aria-label={p.t('续费功能')}>
      <button type="button" disabled={busy} aria-pressed={tab === 'apply'} onClick={() => setTab('apply')}>{p.t('申请续费')}</button>
      <button type="button" disabled={busy} aria-pressed={tab === 'records'} onClick={() => setTab('records')}>{p.t('申请记录')}</button>
    </div>
    <SourceNotice source={options?.source} loading={!options && !optionError} />
    {notice && <p className="lp-number-service-result" role="status">{p.t(notice)}</p>}
    {error && <p className="lp-shell-view-error" role="alert">{p.t(error)}</p>}
    {tab === 'apply' ? <>
      {optionError ? <div role="alert"><p className="lp-shell-view-error">{p.t(optionError)}</p><ActionButton size="sm" onClick={() => setRevision(value => value + 1)}>{p.t('重试')}</ActionButton></div>
        : !options ? <p className="lp-number-service-state" role="status">{p.t('正在加载续费方案…')}</p>
        : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          <dl className="lp-shell-view-facts lp-number-service-facts"><div><dt>{p.t('号码')}</dt><dd className="lp-number-service-phone">{number.phoneNumber}</dd></div><div><dt>{p.t('当前到期日期')}</dt><dd>{date(options.currentExpiresAt)}</dd></div></dl>
          <fieldset className="lp-number-service-durations" disabled={busy || Boolean(pending) || openApplication}>
            <legend>{p.t('续费时长')}</legend>
            {options.options.map(option => <label key={option.durationDays} className={days === option.durationDays ? 'is-selected' : ''}>
              <input type="radio" name="renewal-duration" value={option.durationDays} checked={days === option.durationDays} onChange={() => setDays(option.durationDays)} />
              <strong>{p.n(option.durationDays)} <small>{p.t('天')}</small></strong>
              <span>{option.totalPoints === null ? p.t('待确认') : `${p.n(option.totalPoints)} ${p.t('积分')}`}</span>
            </label>)}
          </fieldset>
          {!options.options.length && <p className="lp-shell-view-meta">{p.t('暂无可用续费方案')}</p>}
          <dl className="lp-shell-view-facts lp-number-service-facts"><div><dt>{p.t('预计新到期日期')}</dt><dd>{date(pending ? null : selected?.estimatedExpiresAt)}</dd></div><div><dt>{p.t('续费价格')}</dt><dd>{selected?.totalPoints == null ? p.t('待确认') : `${p.n(selected.totalPoints)} ${p.t('积分')}`}</dd></div></dl>
          <p className="lp-shell-view-meta">{p.t('预计日期仅供参考，以服务端最终确认的到期日期为准。已过期号码的演示方案从当前时间起估算。')}</p>
          {pending && <p className="lp-number-service-result" role="status">{p.t('上次提交结果待确认，重试会复用原申请。也可在申请记录中核对。')}</p>}
          {openApplication && !pending && <p className="lp-number-service-result" role="status">{p.t('该号码已有待处理申请，可在申请记录中查看。')}</p>}
          <footer className="lp-number-service-footer"><ActionButton type="submit" variant="accent" busy={busy} busyLabel={p.t('正在提交…')} disabled={!pending && (!selected || openApplication || loading || Boolean(recordError))}><Clock3 size={15} />{p.t(pending ? '重试原申请' : options.source === 'mock' ? '提交本地申请' : '提交续费申请')}</ActionButton></footer>
          {recordError && <p className="lp-shell-view-error" role="alert">{p.t('申请记录暂不可用，请刷新后再提交。')}</p>}
        </form>}
    </> : <section aria-label={p.t('续费申请记录')}>
      <div className="lp-number-service-record-heading"><span className="lp-shell-view-meta">{p.t('每页 3 条申请记录')}</span><ActionButton size="xs" variant="quiet" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} />{p.t('刷新')}</ActionButton></div>
      {loading ? <p className="lp-number-service-state" role="status">{p.t('正在加载申请记录…')}</p> : recordError ? <p className="lp-shell-view-error" role="alert">{p.t(recordError)}</p> : !records?.data.length ? <p className="lp-number-service-state">{p.t('暂无续费申请')}</p> : records.data.map(record => <article className="lp-number-service-record" key={record.id}>
        <header><strong>{p.t('续费 {days} 天', { days: p.n(record.durationDays) })}</strong><StatusPill tone={record.status === 'SUCCESS' ? 'green' : record.status === 'FAILED' ? 'red' : 'orange'}>{p.t(record.status === 'SUCCESS' ? '成功' : record.status === 'FAILED' ? '失败' : '待处理')}</StatusPill></header>
        <p className="lp-shell-view-meta">{p.t(record.source === 'mock' ? '本地模拟申请' : '服务申请')} · {p.date(record.createdAt)} · {record.totalPoints === null ? p.t('价格待确认') : `${p.n(record.totalPoints)} ${p.t('积分')}`}</p>
        <p className="lp-shell-view-meta">{p.t('当前到期日期')}：{date(record.originalExpiresAt)}<br />{p.t(record.status === 'SUCCESS' ? '确认到期日期' : '预计新到期日期')}：{date(record.status === 'SUCCESS' ? record.confirmedExpiresAt : record.estimatedExpiresAt)}</p>
        {record.failureReason && <p className="lp-shell-view-error">{record.failureReason}</p>}
        <small className="lp-number-service-record-id" title={record.renewalNumber}>{record.renewalNumber}</small>
      </article>)}
      {records && records.pagination.totalPages > 1 && <div className="lp-number-service-pager"><ActionButton size="xs" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>{p.t('上一页')}</ActionButton><span>{p.n(page)} / {p.n(records.pagination.totalPages)}</span><ActionButton size="xs" disabled={loading || page >= records.pagination.totalPages} onClick={() => setPage(value => value + 1)}>{p.t('下一页')}</ActionButton></div>}
    </section>}
  </>;
}
function QuotaCard({ name, unit, quota, icon: Icon }: { name: string; unit: string; quota: UsageQuota; icon: typeof Phone }) {
  const p = useDisplayPreferences();
  const metered = quota.kind === 'metered';
  const ratio = metered ? quota.total > 0 ? Math.min(100, quota.used / quota.total * 100) : 0 : 0;
  const quantity = (value: number) => `${p.n(value, { maximumFractionDigits: 2 })} ${p.t(unit)}`;
  return <section className="lp-number-service-quota" aria-label={p.t(name)}>
    <header><span><Icon size={16} aria-hidden="true" />{p.t(name)}</span><strong>{metered ? quantity(quota.remaining) : p.t(quota.kind === 'unlimited' ? '不限量' : quota.kind === 'no_package' ? '无套餐' : quota.kind === 'unsupported' ? '不支持查询' : '查询异常')}</strong></header>
    {metered ? <><progress className={ratio >= 90 ? 'is-warning' : ''} aria-label={p.t('{name}使用进度', { name: p.t(name) })} max={100} value={ratio} /><div className="lp-number-service-quota-facts"><span>{p.t('已用')} {quantity(quota.used)}</span><span>{p.t('总量')} {quantity(quota.total)}</span></div><p className="lp-shell-view-meta">{p.t('剩余额度')}：{quantity(quota.remaining)}</p></>
      : quota.kind === 'unlimited' ? <p className="lp-shell-view-meta">{p.t('总量：不限量 · 剩余：不限量')}<br />{quota.used === null ? p.t('已使用量暂不可用') : `${p.t('已用')} ${quantity(quota.used)}`}</p>
        : <p className="lp-shell-view-meta">{p.t(quota.kind === 'no_package' ? '此项目未配置套餐，无可展示的总量、已用量和剩余额度。' : quota.kind === 'unsupported' ? '服务暂不提供此项目的用量查询。' : '暂时无法获取用量，请稍后重试。')}</p>}
  </section>;
}
function UsagePanel({ number, actions }: { number: AssignedNumber; actions: WorkspaceActions }) {
  const p = useDisplayPreferences();
  const [usage, setUsage] = useState<NumberUsage | null>(null);
  const [scenario, setScenario] = useState<UsageScenario>('standard');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { numberUsage } = actions;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setUsage(null);
    void numberUsage(number.id, scenario === 'standard' ? {} : { scenario }, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setUsage(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(apiMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [number.id, scenario, revision, numberUsage]);
  return <>
    <SourceNotice source={usage?.source} usage loading={loading} />
    <div className="lp-number-service-usage-heading"><span className="lp-number-service-phone">{number.phoneNumber}</span><ActionButton size="xs" variant="quiet" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />{p.t('刷新')}</ActionButton></div>
    {usage?.source === 'mock' && <label className="lp-number-service-scenario">{p.t('模拟场景')}<select value={scenario} onChange={event => setScenario(event.target.value as UsageScenario)}>
      {([['standard', '标准套餐'], ['unlimited', '不限量套餐'], ['no_package', '无套餐'], ['unsupported', '不支持查询'], ['error', '接口异常']] as const).map(([value, label]) => <option key={value} value={value}>{p.t(label)}</option>)}
    </select></label>}
    {loading ? <p className="lp-number-service-state" role="status">{p.t('正在查询套餐用量…')}</p> : error ? <div role="alert"><p className="lp-shell-view-error">{p.t(error)}</p><ActionButton size="sm" onClick={() => setRevision(value => value + 1)}>{p.t('重试')}</ActionButton></div> : usage && <div className="lp-number-service-quotas"><QuotaCard name="短信" unit="条" quota={usage.sms} icon={MessageSquare} /><QuotaCard name="语音" unit="分钟" quota={usage.voice} icon={Phone} /><QuotaCard name="流量" unit="MB" quota={usage.data} icon={Database} /></div>}
    <p className="lp-shell-view-meta lp-number-service-updated">{p.t(usage?.source === 'mock' ? '模拟快照更新时间' : '用量最后更新时间')}：{usage?.updatedAt ? <time dateTime={usage.updatedAt}>{p.date(usage.updatedAt)}</time> : p.t('暂无成功更新')}</p>
  </>;
}
export default function NumberServicesDialog({ selection, userId, actions, onClose }: Props) {
  const p = useDisplayPreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  const close = () => { if (!busy.current) onClose(); };
  return <dialog ref={dialog} className="lp-shell-view-confirm-dialog lp-number-service-dialog" aria-labelledby="lp-number-service-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className="lp-shell-view-confirm-header"><div><p className="lp-shell-view-meta">{p.t('号码服务')}</p><h2 id="lp-number-service-title">{selection.kind === 'usage' ? <BarChart3 size={20} aria-hidden="true" /> : <Clock3 size={20} aria-hidden="true" />}{p.t(selection.kind === 'usage' ? '套餐剩余用量' : '号码续费')}</h2></div><ActionButton size="xs" variant="quiet" title={p.t('关闭')} aria-label={p.t('关闭')} onClick={close}><X size={17} /></ActionButton></header>
    {selection.kind === 'usage' ? <UsagePanel number={selection.number} actions={actions} /> : <RenewalPanel number={selection.number} userId={userId} actions={actions} onBusy={value => { busy.current = value; }} />}
  </dialog>;
}
