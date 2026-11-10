import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { DateText, Facts, Modal, State, Table, regionName } from '../admin/primitives';
import { AgentPager, agentError } from './subagent-shared';
import { money } from './legacy-shared';

export default function SettlementOrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const result = useQuery({ queryKey: ['settlement-order', id, page, pageSize], queryFn: async ({ signal }) => (await api.agentSettlementOrder(id, page, pageSize, { signal })).data }, queryClient);
  const data = result.data;
  const order = data?.order;
  return <Modal title="结算订单明细" onClose={onClose} variant="drawer"><div className="lp-admin-dialog-body">
    <State loading={result.isFetching} error={result.error ? agentError(result.error) : ''} retry={() => void result.refetch()} data={data} />
    {order && <Facts rows={[
      ['订单号', order.orderNumber], ['订单状态', order.status === 'COMPLETED' ? '已完成' : order.status],
      ['实际结算金额', money(order.amountMinor, order.currency)], ['客户售价（记账）', money(order.bookAmountMinor, order.currency)],
      ...(order.costMinor == null ? [] : [['已售号码成本', money(order.costMinor, order.currency)] as [string, string]]),
      ['成交时间', <DateText value={order.completedAt ?? order.createdAt} />],
    ]} />}
    {data && <>
      <p className="lp-admin-context">单价为成交时的 30 天价格快照。客户售价只记账，需自行向客户收款。</p>
      {data.items.length ? <Table columns={['号码', '平台 / 国家', '30 天单价', '天数', '结算金额', '客户售价（记账）']} label="订单号码明细">{data.items.map((item, index) => <tr key={`${item.phoneNumber}:${index}`}>
        <td>{item.phoneNumber}</td><td>{item.service} / {regionName(item.regionId)}</td><td>{money(item.unitAmountMinor, order!.currency)}</td><td>{item.billedDays} 天</td>
        <td>{money(item.amountMinor, order!.currency)}</td><td>{money(item.bookAmountMinor, order!.currency)}</td>
      </tr>)}</Table> : <p className="lp-admin-context">该交易没有号码结算明细。</p>}
      <AgentPager {...data.pagination} busy={result.isFetching} onChange={(next, size) => { setPage(next); setPageSize(size); }} />
    </>}
  </div></Modal>;
}
