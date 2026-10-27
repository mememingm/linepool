import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentTransactionsQuery, TxOrder } from '@linepool/contracts';
import { Download } from 'lucide-react';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, Badge, DateText, Facts, Modal, ShortId, State, Table, txKindLabel } from '../../admin/primitives';
import { agentQueryKey } from '../access';
import { AgentPager, agentError } from '../subagent-shared';
import { exportCsv, Filter, money, useChildren, useCustomers } from './shared';
import type { AgentPageProps } from '../pages';

const kinds: Record<TxOrder['kind'], string> = { PURCHASE: '购买', RENEW: '续期', TRANSFER: '号码交接 / 余额转账', ADJUSTMENT: '库存调整 / 余额调整' };
const statuses = { PENDING: '待处理', COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消' };
export default function OrdersPage({ access }: AgentPageProps) {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AgentTransactionsQuery['status']>('');
  const [kind, setKind] = useState<AgentTransactionsQuery['kind']>('');
  const [detail, setDetail] = useState<TxOrder | null>(null);
  const result = useQuery({ queryKey: agentQueryKey(access.context.agent.id, 'orders', page, pageSize, search, status, kind),
    queryFn: ({ signal }) => api.agentTransactions(page, pageSize, { signal }, { search, status, kind }) }, queryClient);
  const rows = result.data?.data ?? [];
  // Show people by name: myself, my sub-agents and my customers; anything else falls back to a short ID.
  const self = access.context.agent;
  const children = useChildren(self.id, access.context.capabilities.manageSubagents);
  const customers = useCustomers(self.id);
  function party(type: string | null, agent: string | null, customer?: string | null) {
    if (type === 'PLATFORM') return '平台';
    if (agent) return agent === self.id ? `${self.name}（我）` : children.data?.find(item => item.id === agent)?.name ?? <ShortId value={agent} />;
    if (customer) return customers.data?.find(item => item.id === customer)?.name ?? <ShortId value={customer} />;
    return '—';
  }
  return <>
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <Filter title="搜索订单"><input value={search} maxLength={64} placeholder="订单号" onChange={e => { setSearch(e.target.value); setPage(1); }} /></Filter>
      <Filter title="交易类型"><select value={kind} onChange={e => { setKind(e.target.value as typeof kind); setPage(1); }}><option value="">全部类型</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Filter>
      <Filter title="交易状态"><select value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1); }}><option value="">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Filter>
      <ActionButton disabled={!rows.length || !!result.error} onClick={() => exportCsv('代理交易-当前页.csv', [['订单号', '类型', '数量', '状态', '金额', '币种', '积分', '创建时间', '完成时间'], ...rows.map(order => [order.orderNumber, txKindLabel(order.orderNumber, order.kind), order.quantity > 1 ? order.quantity : '', statuses[order.status], (order.amountMinor / 100).toFixed(2), order.currency, order.points ?? '', order.createdAt, order.completedAt ?? ''])])}><Download size={16} />导出当前页</ActionButton>
    </div>
    <p className="lp-admin-context">你和你名下客户的所有交易：号码分配、转交、余额充值和转账。金额为 0 的号码交接不算销售收入。</p>
    <State loading={result.isFetching} error={result.error ? agentError(result.error) : ''} retry={() => void result.refetch()} data={result.data} empty={!rows.length} columns={7} />
    {!!rows.length && <Table columns={['订单号', '类型', '对方', '金额', '状态', '时间', '']} label="代理交易列表">{rows.map(order => <tr key={order.id}>
      <td><ShortId value={order.orderNumber} /></td><td>{txKindLabel(order.orderNumber, order.kind)}{order.quantity > 1 && <small> · {order.quantity.toLocaleString()} 个号码</small>}</td><td>{order.buyerAgentId === self.id ? party(order.sellerType, order.sellerAgentId) : party(order.buyerType, order.buyerAgentId, order.buyerCustomerId)}</td><td>{order.points ? `${order.points} 积分` : money(order.amountMinor, order.currency)}</td><td><span className="lp-admin-status">{statuses[order.status]}</span></td><td><DateText value={order.createdAt} /></td><td><ActionButton size="sm" onClick={() => setDetail(order)}>详情</ActionButton></td>
    </tr>)}</Table>}
    {result.data && <AgentPager {...result.data.pagination} busy={result.isFetching} onChange={(p, size) => { setPage(p); setPageSize(size); }} />}
    {detail && <Modal title="交易详情" onClose={() => setDetail(null)} variant="drawer"><div className="lp-admin-dialog-body"><Facts rows={[
      ['订单号', detail.orderNumber], ...(detail.quantity > 1 ? [['数量', `${detail.quantity.toLocaleString()} 个号码`] as [string, string]] : []), ['类型', txKindLabel(detail.orderNumber, detail.kind)], ['状态', <Badge value={detail.status} />], ['金额', money(detail.amountMinor, detail.currency)], ...(detail.points ? [['积分', detail.points] as [string, number]] : []), ['买方 / 转出方', party(detail.buyerType, detail.buyerAgentId, detail.buyerCustomerId)], ['卖方', party(detail.sellerType, detail.sellerAgentId)], ['接收方', party(detail.recipientType, detail.recipientAgentId, detail.recipientCustomerId)], ['价格类型', detail.pricingKind === 'WHOLESALE' ? '代理结算价' : '客户销售价'], ['创建时间', <DateText value={detail.createdAt} />], ['完成时间', <DateText value={detail.completedAt} />],
    ]} /></div></Modal>}
  </>;
}
