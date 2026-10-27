import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { PriceRule } from '@linepool/contracts';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, Badge, DateText, Modal, State, Table } from '../../admin/primitives';
import { Identifier } from '../../admin/Presentation';
import { agentQueryKey } from '../access';
import { agentError } from '../subagent-shared';
import { ErrorText, Filter, FormFooter, money, parseMoney, useAgentAction, useChildren } from './shared';
import type { AgentPageProps } from '../pages';

type View = 'retail' | 'wholesale' | 'upstream';
export default function ProductsPage({ access }: AgentPageProps) {
  const agentId = access.context.agent.id;
  const partner = access.context.capabilities.manageSubagents;
  const [view, setView] = useState<View>('retail');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<PriceRule | 'new' | null>(null);
  const result = useQuery({ queryKey: agentQueryKey(agentId, 'products'), queryFn: async ({ signal }) => (await api.agentPrices({ signal })).data }, queryClient);
  const children = useChildren(agentId, partner);
  const owned = (r: PriceRule) => r.pricingKind === 'RETAIL' ? r.sellerAgentId === agentId : r.agentId === agentId;
  const label = (id: string | null) => id ? children.data?.find(child => child.id === id)?.name ?? id : '全部直属下级';
  const needle = search.trim().toLowerCase();
  const rows = (result.data ?? []).filter(r => (view === 'upstream' ? !owned(r) : owned(r) && r.pricingKind === (view === 'retail' ? 'RETAIL' : 'WHOLESALE')) && [r.service, r.plan, r.regionId, r.currency].some(value => value?.toLowerCase().includes(needle)));
  return <>
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <div className="lp-agent-inventory-tabs" aria-label="价格类型">{([['retail', '客户销售价'], ...(partner ? [['wholesale', '下级结算价']] : []), ['upstream', '上级与平台参考价']] as [View, string][]).map(([key, title]) => <button type="button" key={key} aria-pressed={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{title}</button>)}</div>
      <Filter title="搜索服务、套餐或地区"><input value={search} maxLength={64} onChange={e => setSearch(e.target.value)} placeholder="例如 Telegram、month 或 us" /></Filter>
      {view !== 'upstream' && <ActionButton variant="accent" onClick={() => setEdit('new')}><Plus size={16} />新增价格</ActionButton>}
    </div>
    <p className="lp-admin-context">{view === 'upstream' ? '上级结算价仅供读取；平台销售参考价不代表你的采购成本。' : view === 'wholesale' ? '设置给直属下级的结算规则。号码转交当前为零金额库存流转，改价不会补扣历史款项。' : '先设置面向直属客户的销售价。库存中的「分配给客户」仅划拨号码，不会按销售价收款或扣余额；价格变更不修改历史订单。'}</p>
    <State loading={result.isFetching} error={result.error ? agentError(result.error) : ''} retry={() => void result.refetch()} data={result.data} columns={6} />
    {result.data && !rows.length && <div className="lp-agent-price-empty"><p>{needle ? '没有找到匹配的价格，请调整搜索条件。' : view === 'retail' ? '还没有客户销售价。点击「新增价格」，设置服务、套餐、地区和单价。' : view === 'wholesale' ? '还没有下级结算价。点击「新增价格」，设置直属下级的结算规则。' : '暂无上级或平台参考价，可联系上级确认。'}</p>{!needle && view !== 'upstream' && <ActionButton variant="accent" onClick={() => setEdit('new')}>新增价格</ActionButton>}</div>}
    {rows.length > 0 && <Table columns={['服务 / 套餐', '地区', '适用对象', '单价', '优先级', '状态', '创建时间', '操作']} label="代理价格规则">{rows.map(rule => <tr key={rule.id}>
      <td><strong>{rule.service}</strong><br /><span className="lp-admin-muted">{rule.plan}</span></td><td>{rule.regionId ?? '全部地区'}</td><td>{owned(rule) ? rule.pricingKind === 'RETAIL' ? '直属客户' : label(rule.buyerAgentId) : rule.pricingKind === 'WHOLESALE' ? '上级给我的结算价' : '平台销售参考价'}</td><td><strong>{money(rule.unitAmountMinor, rule.currency)}</strong></td><td>{rule.priority}</td><td><Badge value={rule.isActive ? 'ACTIVE' : 'DISABLED'} /></td><td><DateText value={rule.createdAt} /></td><td>{owned(rule) ? <ActionButton size="sm" onClick={() => setEdit(rule)}>编辑</ActionButton> : <span className="lp-admin-muted">只读</span>}</td>
    </tr>)}</Table>}
    {edit && <PriceForm rule={edit === 'new' ? null : edit} kind={view === 'wholesale' ? 'WHOLESALE' : 'RETAIL'} access={access} onClose={() => setEdit(null)} />}
  </>;
}

function PriceForm({ rule, kind, access, onClose }: { rule: PriceRule | null; kind: 'WHOLESALE' | 'RETAIL'; access: AgentPageProps['access']; onClose: () => void }) {
  const agentId = access.context.agent.id;
  const children = useChildren(agentId, kind === 'WHOLESALE');
  const [service, setService] = useState(rule?.service ?? 'Telegram');
  const [plan, setPlan] = useState(rule?.plan ?? 'month');
  const [region, setRegion] = useState(rule?.regionId ?? '');
  const [buyer, setBuyer] = useState(rule?.buyerAgentId ?? '');
  const [currency, setCurrency] = useState(rule?.currency ?? 'USD');
  const [price, setPrice] = useState(rule ? (rule.unitAmountMinor / 100).toFixed(2) : '');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [active, setActive] = useState(rule?.isActive ?? true);
  const action = useAgentAction(agentId);
  const unitAmountMinor = parseMoney(price);
  return <Modal title={rule ? '编辑价格规则' : '新增价格规则'} onClose={onClose} busy={action.busy}><form className="lp-agent-form" onSubmit={e => {
    e.preventDefault(); if (!unitAmountMinor) return;
    void action.run(() => api.agentSavePrice({ agentId, pricingKind: rule?.pricingKind ?? kind, buyerAgentId: buyer || null, regionId: region.trim() || null, service: service.trim(), plan: plan.trim(), currency, unitAmountMinor, priority, isActive: active }), onClose, '价格规则已保存');
  }}><div className="lp-admin-dialog-body"><fieldset className="lp-admin-form-grid" disabled={action.busy}>
    <label>服务<input required maxLength={64} value={service} disabled={!!rule} onChange={e => setService(e.target.value)} /></label>
    <label>套餐标识<input required maxLength={64} value={plan} disabled={!!rule} onChange={e => setPlan(e.target.value)} placeholder="week / month" /></label>
    <label>地区标识<input maxLength={32} value={region} disabled={!!rule} onChange={e => setRegion(e.target.value)} placeholder="us，留空适用于所有地区" /></label>
    {kind === 'WHOLESALE' && <label>适用下级<select value={buyer} disabled={!!rule || children.isPending || !!children.error} onChange={e => setBuyer(e.target.value)}><option value="">全部直属下级</option>{children.data?.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label>}
    <label>币种<input required pattern="[A-Z]{3}" maxLength={3} value={currency} disabled={!!rule} onChange={e => setCurrency(e.target.value.toUpperCase())} /></label>
    <label>单价<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" /></label>
    <label>优先级<input type="number" required min={0} max={100000} step={1} value={priority} onChange={e => setPriority(Number(e.target.value))} /></label>
    <label>规则状态<select value={active ? '1' : '0'} onChange={e => setActive(e.target.value === '1')}><option value="1">启用</option><option value="0">停用</option></select></label>
  </fieldset>{rule && <p className="lp-admin-context">规则 ID：<Identifier value={rule.id} />。如需调整适用范围，请新建规则并停用原规则。</p>}
    {kind === 'WHOLESALE' && children.error && <State loading={children.isFetching} error={agentError(children.error)} retry={() => void children.refetch()} />}
    <ErrorText error={action.error} />
  </div><FormFooter busy={action.busy} onClose={onClose} disabled={!unitAmountMinor || !service.trim() || !plan.trim() || (kind === 'WHOLESALE' && !!children.error)} /></form></Modal>;
}
