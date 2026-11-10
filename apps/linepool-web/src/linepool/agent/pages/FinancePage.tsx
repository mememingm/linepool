import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OwnerRef } from '@linepool/contracts';
import { ArrowRightLeft, Download } from 'lucide-react';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, DateText, State, Table } from '../../admin/primitives';
import { agentQueryKey } from '../access';
import { AgentPager, agentError } from '../subagent-shared';
import { Filter, exportCsv, money, useChildren, useCustomers } from './shared';
import BalanceTransfer from './BalanceTransfer';
import SettlementOrderDrawer from '../SettlementOrderDrawer';
import type { AgentPageProps } from '../pages';

const entryLabels: Record<string, string> = { TOPUP: '充值', ORDER_DEBIT: '进货扣款', COMMISSION: '佣金', TRANSFER_IN: '转入', TRANSFER_OUT: '转出', ADJUSTMENT: '平台充值 / 扣减' };
export default function FinancePage({ access, address }: AgentPageProps) {
  const agentId = access.context.agent.id;
  const customers = useCustomers(agentId);
  const children = useChildren(agentId, access.context.capabilities.manageSubagents);
  const balances = useQuery({ queryKey: agentQueryKey(agentId, 'balances'), queryFn: async ({ signal }) => (await api.agentBalances({ signal })).data }, queryClient);
  const requested = new URLSearchParams(address.split('?')[1]).get('customer') ?? '';
  const [customerId, setCustomerId] = useState(requested);
  const [currency, setCurrency] = useState('USD');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [transfer, setTransfer] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const entryLabel = (entry: { type: string; description: string }) => entry.description === '下级进货收入' ? '下级进货收入' : entryLabels[entry.type] ?? entry.type;
  const allowed = !customerId || !!customers.data?.some(customer => customer.id === customerId);
  const owner: OwnerRef = customerId ? { ownerType: 'CUSTOMER', customerId } : { ownerType: 'AGENT', agentId };
  const ledger = useQuery({ queryKey: agentQueryKey(agentId, 'ledger', customerId, currency, page, pageSize), enabled: allowed,
    queryFn: ({ signal }) => api.agentLedger(owner, page, pageSize, { signal }, currency) }, queryClient);
  const ownAccounts = balances.data?.filter(account => account.ownerType === 'AGENT' && account.agentId === agentId) ?? [];
  const currencies = [...new Set(['USD', ...ownAccounts.map(account => account.currency), ...(balances.data ?? []).filter(account => account.customerId === customerId).map(account => account.currency)])];
  return <>
    <div className="lp-agent-account-summary">
      <div><span>我的代理余额</span><strong>{balances.data ? ownAccounts.map(account => money(account.balanceMinor, account.currency)).join(' / ') || '尚未建立余额账户' : balances.error ? '加载失败' : '正在加载…'}</strong></div>
      {children.data?.some(child => child.status === 'ACTIVE') && <ActionButton variant="accent" onClick={() => setTransfer(true)} disabled={!ownAccounts.length || !!balances.error}><ArrowRightLeft size={16} />转余额给下级</ActionButton>}
    </div>
    <p className="lp-admin-context">代理余额以美元计，和普通工作台里的「积分」是两套账。这里能看自己和名下客户的流水；转给下级代理的钱，之后在对方账户里，你看不到对方流水。</p>
    {balances.error && <State loading={balances.isFetching} error={agentError(balances.error)} retry={() => void balances.refetch()} data={balances.data} />}
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <Filter title="流水账户"><select value={customerId} onChange={e => { setCustomerId(e.target.value); setPage(1); }}><option value="">我的代理账户</option>{customers.data?.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}{customerId && !allowed && <option value={customerId}>客户不可访问</option>}</select></Filter>
      <Filter title="币种"><select value={currency} onChange={e => { setCurrency(e.target.value); setPage(1); }}>{currencies.map(value => <option key={value}>{value}</option>)}</select></Filter>
      <ActionButton disabled={!ledger.data?.data.entries.length || !allowed} onClick={() => exportCsv('代理账户流水-当前页.csv', [['流水 ID', '类型', '变动金额', '余额', '币种', '说明', '关联交易', '时间'], ...(ledger.data?.data.entries ?? []).map(entry => [entry.id, entryLabel(entry), (entry.delta / 100).toFixed(2), (entry.balanceAfter / 100).toFixed(2), currency, entry.description, entry.txOrderId ?? '', entry.createdAt])])}><Download size={16} />导出当前页</ActionButton>
      {allowed && ledger.data && <span className="lp-admin-muted">账户余额：{money(ledger.data.data.balanceMinor, ledger.data.data.currency)}</span>}
    </div>
    {customers.error && <State loading={customers.isFetching} error={agentError(customers.error)} retry={() => void customers.refetch()} />}
    {!allowed && customers.data ? <p role="alert" className="lp-admin-error">该客户不在直属客户范围内，请选择自己的账户或直属客户。</p> : <State loading={ledger.isFetching || customers.isPending} error={ledger.error ? agentError(ledger.error) : ''} retry={() => void ledger.refetch()} data={allowed ? ledger.data : undefined} empty={allowed && ledger.data?.data.entries.length === 0} columns={5} />}
    {allowed && !!ledger.data?.data.entries.length && <Table columns={['类型', '变动金额', '变动后余额', '说明', '时间', '关联交易']} label="代理账户流水">{ledger.data.data.entries.map(entry => <tr key={entry.id}>
      <td>{entryLabel(entry)}</td><td className={entry.delta >= 0 ? 'lp-agent-credit' : ''}>{entry.delta > 0 ? '+' : ''}{money(entry.delta, currency)}</td><td>{money(entry.balanceAfter, currency)}</td><td>{entry.description}</td><td><DateText value={entry.createdAt} /></td><td>{entry.txOrderId && <ActionButton size="sm" onClick={() => setOrderId(entry.txOrderId)}>查看订单</ActionButton>}</td>
    </tr>)}</Table>}
    {allowed && ledger.data && <AgentPager {...ledger.data.pagination} busy={ledger.isFetching} onChange={(p, size) => { setPage(p); setPageSize(size); }} />}
    {orderId && <SettlementOrderDrawer id={orderId} onClose={() => setOrderId(null)} />}
    {transfer && <BalanceTransfer agentId={agentId} onClose={() => setTransfer(false)} />}
  </>;
}
