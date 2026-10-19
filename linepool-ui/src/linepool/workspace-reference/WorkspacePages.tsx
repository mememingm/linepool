import { DisplaySettings } from '../preferences/DisplayControls';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, Inbox, LogOut, MessageCircle, Minus, Pencil, Plus, RefreshCw, Search, Smartphone, WalletCards } from 'lucide-react';
import { CopyValue } from '../business';
import { ActionButton, OrderStatusPill, fulfillmentDisplay } from '../components';
import { StatusPill } from '../../vendor/beautiful/src/components/atoms/StatusPill';
import UserAvatar from '../UserAvatar';
import { Flag } from '../showcase/shared';
import { type NumbersQuery, type Order, type OrderDetail } from '../api/contracts';
import { apiMessage, type WorkspaceActions, type WorkspaceData } from './workspace-data';
import { detailHref, isDetailRoute, shellHref, shellPageTitle, type ShellRoute } from './navigation';
import { navigate } from '../../app/router';
import { catalogDetailTitle, detailCopy, regionPageTitle } from './detail-data';
import WorkspaceDetails, { ServiceLabel } from './WorkspaceDetails';
import AccountProfileSettings from './AccountProfileSettings';
import RegionSelect from './RegionSelect';
import InboxNumberSelect from './InboxNumberSelect';
import SelectField from '../SelectField';
import RecordPagination from './RecordPagination';
import NumberRecordsTransition from './NumberRecordsTransition';
import { useRecordPagination } from './useRecordPagination';
import './WorkspacePages.css';
import PurchasePage from './PurchasePage';
import PlatformSmsNotice from './PlatformSmsNotice';
import SandboxTools from './SandboxTools';

type PageProps = { data: WorkspaceData; actions: WorkspaceActions; route: ShellRoute };
function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="lp-shell-view-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="lp-shell-view-empty" role="status"><Inbox size={30} strokeWidth={1.3} aria-hidden="true" /><p>{title}</p>{children}</div>;
}
function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="lp-shell-view-link" href={href}>{children}<ArrowRight size={15} aria-hidden="true" /></a>;
}
function useMutation() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(task: () => Promise<unknown>) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await task(); return true; }
    catch (failure) { setError(apiMessage(failure)); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, run };
}
// The API does not search translated region names or cross-field phrases.
function needsClientSearch(query: string, data: WorkspaceData, t: (source: string) => string) {
  return query.length > 200 || query.includes(' ') || Boolean(query) && data.catalog.regions.some(item => t(item.name) !== item.name && t(item.name).toLowerCase().includes(query));
}
function NumbersPage({ data, actions, route }: PageProps) {
  const p = useDisplayPreferences();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<'all' | NonNullable<NumbersQuery['status']>>('all'); const [region, setRegion] = useState(route.region);
  const query = search.trim().toLowerCase();
  const filtered = data.numbers.filter(number => (!route.number || number.id === route.number) && (!region || number.region === region) && (status === 'all' || (status === 'expiring' ? number.status === 'ACTIVE' && number.remainingDays <= 3 : number.status === status)) && `${number.phoneNumber} ${number.country} ${p.t(number.country)} ${number.service}`.toLowerCase().includes(query));
  const regionId = data.catalog.regions.find(item => item.id === region)?.id;
  const clientSearch = Boolean(route.number) || needsClientSearch(query, data, p.t) || Boolean(region && !regionId);
  const loadPage = useCallback((page: number, pageSize: number, signal: AbortSignal) => actions.listNumbers({ page, pageSize, search: query, region: regionId, status: status === 'all' ? undefined : status }, { signal }), [actions.listNumbers, query, regionId, status]);
  const records = useRecordPagination(loadPage, JSON.stringify([search, status, region, p.locale]), data.numbers, clientSearch ? filtered : undefined, { keepPreviousItems: true, scrollToTopOnPagination: false });
  return <div ref={records.listRef} className="lp-shell-records lp-shell-records-numbers">
    <PlatformSmsNotice />
    <p className="lp-shell-view-meta lp-number-service-policy">{p.t('短期短信接收服务：服务期限内由平台分配号码，仅支持接收短信，不支持发送短信或续费。')}</p>
    <div className="lp-shell-view-toolbar"><SearchField label={p.t("搜索号码、地区或服务")} value={search} onChange={setSearch} /><SelectField aria-label={p.t("号码状态")} value={status} onValueChange={value => setStatus(value as typeof status)} options={[{ value: 'all', label: p.t("全部状态") }, { value: 'ACTIVE', label: p.t("使用中") }, { value: 'expiring', label: p.t("即将到期 · 3 天内") }, { value: 'EXPIRED', label: p.t("已过期") }]} /><SelectField aria-label={p.t("号码地区")} value={region} onValueChange={setRegion} options={[{ value: '', label: p.t("全部地区") }, ...data.catalog.regions.map(item => ({ value: item.id, label: p.t(item.name) }))]} /><span className="lp-shell-view-count">{p.t("{count} 个号码", { count: p.n(records.totalItems) })}</span><PageLink href={shellHref('purchase')}>{p.t("购买服务")}</PageLink></div>
    <NumberRecordsTransition busy={records.busy}>
      {records.busy && !records.items.length ? <EmptyState title={p.t("正在加载")} /> : records.error ? <EmptyState title={p.t(records.error)}><ActionButton size="sm" onClick={records.retry}>{p.t("重试")}</ActionButton></EmptyState> : !records.items.length ? <EmptyState title={p.t("暂无符合条件的号码")}><ActionButton size="sm" onClick={() => { setSearch(''); setStatus('all'); setRegion(''); if (route.number) navigate(shellHref('numbers')); }}>{p.t("清除筛选")}</ActionButton></EmptyState> : <div className="lp-shell-view-table-scroll" tabIndex={0} role="region" aria-label={p.t("号码列表")}><table className="lp-shell-view-table"><thead><tr><th scope="col">{p.t("号码")}</th><th scope="col">{p.t("地区 / 服务")}</th><th scope="col">{p.t("有效期")}</th><th scope="col">{p.t("短信")}</th><th scope="col">{p.t("状态")}</th><th scope="col">{p.t("操作")}</th></tr></thead><tbody>{records.items.map(number => <tr key={number.id}><td><div className="lp-shell-number-cell"><strong className="lp-shell-view-phone">{number.phoneNumber}</strong><CopyValue labels={p.copyLabels} value={number.phoneNumber} label={p.t("复制号码")} /></div></td><td><div className="lp-shell-view-country"><Flag code={number.region} />{p.t(number.country)}</div><ServiceLabel service={number.service} /></td><td>{p.date(number.expiresAt, { year: 'numeric', month: '2-digit', day: '2-digit' })}<small className={number.status === 'ACTIVE' && number.remainingDays <= 3 ? 'lp-shell-view-warning' : ''}>{number.status === 'ACTIVE' ? p.t("{days} 天后到期", { days: p.n(number.remainingDays) }) : p.t("有效期已结束")}</small></td><td>{p.n(number.messageCount)}{' '}{p.t("条")}<small>{!number.messageCount ? p.t("暂无短信") : number.unreadCount ? p.t("{count} 条未读", { count: p.n(number.unreadCount) }) : p.t("全部已读")}</small></td><td><StatusPill tone={number.status === 'EXPIRED' ? 'neutral' : number.remainingDays <= 3 ? 'orange' : 'green'}>{number.status === 'EXPIRED' ? p.t("已过期") : number.remainingDays <= 3 ? p.t("即将到期") : p.t("使用中")}</StatusPill></td><td><PageLink href={shellHref('inbox', { number: number.id, allocation: number.allocationId })}>{p.t("收件箱")}</PageLink></td></tr>)}</tbody></table></div>}
    </NumberRecordsTransition>
    <RecordPagination page={records.page} pageSize={records.pageSize} totalPages={records.totalPages} totalItems={records.totalItems} busy={records.busy} controls="lp-shell-number-records" onPageChange={records.setPage} onPageSizeChange={records.setPageSize} />
  </div>;
}
function InboxPage({ data, actions, route, lastUpdated }: PageProps & { lastUpdated: number | null }) {
  const p = useDisplayPreferences();
  const [search, setSearch] = useState(''); const [numberId, setNumberId] = useState(route.number); const [status, setStatus] = useState('all'); const [selectedId, setSelectedId] = useState(route.message);
  const mutation = useMutation(); const query = search.trim().toLowerCase();
  const numberServices = new Map(data.numbers.map(number => [number.id, number.service]));
  const allocationId = numberId === route.number && route.allocation
    ? route.allocation : data.numbers.find(number => number.id === numberId)?.allocationId;
  const filtered = data.messages.filter(message => (!numberId || message.numberId === numberId)
    && (!numberId || !allocationId || message.allocationId === allocationId)
    && (status !== 'unread' || !message.isRead)
    && `${message.sender} ${numberServices.get(message.numberId) ?? ''} ${message.verificationCode ?? ''} ${message.body} ${message.phoneNumber}`.toLowerCase().includes(query))
    .sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime());
  const selected = filtered.find(message => message.id === selectedId) ?? filtered[0];
  const unreadIds = filtered.filter(message => !message.isRead).map(message => message.id);
  const currentNumber = data.numbers.find(number => number.id === numberId);
  const hasSearchFilter = Boolean(query || status !== 'all');
  const emptyTitle = p.t(hasSearchFilter ? '没有找到符合条件的短信' : numberId ? '此号码暂无短信' : '暂无短信');
  const emptyHint = hasSearchFilter ? p.t('请尝试更换搜索词或清除筛选。')
    : currentNumber?.status === 'EXPIRED' ? p.t('此号码已过期，请核对有效期；刷新不会延长号码有效期。')
    : currentNumber ? p.t('请先在 {service} 使用此号码请求验证码，再点击“刷新短信”查看。创建服务订单不会自动发送验证码。', { service: currentNumber.service })
    : p.t('请先在目标平台使用服务号码请求验证码，再点击“刷新短信”查看。创建服务订单不会自动发送验证码。');
  const openedMessage = useRef('');
  // A direct link is an explicit view action; simply previewing the latest SMS is not.
  useEffect(() => {
    const message = data.messages.find(item => item.id === route.message);
    if (!message || message.isRead || openedMessage.current === message.id) return;
    openedMessage.current = message.id;
    void mutation.run(() => actions.markRead([message.id]));
  }, [route.message, data.messages, actions.markRead]);
  async function read(ids: string[]) { for (let offset = 0; offset < ids.length; offset += 100) await actions.markRead(ids.slice(offset, offset + 100)); }
  return <div className="lp-shell-inbox-page">
    <PlatformSmsNotice />
    <p className="lp-shell-view-meta" role="status">{lastUpdated ? <>{p.t("最近更新时间")}{'：'}<time dateTime={new Date(lastUpdated).toISOString()}>{p.date(new Date(lastUpdated).toISOString(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></> : p.t("尚未成功更新")}</p>
    <div className="lp-shell-view-toolbar"><SearchField label={p.t("搜索服务、验证码或号码")} value={search} onChange={value => { setSearch(value); setSelectedId(''); }} /><InboxNumberSelect numbers={data.numbers} regions={data.catalog.regions} value={numberId} onValueChange={value => { setNumberId(value); setSelectedId(''); }} /><SelectField aria-label={p.t("短信状态")} value={status} onValueChange={value => { setStatus(value); setSelectedId(''); }} options={[{ value: 'all', label: p.t("全部短信") }, { value: 'unread', label: p.t("未读短信") }]} /><ActionButton size="sm" disabled={!unreadIds.length || mutation.busy} onClick={() => void mutation.run(() => read(unreadIds))}><CheckCircle2 size={14} />{mutation.busy ? p.t("正在保存…") : p.t("标为已读")}</ActionButton></div>
    {mutation.error && <p className="lp-shell-view-error" role="alert">{p.t(mutation.error)}</p>}
    {route.message && !data.messages.some(message => message.id === route.message) && <p className="lp-shell-view-meta" role="status">{p.t('该短信不存在或已不可用，已显示当前列表')}</p>}
    <div className="lp-shell-view-inbox"><section className="lp-shell-view-message-list" aria-label={p.t("短信列表")}><div className="lp-shell-view-section-heading"><h2>{status === 'unread' ? p.t("未读短信") : p.t("短信列表")}</h2><span>{p.t("{count} 条 · {unread} 条未读", { count: p.n(filtered.length), unread: p.n(unreadIds.length) })}</span></div>{!filtered.length ? <EmptyState title={emptyTitle}><p>{emptyHint}</p>{hasSearchFilter && <ActionButton size="sm" onClick={() => { setSearch(''); setStatus('all'); }}>{p.t("清除筛选")}</ActionButton>}</EmptyState> : filtered.map(message => <button type="button" disabled={mutation.busy} key={message.id} className={`lp-shell-view-message${selected?.id === message.id ? ' is-selected' : ''}`} aria-pressed={selected?.id === message.id} aria-controls="lp-shell-message-detail" onClick={() => { setSelectedId(message.id); if (!message.isRead) void mutation.run(() => actions.markRead([message.id])); }}><span className="lp-shell-view-message-top"><ServiceLabel service={message.sender} /><small>{p.date(message.receivedAt)}</small></span><span className="lp-shell-view-message-code">{message.verificationCode ?? p.t("无验证码")}{!message.isRead && <i aria-label={p.t("未读")} />}</span><span className="lp-shell-view-message-phone">{message.phoneNumber}</span></button>)}</section><section id="lp-shell-message-detail" className="lp-shell-view-message-detail" aria-label={p.t("短信详情")} aria-live="polite">{selected ? <><div className="lp-shell-view-section-heading"><h2><ServiceLabel service={selected.sender} /></h2><StatusPill tone={selected.isRead ? 'neutral' : 'accent'}>{selected.isRead ? p.t("已读") : p.t("未读")}</StatusPill></div><p className="lp-shell-view-meta">{p.date(selected.receivedAt)} · {selected.phoneNumber}</p>{selected.verificationCode && <div className="lp-shell-view-code"><strong>{selected.verificationCode}</strong><CopyValue key={selected.id} labels={{ ...p.copyLabels, success: p.t('验证码已复制') }} value={selected.verificationCode} label={p.t("复制验证码")} /></div>}<h3>{p.t("短信内容")}</h3><p className="lp-shell-view-message-body">{selected.body}</p><CopyValue labels={p.copyLabels} value={selected.body} label={p.t("复制全文")} /></> : <EmptyState title={emptyTitle} />}</section></div>
  </div>;
}
function OrderRow({ order, actions }: { order: Order; actions: WorkspaceActions }) {
  const p = useDisplayPreferences();
  const [detail, setDetail] = useState<OrderDetail | null>(null); const mutation = useMutation();
  const load = () => mutation.run(async () => { setDetail(await actions.order(order.id)); });
  return <article className="lp-shell-view-order">
    <header><div className="lp-shell-view-country"><Flag code={order.region} /><span><strong>{p.t("{region}服务号码", { region: p.t(order.country) })}</strong><small>{p.t(order.planName)} · {p.n(order.quantity)}{' '}{p.t("个")}</small></span></div><div className="lp-shell-view-order-amount"><strong>{p.n(order.totalPoints)}{' '}{p.t("积分")}</strong><small>{p.date(order.createdAt)}</small></div><OrderStatusPill status={fulfillmentDisplay[order.status].status} label={p.t(fulfillmentDisplay[order.status].label)} /></header>
    <details onToggle={event => { if (event.currentTarget.open) void load(); }}>
      <summary><span>{p.t("订单详情")}<ChevronDown size={14} /></span></summary>
      <div className="lp-shell-order-detail">
        <dl className="lp-shell-order-facts">
          <div><dt>{p.t("服务期限")}</dt><dd>{p.t(order.planName)}</dd></div>
          <div><dt>{p.t("平台")}</dt><dd><ServiceLabel service={order.service} /></dd></div>
          <div><dt>{p.t("分配方式")}</dt><dd>{order.areaCode ? p.t("指定区号 {code}", { code: order.areaCode }) : p.t("自动分配")}</dd></div>
          <div><dt>{p.t("服务数量")}</dt><dd>{p.n(order.quantity)}{' '}{p.t("个")}</dd></div>
          <div><dt>{p.t("扣除积分")}</dt><dd className="lp-shell-order-points">{p.n(order.totalPoints)}{' '}{p.t("积分")}</dd></div>
        </dl>
        <section className="lp-shell-order-numbers" aria-label={p.t("服务号码")} aria-busy={mutation.busy}>
          <h3>{p.t("服务号码")}</h3>
          {mutation.busy && <p className="lp-shell-view-meta" role="status">{p.t("正在加载号码…")}</p>}
          {mutation.error && <p className="lp-shell-view-error" role="alert">{p.t(mutation.error)}<ActionButton size="sm" onClick={() => void load()}>{p.t("重试")}</ActionButton></p>}
          {detail && !detail.numbers.length && !mutation.busy && !mutation.error && <p className="lp-shell-view-meta" role="status">{p.t("此订单暂无关联号码")}</p>}
          <ul>{detail?.numbers.map(number => <li className="lp-shell-view-order-number" key={number.id}><span><Smartphone size={15} aria-hidden="true" />{number.phoneNumber}</span><PageLink href={shellHref('inbox', { number: number.id, allocation: number.allocationId })}>{p.t("收件箱")}</PageLink></li>)}</ul>
        </section>
        <footer className="lp-shell-order-reference">
          <span>{p.t("订单编号")}</span><code title={order.orderNumber}>{order.orderNumber}</code>
          <CopyValue labels={p.copyLabels} value={order.orderNumber} label={p.t("复制订单号")} />
        </footer>
      </div>
    </details>
  </article>;
}
function OrdersPage({ data, actions }: PageProps) {
  const p = useDisplayPreferences();
  const [search, setSearch] = useState(''); const [region, setRegion] = useState(''); const query = search.trim().toLowerCase();
  const filtered = data.orders.filter(order => (!region || order.region === region) && `${order.orderNumber} ${order.country} ${p.t(order.country)} ${order.planName} ${p.t(order.planName)} ${order.service}`.toLowerCase().includes(query));
  const regionId = data.catalog.regions.find(item => item.id === region)?.id;
  const clientSearch = needsClientSearch(query, data, p.t) || Boolean(query) && filtered.some(order => `${order.planName} ${p.t(order.planName)}`.toLowerCase().includes(query)) || Boolean(region && !regionId);
  const loadPage = useCallback((page: number, pageSize: number, signal: AbortSignal) => actions.listOrders({ page, pageSize, search: query, region: regionId }, { signal }), [actions.listOrders, query, regionId]);
  const records = useRecordPagination(loadPage, JSON.stringify([search, region, p.locale]), data.orders, clientSearch ? filtered : undefined);
  return <div ref={records.listRef} className="lp-shell-records lp-shell-records-orders">
    <div className="lp-shell-view-toolbar"><SearchField label={p.t("搜索订单号、地区或服务期限")} value={search} onChange={setSearch} /><SelectField aria-label={p.t("订单地区")} value={region} onValueChange={setRegion} options={[{ value: '', label: p.t("全部地区") }, ...data.catalog.regions.map(item => ({ value: item.id, label: p.t(item.name) }))]} /><span className="lp-shell-view-count">{p.t("{count} 笔订单", { count: p.n(records.totalItems) })}</span></div>
    <div id="lp-shell-order-records" aria-busy={records.busy}>
      {records.busy ? <EmptyState title={p.t("正在加载")} /> : records.error ? <EmptyState title={p.t(records.error)}><ActionButton size="sm" onClick={records.retry}>{p.t("重试")}</ActionButton></EmptyState> : !records.items.length ? <EmptyState title={p.t("暂无符合条件的订单")}><ActionButton size="sm" onClick={() => { setSearch(''); setRegion(''); }}>{p.t("清除筛选")}</ActionButton></EmptyState> : records.items.map(order => <OrderRow key={order.id} order={order} actions={actions} />)}
    </div>
    <RecordPagination page={records.page} pageSize={records.pageSize} totalPages={records.totalPages} totalItems={records.totalItems} busy={records.busy} controls="lp-shell-order-records" onPageChange={records.setPage} onPageSizeChange={records.setPageSize} />
  </div>;
}
function PointsPage({ data }: PageProps) {
  const p = useDisplayPreferences();
  const [kind, setKind] = useState('all'); const entries = data.ledger.filter(entry => kind === 'all' || (kind === 'income' ? entry.delta > 0 : entry.delta < 0));
  return <><div className="lp-shell-view-metrics"><div><WalletCards size={19} /><span>{p.t("可用积分")}</span><strong>{p.n(data.account.pointsBalance)}</strong></div><div><Plus size={19} /><span>{p.t("累计入账")}</span><strong>{p.n(data.ledger.reduce((total, entry) => total + Math.max(0, entry.delta), 0))}</strong></div><div><Minus size={19} /><span>{p.t("累计扣除")}</span><strong>{p.n(data.ledger.reduce((total, entry) => total - Math.min(0, entry.delta), 0))}</strong></div></div><div className="lp-shell-view-toolbar"><h2>{p.t("积分流水")}</h2><SelectField aria-label={p.t("积分流水类型")} value={kind} onValueChange={setKind} options={[{ value: 'all', label: p.t("全部记录") }, { value: 'income', label: p.t("积分入账") }, { value: 'expense', label: p.t("订单扣除") }]} /><span className="lp-shell-view-count">{p.t("{count} 条记录", { count: p.n(entries.length) })}</span></div>{!entries.length ? <EmptyState title={p.t("暂无积分记录")} /> : <div className="lp-shell-view-table-scroll" tabIndex={0} role="region" aria-label={p.t("积分流水")}><table className="lp-shell-view-table lp-shell-view-ledger"><thead><tr><th scope="col">{p.t("事项")}</th><th scope="col">{p.t("时间")}</th><th scope="col">{p.t("积分变动")}</th><th scope="col">{p.t("变动后余额")}</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{p.t(entry.description)}</td><td>{p.date(entry.createdAt)}</td><td className={entry.delta > 0 ? 'lp-shell-view-positive' : 'lp-shell-view-warning'}>{entry.delta > 0 ? '+' : ''}{p.n(entry.delta)}</td><td>{p.n(entry.balanceAfter)}</td></tr>)}</tbody></table></div>}</>;
}
function RegionContextPage({ data, route }: PageProps) {
  const p = useDisplayPreferences();
  const region = data.catalog.regions.find(item => item.id === route.region);
  if (!region) return <EmptyState title={p.t(detailCopy.catalogNotFound)} />;
  const offers = data.catalog.offers.filter(offer => offer.region === region.id && data.catalog.services.includes(offer.service));
  return <>
    <section aria-label={p.t(detailCopy.titles['region-detail'])}>
      <div className="lp-shell-detail-identity"><Flag code={region.id} /><span>{region.english}</span><StatusPill tone={region.availableCount > 0 ? 'green' : 'neutral'}>{p.t(region.availableCount > 0 ? detailCopy.available : detailCopy.soldOut)}</StatusPill></div>
      <dl className="lp-shell-view-region-facts">
        <div><dt>{p.t(detailCopy.labels.area)}</dt><dd>{p.t(region.area)}</dd></div>
        <div><dt>{p.t(detailCopy.labels.prefix)}</dt><dd>{region.prefix}</dd></div>
        <div><dt>{p.t(detailCopy.labels.inventory)}</dt><dd>{p.n(region.availableCount)}{' '}{p.t(detailCopy.units.numbers)}</dd></div>
      </dl>
      <div className="lp-shell-detail-actions"><PageLink href={detailHref({ page: 'region-detail', region: region.id })}>{p.t(detailCopy.links.region)}</PageLink><PageLink href={shellHref('purchase', { region: region.id })}>{p.t(detailCopy.links.purchase)}</PageLink></div>
    </section>
    <section className="lp-shell-detail-section" aria-labelledby="lp-shell-region-offers-title">
      <h2 id="lp-shell-region-offers-title">{p.t(detailCopy.labels.offers)}</h2>
      {!offers.length ? <EmptyState title={p.t(detailCopy.emptyOffers)} /> : <div className="lp-shell-view-table-scroll" tabIndex={0} role="region" aria-label={p.t(detailCopy.labels.offers)}>
        <table className="lp-shell-view-table"><thead><tr><th scope="col">{p.t(detailCopy.labels.service)}</th><th scope="col">{p.t(detailCopy.labels.plan)}</th><th scope="col">{p.t(detailCopy.labels.duration)}</th><th scope="col">{p.t(detailCopy.labels.price)}</th><th scope="col">{p.t(detailCopy.labels.stock)}</th><th scope="col">{p.t(detailCopy.labels.action)}</th></tr></thead>
          <tbody>{offers.map(offer => <tr key={detailHref({ page: 'offer-detail', ...offer })}>
            <td><ServiceLabel service={offer.service} /></td><td>{p.t(offer.name)}</td><td>{p.t("{days} 天有效期", { days: p.n(offer.durationDays) })}</td><td>{p.n(offer.unitPoints)}{' '}{p.t(detailCopy.units.perNumber)}</td><td>{p.n(offer.availableCount)}{' '}{p.t(detailCopy.units.numbers)}</td>
            <td><div className="lp-shell-view-region-offer-actions"><PageLink href={detailHref({ page: 'offer-detail', ...offer })}>{p.t(detailCopy.links.offer)}</PageLink>{offer.availableCount > 0 ? <PageLink href={shellHref('purchase', { region: region.id, service: offer.service, plan: offer.plan })}>{p.t(detailCopy.links.purchase)}</PageLink> : <StatusPill tone="neutral">{p.t(detailCopy.soldOut)}</StatusPill>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </>;
}
function RegionsPage({ data }: PageProps) {
  const p = useDisplayPreferences();
  const [search, setSearch] = useState(''); const [area, setArea] = useState('all');
  const filtered = data.catalog.regions.filter(region => (area === 'all' || region.area === area) && `${region.name} ${p.t(region.name)} ${region.english} ${region.prefix}`.toLowerCase().includes(search.trim().toLowerCase()));
  const areas = [...new Set(data.catalog.regions.map(region => region.area))];
  return <><div className="lp-shell-view-toolbar"><SearchField label={p.t("搜索地区或区号")} value={search} onChange={setSearch} /><SelectField aria-label={p.t("地区范围")} value={area} onValueChange={setArea} options={[{ value: 'all', label: p.t("全部地区") }, ...areas.map(item => ({ value: item, label: p.t(item) }))]} /><span className="lp-shell-view-count">{p.t("{count} 个地区", { count: p.n(filtered.length) })}</span></div>{!filtered.length ? <EmptyState title={p.t("暂无符合条件的地区")}><ActionButton size="sm" onClick={() => { setSearch(''); setArea('all'); }}>{p.t("清除筛选")}</ActionButton></EmptyState> : <div className="lp-shell-view-region-grid">{filtered.map(region => { const prices = data.catalog.offers.filter(offer => offer.region === region.id && offer.plan === 'month').map(offer => offer.unitPoints); return <article key={region.id} className="lp-shell-view-region"><div className="lp-shell-view-country"><Flag code={region.id} /><span><h2>{p.t("{region}号码", { region: p.t(region.name) })}</h2><small>{region.english} · {region.prefix}</small></span></div><dl className="lp-shell-view-facts"><div><dt>{p.t("可用库存")}</dt><dd>{p.n(region.availableCount)}{' '}{p.t("个")}</dd></div><div><dt>{p.t("短期服务")}</dt><dd>{prices.length ? p.t("{points} 积分起 / 30 天", { points: p.n(Math.min(...prices)) }) : p.t("暂无短期服务")}</dd></div></dl><div className="lp-shell-detail-actions"><PageLink href={detailHref({ page: 'region-detail', region: region.id })}>{p.t(detailCopy.links.region)}</PageLink><PageLink href={shellHref('purchase', { region: region.id })}>{p.t("创建服务")}</PageLink></div></article>; })}</div>}</>;
}
function AccountPage({ data, actions }: PageProps) {
  const p = useDisplayPreferences();
  const mutation = useMutation(); const user = data.account;
  return <div className="lp-shell-account-center">
    <section className="lp-shell-account-overview" aria-label={p.t("账户资料")}>
      <div className="lp-shell-account-identity">
        <UserAvatar name={user.displayName} size="profile" />
        <div><div className="lp-shell-account-name"><h2>{user.displayName}</h2><StatusPill tone="green">{p.t("账户正常")}</StatusPill></div><p>{user.email}</p></div>
      </div>
      <ActionButton size="sm" onClick={() => { navigate(shellHref('settings')); }}><Pencil size={15} aria-hidden="true" />{p.t("编辑账户资料")}</ActionButton>
    </section>

    <section className="lp-shell-account-metrics" aria-label={p.t("账户概览")}>
      <article className="lp-shell-account-metric" aria-labelledby="lp-account-points-title">
        <div className="lp-shell-account-metric-label"><WalletCards size={18} aria-hidden="true" /><h2 id="lp-account-points-title">{p.t("可用积分")}</h2></div>
        <strong>{p.n(user.pointsBalance)}</strong><PageLink href={shellHref('points')}>{p.t("积分明细")}</PageLink>
      </article>
      <article className="lp-shell-account-metric" aria-labelledby="lp-account-numbers-title">
        <div className="lp-shell-account-metric-label"><Smartphone size={18} aria-hidden="true" /><h2 id="lp-account-numbers-title">{p.t("使用中号码")}</h2></div>
        <strong>{p.n(data.dashboard.activeNumbers)}</strong>
      </article>
      <article className="lp-shell-account-metric" aria-labelledby="lp-account-messages-title">
        <div className="lp-shell-account-metric-label"><MessageCircle size={18} aria-hidden="true" /><h2 id="lp-account-messages-title">{p.t("未读短信")}</h2></div>
        <strong>{p.n(data.dashboard.unreadMessages)}</strong>
      </article>
    </section>

    <section className="lp-shell-account-information" aria-labelledby="lp-account-information-title">
      <h2 id="lp-account-information-title">{p.t("账户信息")}</h2>
      <dl className="lp-shell-account-facts">
        <div><dt>{p.t("账户名称")}</dt><dd>{user.displayName}</dd></div>
        <div><dt>{p.t("邮箱")}</dt><dd>{user.email}</dd></div>
        <div><dt>{p.t("手机号")}</dt><dd>{user.phoneNumber ?? p.t("未设置")}</dd></div>
        <div><dt>{p.t("账户编号")}</dt><dd className="lp-shell-account-id">{user.id}</dd></div>
        <div><dt>{p.t("账户类型")}</dt><dd>{p.t("标准账户")}</dd></div>
        <div><dt>{p.t("注册时间")}</dt><dd>{p.date(user.createdAt)}</dd></div>
      </dl>
    </section>

    <footer className="lp-shell-account-footer">
      {mutation.error && <p className="lp-shell-view-error" role="alert">{p.t(mutation.error)}</p>}
      <ActionButton busy={mutation.busy} busyLabel={p.t("正在退出…")} disabled={mutation.busy} onClick={() => void mutation.run(actions.logout)}><LogOut size={15} aria-hidden="true" />{p.t("退出登录")}</ActionButton>
    </footer>
  </div>;
}
function SettingsPage({ data, actions }: PageProps) {
  const p = useDisplayPreferences();
  const mutation = useMutation();
  const [tab, setTab] = useState<'profile' | 'preferences'>('profile');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [{ id: 'profile', label: '账户资料' }, { id: 'preferences', label: '偏好设置' }] as const;
  const [profileBusy, setProfileBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const user = data.account;
  const notice = user.preferences.expiryNotice;
  const expiring = data.numbers.filter(number => number.status === 'ACTIVE' && number.remainingDays <= 3).length;

  return <div className="lp-shell-view-settings">
    <div className="lp-shell-settings-tabs" role="tablist" aria-label={p.t("账户设置")}>
      {tabs.map((item, index) => <button key={item.id} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" id={`lp-settings-${item.id}-tab`} aria-controls={`lp-settings-${item.id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); setTab(tabs[next].id); tabRefs.current[next]?.focus();
      }}>{p.t(item.label)}</button>)}
    </div>

    <div className="lp-shell-settings-panel" id="lp-settings-profile-panel" role="tabpanel" aria-labelledby="lp-settings-profile-tab" tabIndex={0} hidden={tab !== 'profile'}>
      <section className="lp-shell-settings-overview" aria-label={p.t("账户概览")}>
        <div className="lp-shell-settings-identity">
          <UserAvatar name={user.displayName} size="profile" />
          <div><h2>{user.displayName}</h2><p>{user.email}</p><div className="lp-shell-settings-badges"><StatusPill tone="green">{p.t("账户正常")}</StatusPill><span>{p.t("标准账户")}</span></div></div>
        </div>
        <div className="lp-shell-settings-balance" role="group" aria-labelledby="lp-settings-balance-title">
          <div><span id="lp-settings-balance-title">{p.t("可用积分")}</span><strong>{p.n(user.pointsBalance)}{' '}<small>{p.t("积分")}</small></strong></div>
          <PageLink href={shellHref('points')}>{p.t("积分明细")}</PageLink>
        </div>
      </section>

      <AccountProfileSettings account={user} updateProfile={actions.updateProfile} disabled={mutation.busy} onBusyChange={setProfileBusy} />

      <section className="lp-shell-view-settings-group" aria-labelledby="lp-settings-account-title">
        <div className="lp-shell-view-settings-heading"><h2 id="lp-settings-account-title">{p.t("账户信息")}</h2><PageLink href={shellHref('account')}>{p.t("完整账户资料")}</PageLink></div>
        <dl className="lp-shell-settings-facts">
          <div><dt>{p.t("账户编号")}</dt><dd className="lp-shell-settings-account-id">{user.id}</dd></div>
          <div><dt>{p.t("账户类型")}</dt><dd>{p.t("标准账户")}</dd></div>
          <div><dt>{p.t("注册时间")}</dt><dd>{p.date(user.createdAt)}</dd></div>
        </dl>
      </section>
    </div>

    <div className="lp-shell-settings-panel" id="lp-settings-preferences-panel" role="tabpanel" aria-labelledby="lp-settings-preferences-tab" tabIndex={0} hidden={tab !== 'preferences'}>
      <div className="lp-shell-view-settings-group lp-shell-settings-display">
        <DisplaySettings />
        <p className="lp-shell-view-meta lp-shell-settings-help">{p.t("语言与主题仅保存在当前浏览器，不影响其他设备。")}</p>
      </div>

      <section className="lp-shell-view-settings-group lp-shell-settings-notice" aria-labelledby="lp-settings-notice-title">
        <div className="lp-shell-view-settings-heading"><h2 id="lp-settings-notice-title">{p.t("提醒偏好")}</h2></div>
        <label className="lp-shell-view-setting"><span><strong>{p.t("号码到期提醒")}</strong><small>{p.t("显示 3 天内到期的使用中号码")}</small></span><input type="checkbox" checked={notice} disabled={mutation.busy || profileBusy} onChange={event => { const value = event.target.checked; setSaved(false); void mutation.run(() => actions.preferences(value)).then(ok => setSaved(ok)); }} /></label>
        <div className="lp-shell-view-settings-status"><p className="lp-shell-view-meta" role="status">{mutation.busy ? p.t("正在保存…") : saved ? p.t("偏好已保存") : p.t(notice ? "到期提醒已开启" : "到期提醒已关闭")}</p>{mutation.error && <p className="lp-shell-view-error" role="alert">{p.t(mutation.error)}</p>}</div>
        <div className="lp-shell-settings-expiry"><span>{expiring ? p.t("{count} 个号码即将到期", { count: p.n(expiring) }) : p.t("暂无 3 天内到期的号码")}</span><PageLink href={shellHref('numbers')}>{p.t("查看号码")}</PageLink></div>
      </section>
    </div>
  </div>;
}
export default function WorkspacePages({ data, actions, route, refreshing, lastUpdated }: PageProps & { refreshing: boolean; lastUpdated: number | null }) {
  const p = useDisplayPreferences();
  const detail = isDetailRoute(route);
  const title = route.page === 'regions' ? regionPageTitle(data.catalog, route.region, p.locale) : detail ? catalogDetailTitle(data.catalog, route, p.locale) : p.t(shellPageTitle(route)); const props = { data, actions, route };
  const showHeaderBalance = !['purchase', 'inbox', 'settings', 'account'].includes(route.page);
  return <>
    <header className="lp-shell-view-header"><a className="lp-shell-view-brand" href={shellHref('dashboard')}>LINEPOOL<span>{p.t("个人工作台")}</span></a><div className="lp-shell-view-actions"><ActionButton size="sm" title={p.t(route.page === 'inbox' ? "刷新短信" : "刷新数据")} aria-label={p.t(route.page === 'inbox' && refreshing ? "正在刷新短信…" : route.page === 'inbox' ? "刷新短信" : "刷新数据")} disabled={refreshing} onClick={() => void actions.refresh()}><RefreshCw size={15} />{route.page === 'inbox' && p.t(refreshing ? "正在刷新短信…" : "刷新短信")}</ActionButton></div></header>
    <div className={`lp-shell-view-content${route.page === 'numbers' || route.page === 'orders' ? ' lp-shell-records-content' : ''}`}><div className="lp-shell-view-title"><div><h1 id="lp-shell-view-title">{title}</h1>{route.page !== 'account' ? <p>{data.account.displayName} · {p.t("标准账户")}{refreshing ? ` · ${p.t("正在同步…")}` : ''}</p> : refreshing && <p role="status">{p.t("正在同步…")}</p>}</div>{showHeaderBalance && <span className="lp-shell-view-account-balance"><WalletCards size={16} />{p.n(data.account.pointsBalance)}{' '}{p.t("积分")}</span>}</div>
      <SandboxTools data={data} actions={actions} numberId={route.number} />
      {detail && <WorkspaceDetails {...props} />}{route.page === 'purchase' && <PurchasePage {...props} />}{route.page === 'numbers' && <NumbersPage {...props} />}{route.page === 'inbox' && <InboxPage {...props} lastUpdated={lastUpdated} />}{route.page === 'orders' && <OrdersPage {...props} />}{route.page === 'points' && <PointsPage {...props} />}{route.page === 'regions' && (route.region ? <RegionContextPage {...props} /> : <RegionsPage {...props} />)}{route.page === 'account' && <AccountPage {...props} />}{route.page === 'settings' && <SettingsPage {...props} />}{route.page === 'not-found' && <EmptyState title={p.t("页面不存在")}><PageLink href={shellHref('dashboard')}>{p.t("返回工作台")}</PageLink></EmptyState>}
    </div>
  </>;
}
