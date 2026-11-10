import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NumberHolding, Subagent } from '@linepool/contracts';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, DateText, Facts, Modal, State, regionName } from '../../admin/primitives';
import AppCombobox from '../../AppCombobox';
import { agentQueryKey } from '../access';
import { agentError } from '../subagent-shared';
import { HoldingDurationField, useHoldingDuration, type HoldingWindow } from '../HoldingDurationField';
import { SettlementPreview, useSettlementQuote } from '../SettlementPreview';
import { settlementMoney } from '../SettlementPriceEditor';
import { ErrorText, FormFooter, useAgentAction, useChildren, useCustomers } from './shared';
import BalanceTransfer from './BalanceTransfer';

export default function HoldingDistributionForm({ holding, agentId, recipient, onClose, onComplete, retail = false }: {
  holding?: NumberHolding; agentId: string; recipient?: Subagent; onClose: () => void; onComplete?: () => void; retail?: boolean;
}) {
  const customers = useCustomers(agentId);
  const children = useChildren(agentId, !retail);
  const recipients = retail ? customers : children;
  const [target, setTarget] = useState(recipient?.id ?? '');
  const [search, setSearch] = useState('');
  const [holdingId, setHoldingId] = useState('');
  const available = useQuery({ queryKey: agentQueryKey(agentId, 'transferable', search), enabled: !holding,
    queryFn: async ({ signal }) => (await api.agentTransferableHoldings({ search }, { signal })).data }, queryClient);
  const selectedHolding = holding ?? available.data?.find(item => item.id === holdingId);
  const [price, setPrice] = useState<string | null>(null);
  const [transferBalance, setTransferBalance] = useState(false);
  const duration = useHoldingDuration(selectedHolding);
  const [confirmed, setConfirmed] = useState<HoldingWindow | null>(null);
  const window = confirmed ?? duration.window;
  const bookAmount = price === null || price.trim() === '' ? undefined : settlementMoney(price);
  const quote = useSettlementQuote(selectedHolding && target && window.valid && bookAmount !== null ? {
    operation: retail ? 'ASSIGN' : 'RESELL', holdingId: selectedHolding.id, agentId: retail ? undefined : target,
    customerId: retail ? target : undefined, startsAt: window.startsAt, expiresAt: window.expiresAt,
    bookAmountMinor: retail ? bookAmount : undefined,
  } : null);
  const action = useAgentAction(agentId);
  const activeTarget = recipients.data?.some(item => item.id === target && item.status === 'ACTIVE');
  const valid = !!selectedHolding && activeTarget && window.valid && Date.parse(window.expiresAt) > Date.now() && !quote.isFetching && !quote.error && !!quote.data?.sufficient && bookAmount !== null;
  return <><Modal title={retail ? '分配号码给客户' : '转交号码给直属下级'} onClose={onClose} busy={action.busy}><form className="lp-agent-form" onSubmit={event => {
    event.preventDefault(); if (!valid || !quote.data || !selectedHolding) return;
    if (!confirmed) { const value = duration.resolveWindow(); if (value.valid) setConfirmed(value); return; }
    const common = { holdingId: selectedHolding.id, startsAt: confirmed.startsAt, expiresAt: confirmed.expiresAt, quoteFingerprint: quote.data.fingerprint };
    const payload = retail ? { ...common, customerId: target, bookAmountMinor: bookAmount ?? undefined } : { ...common, toAgentId: target };
    void action.run(() => retail ? api.agentAssignHoldingToCustomer({ ...common, customerId: target, bookAmountMinor: bookAmount ?? undefined, idempotencyKey: action.requestKey(payload) }) : api.agentResellHolding({ ...common, toAgentId: target, idempotencyKey: action.requestKey(payload) }), () => { onComplete?.(); onClose(); }, retail ? '号码已分配给客户' : '号码已转交并完成结算');
  }}><div className="lp-admin-dialog-body">
    {selectedHolding && <p className="lp-admin-confirm-target">{selectedHolding.phoneNumber} · {selectedHolding.service ?? regionName(selectedHolding.regionId)}</p>}
    <State loading={recipients.isFetching} error={recipients.error ? agentError(recipients.error) : ''} retry={() => void recipients.refetch()} data={recipients.data} />
    {confirmed ? <><Facts rows={[
      ['接收方', recipients.data?.find(item => item.id === target)?.name ?? target], ['开始时间', '确认后立即生效'], ['到期时间', <DateText value={confirmed.expiresAt} />],
    ]} /><p className="lp-admin-context">{retail ? '确认后号码归属客户，销售金额记入报表。' : '确认后从下级余额扣除货款，并计入你的余额。'}</p></> : <fieldset disabled={action.busy}>
      {!holding && <>
        <label>搜索自己的号码<input value={search} maxLength={64} onChange={event => { setSearch(event.target.value); setHoldingId(''); }} placeholder="输入号码进行搜索" /></label>
        <label>可转交号码<select required value={holdingId} onChange={event => setHoldingId(event.target.value)}><option value="">{available.isFetching ? '正在加载可转交号码…' : '请选择号码'}</option>{available.data?.map(item => <option key={item.id} value={item.id}>{item.phoneNumber} · {item.service}</option>)}</select></label>
        <State loading={available.isFetching} error={available.error ? agentError(available.error) : ''} retry={() => void available.refetch()} data={available.data} />
        <p className="lp-admin-context">列表最多显示 200 个号码，可输入号码缩小范围。</p>
      </>}
      {recipient ? <p className="lp-admin-context">接收代理：{recipient.name}</p> : <label>{retail ? '客户' : '接收代理'}<AppCombobox aria-label={retail ? '目标客户' : '接收代理'} value={target} onValueChange={setTarget} placeholder="请选择接收方" options={(recipients.data?.filter(item => item.status === 'ACTIVE') ?? []).map(item => ({ value: item.id, label: item.name }))} searchPlaceholder="搜索接收方" emptyMessage="没有启用的接收方" /></label>}
      {selectedHolding && <HoldingDurationField holding={selectedHolding} state={duration} />}
      {retail && <label>售价（记账）<input inputMode="decimal" value={price ?? (quote.data ? (quote.data.bookAmountMinor / 100).toFixed(2) : '')} onChange={event => setPrice(event.target.value)} placeholder="可选，默认使用客户参考售价" /></label>}
    </fieldset>}
    <SettlementPreview quote={quote.data} loading={quote.isFetching} error={quote.error} retail={retail} />
    {!retail && quote.data && !quote.data.sufficient && <ActionButton onClick={() => setTransferBalance(true)} disabled={action.busy}>给 TA 转余额 →</ActionButton>}
    <ErrorText error={action.error} />
  </div><FormFooter busy={action.busy} onClose={onClose} onBack={confirmed ? () => setConfirmed(null) : undefined} disabled={!valid || !!recipients.error || (!holding && (available.isFetching || !!available.error))} label={confirmed ? retail ? '确认分配' : '确认转交并结算' : retail ? '核对分配信息与金额' : '核对转交信息与金额'} /></form></Modal>
    {transferBalance && <BalanceTransfer agentId={agentId} recipientId={target} onClose={() => setTransferBalance(false)} onComplete={() => { void quote.refetch(); }} />}
  </>;
}
