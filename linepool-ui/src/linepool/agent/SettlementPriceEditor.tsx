import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PriceRule } from '@linepool/contracts';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { Modal, State, regionName } from '../admin/primitives';
import { agentError } from './subagent-shared';
import { ErrorText, FormFooter, money, parseMoney } from './pages/shared';

export const settlementMoney = (value: string) => /^0+(\.0{1,2})?$/.test(value) ? 0 : parseMoney(value);
export function purchaseRule(rules: PriceRule[], agentId: string, service: string, region: string) {
  return rules.filter(rule => rule.isActive && rule.pricingKind === 'WHOLESALE' && rule.sellerAgentId !== agentId && rule.service === service && (rule.regionId === null || rule.regionId === region))
    .sort((a, b) => Number(!!b.buyerAgentId) - Number(!!a.buyerAgentId) || Number(!!b.regionId) - Number(!!a.regionId))[0];
}

export default function SettlementPriceEditor({ rule, kind = 'WHOLESALE', agentId, onClose, onSuccess }: {
  rule: PriceRule | null; kind?: 'WHOLESALE' | 'RETAIL'; agentId?: string; onClose: () => void; onSuccess: () => void;
}) {
  const platform = !agentId;
  const [service, setService] = useState(rule?.service ?? '');
  const [region, setRegion] = useState(rule?.regionId ?? '');
  const [buyer, setBuyer] = useState(rule?.buyerAgentId ?? '');
  const [price, setPrice] = useState(rule ? (rule.unitAmountMinor / 100).toFixed(2) : '');
  const [active, setActive] = useState(rule?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = useQuery({ queryKey: ['settlement-price-options', agentId], queryFn: async ({ signal }) => (await api.agentPriceOptions({ signal })).data }, queryClient);
  const agents = useQuery({ queryKey: ['settlement-price-buyers', agentId], queryFn: async ({ signal }) => (await api.agentAgents({ signal })).data, enabled: kind === 'WHOLESALE' }, queryClient);
  const prices = useQuery({ queryKey: ['settlement-editor-prices', agentId], queryFn: async ({ signal }) => (await api.agentPrices({ signal })).data, enabled: !!agentId }, queryClient);
  const amount = settlementMoney(price);
  const ownPrice = agentId && service ? purchaseRule(prices.data ?? [], agentId, service, region) : undefined;
  const targets = agents.data?.filter(agent => platform ? agent.level === 1 : agent.parentAgentId === agentId) ?? [];
  async function submit() {
    if (amount === null || busy || !service) return;
    setBusy(true); setError('');
    try {
      await api.agentSavePrice({ agentId: agentId ?? null, pricingKind: kind, sellerType: platform ? 'PLATFORM' : 'AGENT', sellerAgentId: agentId ?? null,
        buyerAgentId: kind === 'WHOLESALE' ? buyer || null : null, service, regionId: region || null,
        unitAmountMinor: amount, isActive: active, plan: 'P30D', currency: 'USD', priority: 0 });
      await queryClient.invalidateQueries({ predicate: query => query.queryKey.some(key => typeof key === 'string' && (key.includes('price') || key === 'agent')) });
      onSuccess();
    } catch (cause) { setError(agentError(cause)); } finally { setBusy(false); }
  }
  return <Modal title={platform ? '平台批发价' : kind === 'WHOLESALE' ? '给下级的价格' : '客户参考售价'} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <State loading={options.isFetching || agents.isFetching} error={options.error || agents.error ? agentError(options.error ?? agents.error) : ''} retry={() => { void options.refetch(); void agents.refetch(); }} />
    <fieldset className="lp-admin-form-grid" disabled={busy}>
      <label>平台<select required value={service} disabled={!!rule} onChange={event => setService(event.target.value)}><option value="">请选择平台</option>{options.data?.services.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>国家<select value={region} disabled={!!rule} onChange={event => setRegion(event.target.value)}><option value="">全部国家</option>{options.data?.regions.map(value => <option key={value} value={value}>{regionName(value)}</option>)}</select></label>
      {kind === 'WHOLESALE' && <label>适用{platform ? '一级代理' : '下级'}<select value={buyer} disabled={!!rule} onChange={event => setBuyer(event.target.value)}><option value="">{platform ? '全部一级代理' : '全部直属下级'}</option>{targets.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
      <label>每个号码 30 天价格<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={price} onChange={event => setPrice(event.target.value)} placeholder="0.00" /></label>
      <label>状态<select value={active ? '1' : '0'} onChange={event => setActive(event.target.value === '1')}><option value="1">启用</option><option value="0">停用</option></select></label>
    </fieldset>
    <p className="lp-admin-context">按实际使用天数折算，不足一天按一天，金额向上取整到分。{kind === 'RETAIL' ? '客户参考售价仅用于记账，需自行向客户收款。' : '指定买方的价格优先于默认价格，其次按国家匹配。'}</p>
    {kind === 'WHOLESALE' && ownPrice && <p className={amount !== null && amount < ownPrice.unitAmountMinor ? 'lp-admin-warning' : 'lp-admin-context'}>你的进货价 {money(ownPrice.unitAmountMinor, 'USD')} / 30 天。{amount !== null && (amount < ownPrice.unitAmountMinor ? `低于你的进货价，每个号码 30 天将亏损 ${money(ownPrice.unitAmountMinor - amount, 'USD')}；仍可保存。` : `差价 ${money(amount - ownPrice.unitAmountMinor, 'USD')} / 30 天。`)}</p>}
    <ErrorText error={error} />
  </div><FormFooter busy={busy} onClose={onClose} disabled={amount === null || !service || !!options.error || !!agents.error} label="保存价格" /></form></Modal>;
}
