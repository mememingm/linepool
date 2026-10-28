import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, Facts, Modal, State } from '../../admin/primitives';
import { agentQueryKey } from '../access';
import { agentError } from '../subagent-shared';
import { ErrorText, FormFooter, money, parseMoney, useAgentAction, useChildren } from './shared';

export default function BalanceTransfer({ agentId, recipientId = '', onClose, onComplete }: {
  agentId: string; recipientId?: string; onClose: () => void; onComplete?: () => void;
}) {
  const children = useChildren(agentId, true);
  const balances = useQuery({ queryKey: agentQueryKey(agentId, 'balances'), queryFn: async ({ signal }) => (await api.agentBalances({ signal })).data }, queryClient);
  const accounts = balances.data?.filter(item => item.ownerType === 'AGENT' && item.agentId === agentId) ?? [];
  const [target, setTarget] = useState(recipientId);
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const action = useAgentAction(agentId);
  const targets = (children.data ?? []).filter(item => item.status === 'ACTIVE');
  const selected = targets.find(item => item.id === target);
  const amountMinor = parseMoney(amount);
  const balance = accounts.find(account => account.currency === currency)?.balanceMinor ?? 0;
  const valid = !!selected && !!amountMinor && amountMinor <= balance && !!description.trim() && !children.error && !balances.error && !balances.isFetching;
  return <Modal title="转余额给下级" onClose={onClose} busy={action.busy}><form className="lp-agent-form" onSubmit={event => {
    event.preventDefault(); if (!valid || !selected || !amountMinor) return;
    if (!confirmed) { setConfirmed(true); return; }
    const payload = { fromOwner: { ownerType: 'AGENT' as const, agentId }, toOwner: { ownerType: 'AGENT' as const, agentId: selected.id }, currency, amountMinor, description: description.trim() };
    void action.run(() => api.agentTransfer({ ...payload, idempotencyKey: action.requestKey(payload) }), () => {
      void queryClient.invalidateQueries({ queryKey: ['settlement-preview'] });
      onComplete?.(); onClose();
    }, '余额已转给下级，流水已更新');
  }}><div className="lp-admin-dialog-body">
    {confirmed ? <><Facts rows={[
      ['接收方', selected?.name ?? '目标已不可用'], ['转移金额', money(amountMinor, currency)], ['当前余额', money(balance, currency)], ['说明', description],
    ]} /><p className="lp-admin-context">确认后立即扣减你的代理余额并计入下级账户，同时记录双方流水。</p><ActionButton disabled={action.busy} onClick={() => setConfirmed(false)}>返回修改</ActionButton></> : <fieldset disabled={action.busy}>
      <label>接收方<select required value={target} disabled={!!recipientId} onChange={event => setTarget(event.target.value)}><option value="">选择直属下级</option>{targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>币种<select value={currency} onChange={event => setCurrency(event.target.value)}>{[...new Set(['USD', ...accounts.map(item => item.currency)])].map(value => <option key={value}>{value}</option>)}</select></label>
      <p className="lp-admin-context">可用余额：{money(balance, currency)}</p>
      <label>金额<input required inputMode="decimal" value={amount} pattern="[0-9]+(\.[0-9]{1,2})?" onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label>
      {!!amountMinor && amountMinor > balance && <p role="alert" className="lp-admin-error">余额不足：需要 {money(amountMinor, currency)}，当前 {money(balance, currency)}。</p>}
      <label>转账说明<textarea required maxLength={200} value={description} onChange={event => setDescription(event.target.value)} /></label>
    </fieldset>}
    <State loading={children.isFetching || balances.isFetching} error={children.error || balances.error ? agentError(children.error ?? balances.error) : ''} retry={() => { void children.refetch(); void balances.refetch(); }} />
    <ErrorText error={action.error} />
  </div><FormFooter busy={action.busy} onClose={onClose} disabled={!valid} label={confirmed ? '确认转移余额' : '核对转账信息'} /></form></Modal>;
}
