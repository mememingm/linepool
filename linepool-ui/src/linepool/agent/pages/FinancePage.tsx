import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OwnerRef } from '@linepool/contracts';
import { ArrowRightLeft, Download } from 'lucide-react';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, DateText, Facts, Modal, State, Table } from '../../admin/primitives';
import { agentQueryKey } from '../access';
import { AgentPager, agentError } from '../subagent-shared';
import { ErrorText, Filter, FormFooter, exportCsv, money, parseMoney, useAgentAction, useChildren, useCustomers } from './shared';
import type { AgentPageProps } from '../pages';

const entryLabels: Record<string, string> = { TOPUP: '充值', ORDER_DEBIT: '订单扣款', COMMISSION: '佣金', TRANSFER_IN: '转入', TRANSFER_OUT: '转出', ADJUSTMENT: '平台充值 / 扣减' };
export default function FinancePage({ access, address }: AgentPageProps) {
  const agentId = access.context.agent.id;
  const customers = useCustomers(agentId);
  const balances = useQuery({ queryKey: agentQueryKey(agentId, 'balances'), queryFn: async ({ signal }) => (await api.agentBalances({ signal })).data }, queryClient);
  const requested = new URLSearchParams(address.split('?')[1]).get('customer') ?? '';
  const [customerId, setCustomerId] = useState(requested);
  const [currency, setCurrency] = useState('USD');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [transfer, setTransfer] = useState(false);
  const allowed = !customerId || !!customers.data?.some(customer => customer.id === customerId);
  const owner: OwnerRef = customerId ? { ownerType: 'CUSTOMER', customerId } : { ownerType: 'AGENT', agentId };
  const ledger = useQuery({ queryKey: agentQueryKey(agentId, 'ledger', customerId, currency, page, pageSize), enabled: allowed,
    queryFn: ({ signal }) => api.agentLedger(owner, page, pageSize, { signal }, currency) }, queryClient);
  const ownAccounts = balances.data?.filter(account => account.ownerType === 'AGENT' && account.agentId === agentId) ?? [];
  const currencies = [...new Set(['USD', ...ownAccounts.map(account => account.currency), ...(balances.data ?? []).filter(account => account.customerId === customerId).map(account => account.currency)])];
  return <>
    <div className="lp-agent-account-summary">
      <div><span>我的代理余额</span><strong>{balances.data ? ownAccounts.map(account => money(account.balanceMinor, account.currency)).join(' / ') || '尚未建立余额账户' : balances.error ? '加载失败' : '正在加载…'}</strong></div>
      <ActionButton variant="accent" onClick={() => setTransfer(true)} disabled={!ownAccounts.length || !!balances.error}><ArrowRightLeft size={16} />转移余额</ActionButton>
    </div>
    <p className="lp-admin-context">代理余额以美元计，和普通工作台里的「积分」是两套账。这里能看自己和名下客户的流水；转给下级代理的钱，之后在对方账户里，你看不到对方流水。</p>
    {balances.error && <State loading={balances.isFetching} error={agentError(balances.error)} retry={() => void balances.refetch()} data={balances.data} />}
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <Filter title="流水账户"><select value={customerId} onChange={e => { setCustomerId(e.target.value); setPage(1); }}><option value="">我的代理账户</option>{customers.data?.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}{customerId && !allowed && <option value={customerId}>客户不可访问</option>}</select></Filter>
      <Filter title="币种"><select value={currency} onChange={e => { setCurrency(e.target.value); setPage(1); }}>{currencies.map(value => <option key={value}>{value}</option>)}</select></Filter>
      <ActionButton disabled={!ledger.data?.data.entries.length || !allowed} onClick={() => exportCsv('代理账户流水-当前页.csv', [['流水 ID', '类型', '变动金额', '余额', '币种', '说明', '关联交易', '时间'], ...(ledger.data?.data.entries ?? []).map(entry => [entry.id, entryLabels[entry.type] ?? entry.type, (entry.delta / 100).toFixed(2), (entry.balanceAfter / 100).toFixed(2), currency, entry.description, entry.txOrderId ?? '', entry.createdAt])])}><Download size={16} />导出当前页</ActionButton>
      {allowed && ledger.data && <span className="lp-admin-muted">账户余额：{money(ledger.data.data.balanceMinor, ledger.data.data.currency)}</span>}
    </div>
    {customers.error && <State loading={customers.isFetching} error={agentError(customers.error)} retry={() => void customers.refetch()} />}
    {!allowed && customers.data ? <p role="alert" className="lp-admin-error">该客户不在直属客户范围内，请选择自己的账户或直属客户。</p> : <State loading={ledger.isFetching || customers.isPending} error={ledger.error ? agentError(ledger.error) : ''} retry={() => void ledger.refetch()} data={allowed ? ledger.data : undefined} empty={allowed && ledger.data?.data.entries.length === 0} columns={5} />}
    {allowed && !!ledger.data?.data.entries.length && <Table columns={['类型', '变动金额', '变动后余额', '说明', '时间']} label="代理账户流水">{ledger.data.data.entries.map(entry => <tr key={entry.id}>
      <td>{entryLabels[entry.type] ?? entry.type}</td><td className={entry.delta >= 0 ? 'lp-agent-credit' : ''}>{entry.delta > 0 ? '+' : ''}{money(entry.delta, currency)}</td><td>{money(entry.balanceAfter, currency)}</td><td>{entry.description}</td><td><DateText value={entry.createdAt} /></td>
    </tr>)}</Table>}
    {allowed && ledger.data && <AgentPager {...ledger.data.pagination} busy={ledger.isFetching} onChange={(p, size) => { setPage(p); setPageSize(size); }} />}
    {transfer && <BalanceTransfer access={access} onClose={() => setTransfer(false)} accounts={ownAccounts} />}
  </>;
}

function BalanceTransfer({ access, accounts, onClose }: { access: AgentPageProps['access']; accounts: Array<{ currency: string; balanceMinor: number }>; onClose: () => void }) {
  const agentId = access.context.agent.id;
  const customers = useCustomers(agentId); const children = useChildren(agentId, access.context.capabilities.manageSubagents);
  const [target, setTarget] = useState('');
  const [currency, setCurrency] = useState(accounts[0]?.currency ?? 'USD');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const action = useAgentAction(agentId);
  const targets = [...(customers.data ?? []).filter(item => item.status === 'ACTIVE').map(item => ({ key: `CUSTOMER:${item.id}`, name: `${item.name}（客户）`, owner: { ownerType: 'CUSTOMER' as const, customerId: item.id } })), ...(children.data ?? []).filter(item => item.status === 'ACTIVE').map(item => ({ key: `AGENT:${item.id}`, name: `${item.name}（直属下级）`, owner: { ownerType: 'AGENT' as const, agentId: item.id } }))];
  const selected = targets.find(item => item.key === target);
  const amountMinor = parseMoney(amount);
  const balance = accounts.find(account => account.currency === currency)?.balanceMinor ?? 0;
  const valid = !!selected && !!amountMinor && amountMinor <= balance && !!description.trim();
  return <Modal title="转移代理余额" onClose={onClose} busy={action.busy}><form className="lp-agent-form" onSubmit={e => {
    e.preventDefault(); if (!valid || !selected || !amountMinor) return;
    if (!confirmed) { setConfirmed(true); return; }
    const payload = { fromOwner: { ownerType: 'AGENT' as const, agentId }, toOwner: selected.owner, currency, amountMinor, description: description.trim() };
    void action.run(() => api.agentTransfer({ ...payload, idempotencyKey: action.requestKey(payload) }), onClose, '余额已转移，流水已更新');
  }}><div className="lp-admin-dialog-body">
    {confirmed ? <><Facts rows={[
      ['接收方', selected?.name ?? '目标已不可用'], ['转移金额', money(amountMinor, currency)], ['当前余额', money(balance, currency)], ['说明', description],
    ]} /><p className="lp-admin-context">确认后立即扣减你的代理余额并计入接收方账户，同时记录双方流水。请核对接收方和金额。</p><ActionButton disabled={action.busy} onClick={() => setConfirmed(false)}>返回修改</ActionButton></> : <fieldset disabled={action.busy}>
      <label>接收方<select required value={target} onChange={e => setTarget(e.target.value)}><option value="">选择直属客户或下级</option>{targets.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
      <label>币种<select value={currency} onChange={e => setCurrency(e.target.value)}>{accounts.map(account => <option key={account.currency}>{account.currency}</option>)}</select></label>
      <p className="lp-admin-context">可用余额：{money(balance, currency)}</p>
      <label>金额<input required inputMode="decimal" value={amount} pattern="[0-9]+(\.[0-9]{1,2})?" onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
      {!!amountMinor && amountMinor > balance && <p role="alert" className="lp-admin-error">转移金额超过可用余额。</p>}
      <label>转账说明<textarea required maxLength={200} value={description} onChange={e => setDescription(e.target.value)} /></label>
    </fieldset>}
    {customers.error && <State loading={customers.isFetching} error={agentError(customers.error)} retry={() => void customers.refetch()} />}
    {children.error && <State loading={children.isFetching} error={agentError(children.error)} retry={() => void children.refetch()} />}
    <ErrorText error={action.error} />
  </div><FormFooter busy={action.busy} onClose={onClose} disabled={!valid} label={confirmed ? '确认转移余额' : '核对转账信息'} /></form></Modal>;
}
