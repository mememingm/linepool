import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { PriceRule } from '@linepool/contracts';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, Badge, State, Table, regionName } from '../../admin/primitives';
import { agentQueryKey } from '../access';
import { agentError } from '../subagent-shared';
import { Filter, money, useChildren } from './shared';
import SettlementPriceEditor, { purchaseRule } from '../SettlementPriceEditor';
import type { AgentPageProps } from '../pages';

type View = 'upstream' | 'wholesale' | 'retail';
export default function ProductsPage({ access }: AgentPageProps) {
  const agentId = access.context.agent.id;
  const partner = access.context.capabilities.manageSubagents;
  const [view, setView] = useState<View>('upstream');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<PriceRule | 'new' | null>(null);
  const result = useQuery({ queryKey: agentQueryKey(agentId, 'products'), queryFn: async ({ signal }) => (await api.agentPrices({ signal })).data }, queryClient);
  const children = useChildren(agentId, partner);
  const owned = (rule: PriceRule) => rule.sellerType === 'AGENT' && rule.sellerAgentId === agentId;
  const needle = search.trim().toLowerCase();
  const rows = (result.data ?? []).filter(rule => (view === 'upstream' ? !owned(rule) : owned(rule) && rule.pricingKind === (view === 'retail' ? 'RETAIL' : 'WHOLESALE')) && [rule.service, rule.regionId, regionName(rule.regionId ?? '')].some(value => value?.toLowerCase().includes(needle)));
  return <>
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <div className="lp-agent-inventory-tabs" aria-label="价格类型">{([['upstream', '我的进货价'], ...(partner ? [['wholesale', '给下级的价格']] : []), ['retail', '客户参考售价']] as [View, string][]).map(([key, title]) => <button type="button" key={key} aria-pressed={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{title}</button>)}</div>
      <Filter title="搜索平台或国家"><input value={search} maxLength={64} onChange={event => setSearch(event.target.value)} placeholder="例如 WhatsApp、美国" /></Filter>
      {view !== 'upstream' && <ActionButton variant="accent" onClick={() => setEdit('new')}><Plus size={16} />新增价格</ActionButton>}
    </div>
    <p className="lp-admin-context">{view === 'upstream' ? '平台或上级给你的进货价。按 30 天设置，实际拿号时按天折算并扣余额。' : view === 'wholesale' ? '下级拿号时扣下级余额，货款计入你的余额。指定下级的价格优先，再匹配国家。' : '分配给客户时默认带出，可在分配时修改。记账，不经平台收款；需自行向客户收款。'}价格变更不影响历史订单。</p>
    <State loading={result.isFetching} error={result.error ? agentError(result.error) : ''} retry={() => void result.refetch()} data={result.data} columns={6} />
    {result.data && !rows.length && <p className="lp-admin-context">{needle ? '没有匹配的价格。' : view === 'upstream' ? '尚未设置你的进货价，请联系平台或上级。' : '尚未设置价格，点击「新增价格」开始设置。'}</p>}
    {rows.length > 0 && <Table columns={['平台', '国家', '适用对象', '30 天价格', ...(view === 'wholesale' ? ['我的进货价 / 差价'] : []), '状态', '操作']} label="代理价格规则">{rows.map(rule => {
      const purchase = purchaseRule(result.data ?? [], agentId, rule.service, rule.regionId ?? '');
      return <tr key={rule.id}><td><strong>{rule.service}</strong></td><td>{rule.regionId ? regionName(rule.regionId) : '全部国家'}</td><td>{owned(rule) ? rule.pricingKind === 'RETAIL' ? '直属客户' : rule.buyerAgentId ? children.data?.find(child => child.id === rule.buyerAgentId)?.name ?? '指定下级' : '全部直属下级' : rule.buyerAgentId ? '给我的专属价格' : '默认进货价'}</td><td><strong>{money(rule.unitAmountMinor, 'USD')}</strong></td>{view === 'wholesale' && <td>{purchase ? `${money(purchase.unitAmountMinor, 'USD')} / ${money(rule.unitAmountMinor - purchase.unitAmountMinor, 'USD')}` : '按国家查询进货价'}</td>}<td><Badge value={rule.isActive ? 'ACTIVE' : 'DISABLED'} /></td><td>{owned(rule) ? <ActionButton size="sm" onClick={() => setEdit(rule)}>编辑</ActionButton> : '只读'}</td></tr>;
    })}</Table>}
    {edit && <SettlementPriceEditor rule={edit === 'new' ? null : edit} kind={view === 'wholesale' ? 'WHOLESALE' : 'RETAIL'} agentId={agentId} onClose={() => setEdit(null)} onSuccess={() => { setEdit(null); void result.refetch(); }} />}
  </>;
}
