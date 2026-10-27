import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HoldingBatchResult, HoldingBatchSelection, NumberHolding } from '@linepool/contracts';
import { regionIdSchema, serviceSchema } from '@linepool/contracts';
import { Checkbox } from '../../ui/checkbox';
import HoldingBatchForm from './HoldingBatchForm';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, Badge, DateText, Facts, Modal, State, Table, regionName } from '../../admin/primitives';
import AppCombobox from '../../AppCombobox';
import { agentQueryKey } from '../access';
import { AgentPager, agentError } from '../subagent-shared';
import { ErrorText, Filter, FormFooter, useAgentAction, useChildren, useCustomers } from './shared';
import { HoldingDurationField, useHoldingDuration, type HoldingWindow } from '../HoldingDurationField';
import type { AgentPageProps } from '../pages';

type View = 'holdings' | 'stock';
export default function InventoryPage({ access }: AgentPageProps) {
  const agentId = access.context.agent.id;
  const [view, setView] = useState<View>('holdings');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [service, setService] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [batch, setBatch] = useState<HoldingBatchSelection | null>(null);
  const [receipt, setReceipt] = useState<HoldingBatchResult | null>(null);
  function clearSelection() { setSelected(new Set()); setAllFiltered(false); }
  function toggleHolding(id: string, checked: boolean) {
    setSelected(previous => { const next = new Set(previous); if (checked && next.size < 10000) next.add(id); else if (!checked) next.delete(id); return next; });
  }
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [transfer, setTransfer] = useState<NumberHolding | null>(null);
  const [assign, setAssign] = useState<NumberHolding | null>(null);
  const [detail, setDetail] = useState<NumberHolding | null>(null);
  // Only offer hand-over to a sub-agent when one actually exists.
  const children = useChildren(agentId, access.context.capabilities.transferHoldings);
  const customers = useCustomers(agentId);
  const canHandOver = access.context.capabilities.transferHoldings && Boolean(children.data?.some(child => child.status === 'ACTIVE'));
  const canAssign = Boolean(customers.data?.some(customer => customer.status === 'ACTIVE'));
  const holdingFilters = { search, status: status === 'ACTIVE' || status === 'SUSPENDED' || status === 'RETIRED' ? status : '', region: regionIdSchema.safeParse(region).data ?? '' as const, service: serviceSchema.safeParse(service).data ?? '' as const } as const;
  const holdings = useQuery({ queryKey: agentQueryKey(agentId, 'inventory', 'holdings', holdingFilters, page, pageSize), queryFn: async ({ signal }) => api.agentHoldings({ ...holdingFilters, page, pageSize }, { signal }), }, queryClient);
  const stocks = useQuery({ queryKey: agentQueryKey(agentId, 'inventory', 'stock', search, status, region, service, page, pageSize), queryFn: async ({ signal }) => api.agentStock({ search, page, pageSize, region: holdingFilters.region, platform: holdingFilters.service, status: status === 'AVAILABLE' || status === 'ALLOCATED' || status === 'RELEASED' ? status : '' }, { signal }), }, queryClient);
  const result = view === 'holdings' ? holdings : stocks;
  const rows = view === 'holdings' ? holdings.data?.data ?? [] : stocks.data?.data ?? [];
  const totalPages = result.data?.pagination.totalPages ?? 0;
  const totalItems = result.data?.pagination.totalItems ?? 0;
  const holdingRows = view === 'holdings' ? holdings.data?.data ?? [] : [];
  const stockRows = view === 'stock' ? stocks.data?.data ?? [] : [];
  const platformOf = (holding: NumberHolding) => holding.service ?? stocks.data?.data.find(item => item.holdingId === holding.id)?.platformId;
  function holdingAvailable(holding: NumberHolding) {
    return holding.transferable === true;
  }
  const selectable = holdingRows.filter(holdingAvailable);
  const pageSelected = selectable.filter(item => selected.has(item.id)).length;
  const pageChecked = allFiltered || (selectable.length > 0 && pageSelected === selectable.length);
  return <>
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <div className="lp-agent-inventory-tabs" aria-label="库存视图">{([['holdings', '我的持有'], ['stock', '资源状态']] as [View, string][]).map(([key, title]) => <button type="button" key={key} aria-pressed={view === key} className={view === key ? 'active' : ''} onClick={() => { setView(key); setStatus(''); setPage(1); clearSelection(); }}>{title}</button>)}</div>
      <Filter title="状态"><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); clearSelection(); }}><option value="">全部状态</option>{(view === 'holdings' ? [['ACTIVE', '持有中'], ['SUSPENDED', '已暂停'], ['RETIRED', '已结束']] : [['AVAILABLE', '可分配'], ['ALLOCATED', '已分配'], ['RELEASED', '已释放']]).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></Filter>
      <Filter title="搜索号码"><input value={search} maxLength={64} placeholder="例如 +1" onChange={e => { setSearch(e.target.value); setPage(1); clearSelection(); }} /></Filter>
      <Filter title="国家"><select value={region} onChange={event => { setRegion(event.target.value); setPage(1); clearSelection(); }}><option value="">全部国家</option>{regionIdSchema.options.map(value => <option key={value} value={value}>{regionName(value)}</option>)}</select></Filter>
      <Filter title="平台"><select value={service} onChange={event => { setService(event.target.value); setPage(1); clearSelection(); }}><option value="">全部平台</option>{serviceSchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select></Filter>
    </div>
    <p className="lp-admin-context">{view === 'holdings' ? '查看平台或上级代理分配给你的号码、来源与有效期。' : '查看你的号码资源与分配情况。'}可搜索全部库存中的号码。</p>
    {receipt && <div className="lp-agent-batch-receipt" role="status"><strong>已成功划转 {receipt.count.toLocaleString()} 个号码</strong><span>可在订单中查看本次划转记录。</span><ActionButton size="sm" onClick={() => setReceipt(null)}>收起</ActionButton></div>}
    {view === 'holdings' && <div className="lp-agent-batch-toolbar">
      <span aria-live="polite">{allFiltered ? '已选择筛选结果中全部可划转号码（跨页）' : `已勾选 ${selected.size.toLocaleString()} 个号码（可跨页）`}</span>
      <ActionButton size="sm" disabled={!totalItems || result.isFetching || !!result.error || (status !== '' && status !== 'ACTIVE')} onClick={() => { setAllFiltered(true); setSelected(new Set()); }}>选择筛选结果中全部可划转号码</ActionButton>
      <ActionButton size="sm" disabled={!allFiltered && !selected.size} onClick={clearSelection}>清空选择</ActionButton>
      <ActionButton size="sm" variant="accent" disabled={(!allFiltered && !selected.size) || (!canAssign && !canHandOver) || result.isFetching || !!result.error} onClick={() => setBatch(allFiltered ? { mode: 'FILTER', ...holdingFilters } : { mode: 'IDS', holdingIds: [...selected].sort() })}>批量划转</ActionButton>
      <small>每批最多 10,000 个；调整筛选条件会清空选择。</small>
    </div>}
    <State loading={result.isFetching} error={result.error ? agentError(result.error) : ''} retry={() => void result.refetch()} data={result.data} empty={!rows.length} columns={6} />
    {holdingRows.length > 0 && <div className="lp-agent-inventory-table"><Table columns={[<span className="lp-agent-number-select"><Checkbox aria-label="勾选本页可划转号码" checked={pageChecked ? true : pageSelected > 0 ? 'indeterminate' : false} disabled={allFiltered || !selectable.length || result.isFetching} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); for (const item of selectable) { if (checked === true && next.size < 10000) next.add(item.id); else if (checked !== true) next.delete(item.id); } return next; })} />号码</span>, '国家 / 平台', '状态', '有效期', '']} label="当前代理持有库存">{holdingRows.map(item => <tr key={item.id}>
      <td><div className="lp-agent-number-select"><Checkbox aria-label={`选择 ${item.phoneNumber}`} checked={holdingAvailable(item) && (allFiltered || selected.has(item.id))} disabled={!holdingAvailable(item) || allFiltered || result.isFetching || (!selected.has(item.id) && selected.size >= 10000)} onCheckedChange={checked => toggleHolding(item.id, checked === true)} /><div><strong>{item.phoneNumber}</strong><small>{item.sourceHoldingId ? '上级代理转交' : '平台分配'}</small></div></div></td><td>{regionName(item.regionId)}{platformOf(item) && <small>{platformOf(item)}</small>}</td><td><Badge value={item.status === 'ACTIVE' && item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now() ? 'EXPIRED' : item.status} /></td><td><DateText value={item.startsAt} /> ～ {item.expiresAt ? <DateText value={item.expiresAt} /> : '长期'}</td>
      <td><div className="lp-agent-row-actions"><ActionButton size="sm" onClick={() => setDetail(item)}>详情</ActionButton>{canAssign && <ActionButton size="sm" disabled={!holdingAvailable(item)} onClick={() => setAssign(item)}>分配给客户</ActionButton>}{canHandOver && <ActionButton size="sm" disabled={!holdingAvailable(item)} onClick={() => setTransfer(item)}>转交下级</ActionButton>}</div></td>
    </tr>)}</Table></div>}
    {stockRows.length > 0 && <div className="lp-agent-inventory-table"><Table columns={['号码', '国家 / 平台', '号码状态', '分配情况', '号码到期']} label="代理号码资源">{stockRows.map(item => <tr key={item.id}>
      <td><strong>{item.phoneNumber}</strong></td><td>{regionName(item.regionId)}<small>{item.platformId}</small></td><td><Badge value={item.resourceStatus} /></td><td><Badge value={item.status} /></td><td><DateText value={item.resourceExpiresAt} /></td>
    </tr>)}</Table></div>}
    {result.data && <AgentPager page={page} pageSize={pageSize} totalItems={totalItems} totalPages={totalPages} busy={result.isFetching} onChange={(p, size) => { setPage(p); setPageSize(size); }} />}
    {batch && <HoldingBatchForm access={access} selection={batch} onClose={() => setBatch(null)} onComplete={value => { setReceipt(value); setBatch(null); clearSelection(); }} />}
    {transfer && <TransferForm holding={transfer} access={access} onClose={() => setTransfer(null)} />}
    {assign && <AssignCustomerForm holding={assign} access={access} onClose={() => setAssign(null)} />}
    {detail && <Modal title="号码持有详情" onClose={() => setDetail(null)} variant="drawer"><div className="lp-admin-dialog-body"><Facts rows={[
      ['号码', detail.phoneNumber], ['国家', regionName(detail.regionId)], ['平台', platformOf(detail) ?? '—'], ['状态', <Badge value={detail.status} />], ['开始时间', <DateText value={detail.startsAt} />], ['到期时间', detail.expiresAt ? <DateText value={detail.expiresAt} /> : '长期'], ['来源', detail.sourceHoldingId ? '上级代理转交' : '平台分配'], ['转交 / 结束时间', <DateText value={detail.transferredAt} />],
    ]} /></div></Modal>}
  </>;
}

function AssignCustomerForm({ holding, access, onClose }: { holding: NumberHolding; access: AgentPageProps['access']; onClose: () => void }) {
  const agentId = access.context.agent.id;
  const customers = useCustomers(agentId);
  const [target, setTarget] = useState('');
  const duration = useHoldingDuration(holding);
  const [confirmed, setConfirmed] = useState<HoldingWindow | null>(null);
  const action = useAgentAction(agentId);
  const valid = !!target && (confirmed ? Date.parse(confirmed.expiresAt) > Date.now() : duration.window.valid);
  return <Modal title="分配号码给客户" onClose={onClose} busy={action.busy}><form className="lp-agent-form" onSubmit={e => {
    e.preventDefault(); if (!valid) return;
    if (!confirmed) { const window = duration.resolveWindow(); if (window.valid) setConfirmed(window); return; }
    const payload = { holdingId: holding.id, customerId: target, startsAt: confirmed.startsAt, expiresAt: confirmed.expiresAt };
    void action.run(() => api.agentAssignHoldingToCustomer({ ...payload, idempotencyKey: action.requestKey(payload) }), onClose, '号码已分配给客户');
  }}><div className="lp-admin-dialog-body"><p className="lp-admin-confirm-target">{holding.phoneNumber} · {holding.service ?? regionName(holding.regionId)}</p>
    <State loading={customers.isFetching} error={customers.error ? agentError(customers.error) : ''} retry={() => void customers.refetch()} data={customers.data} />
    {confirmed ? <><Facts rows={[
      ['客户', customers.data?.find(customer => customer.id === target)?.name ?? target], ['开始时间', '确认后立即生效'], ['到期时间', <DateText value={confirmed.expiresAt} />], ['分配方式', '库存划拨（不结算）'],
    ]} /><p className="lp-admin-context">确认后，号码会转为该客户的服务权益，当前代理不再持有。本次不收款、不扣余额；客户销售价不参与这次划拨。需要收费时，请另行确认与客户的结算。</p></> : <fieldset disabled={action.busy}>
      <label>客户<AppCombobox aria-label="目标客户" value={target} onValueChange={setTarget} placeholder={customers.isPending ? '正在加载客户…' : '请选择客户'} options={(customers.data?.filter(customer => customer.status === 'ACTIVE') ?? []).map(customer => ({ value: customer.id, label: customer.name }))} searchPlaceholder="搜索客户" emptyMessage="没有匹配的客户" /></label>
      {!customers.isFetching && customers.data && !customers.data.some(customer => customer.status === 'ACTIVE') && <p className="lp-admin-context">暂无启用的直属客户，请先到客户管理绑定客户。</p>}
      <HoldingDurationField holding={holding} state={duration} />
    </fieldset>}<ErrorText error={action.error} /></div><FormFooter busy={action.busy} onClose={onClose} onBack={confirmed ? () => setConfirmed(null) : undefined} disabled={!valid || !!customers.error} label={confirmed ? '确认分配' : '核对分配信息'} /></form></Modal>;
}

function TransferForm({ holding, access, onClose }: { holding: NumberHolding; access: AgentPageProps['access']; onClose: () => void }) {
  const agentId = access.context.agent.id;
  const children = useChildren(agentId, true);
  const [target, setTarget] = useState('');
  const duration = useHoldingDuration(holding);
  const [confirmed, setConfirmed] = useState<HoldingWindow | null>(null);
  const action = useAgentAction(agentId);
  const valid = !!target && (confirmed ? Date.parse(confirmed.expiresAt) > Date.now() : duration.window.valid);
  return <Modal title="转交号码给直属下级" onClose={onClose} busy={action.busy}><form className="lp-agent-form" onSubmit={e => {
    e.preventDefault(); if (!valid) return;
    if (!confirmed) { const window = duration.resolveWindow(); if (window.valid) setConfirmed(window); return; }
    const payload = { holdingId: holding.id, toAgentId: target, startsAt: confirmed.startsAt, expiresAt: confirmed.expiresAt };
    void action.run(() => api.agentResellHolding({ ...payload, idempotencyKey: action.requestKey(payload) }), onClose, '号码已转交');
  }}><div className="lp-admin-dialog-body"><p className="lp-admin-confirm-target">{holding.phoneNumber} · {regionName(holding.regionId)}</p>
    <State loading={children.isFetching} error={children.error ? agentError(children.error) : ''} retry={() => void children.refetch()} data={children.data} />
    {confirmed ? <><Facts rows={[
      ['接收代理', children.data?.find(item => item.id === target)?.name ?? target], ['开始时间', '确认后立即生效'], ['到期时间', <DateText value={confirmed.expiresAt} />], ['转交方式', '库存划拨（不结算）'],
    ]} /><p className="lp-admin-context">确认后，当前持有结束并为接收代理建立新持有记录。转交不扣任何余额。</p></> : <fieldset disabled={action.busy}>
      <label>接收代理<select required value={target} onChange={e => setTarget(e.target.value)}><option value="">请选择直属下级</option>{children.data?.filter(child => child.status === 'ACTIVE').map(child => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label>
      {children.data && !children.data.some(child => child.status === 'ACTIVE') && <p className="lp-admin-context">暂无启用的直属下级，请先到代理管理创建或恢复代理。</p>}
      <HoldingDurationField holding={holding} state={duration} />
    </fieldset>}<ErrorText error={action.error} /></div><FormFooter busy={action.busy} onClose={onClose} onBack={confirmed ? () => setConfirmed(null) : undefined} disabled={!valid || !!children.error} label={confirmed ? '确认转交' : '核对转交信息'} /></form></Modal>;
}
