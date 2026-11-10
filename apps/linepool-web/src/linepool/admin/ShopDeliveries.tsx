import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { apiMessage } from '../workspace-reference/workspace-data';
import SelectField from '../SelectField';
import { Badge, DateText, Table } from './primitives';

const outcomeLabels: Record<string, string> = {
  DELIVERED: '已投递',
  UNMATCHED: '未识别平台',
  AMBIGUOUS: '无法唯一匹配',
  NO_BUYER: '无有效买家',
};

/** Immutable shop delivery outcomes; the agent-facing receipt list stays unchanged above this view. */
export default function ShopDeliveries() {
  const p = useDisplayPreferences();
  const [outcome, setOutcome] = useState('');
  const result = useQuery({
    queryKey: ['admin-shop-deliveries', outcome],
    queryFn: async ({ signal }) => api.adminShopDeliveries({ page: 1, pageSize: 50, ...(outcome ? { outcome: outcome as 'DELIVERED' | 'UNMATCHED' | 'AMBIGUOUS' | 'NO_BUYER' } : {}) }, { signal }),
    staleTime: 0,
  }, queryClient);
  const rows = result.data?.data ?? [];
  return <details className="lp-admin-tech" open>
    <summary>{p.t('店铺投递')}</summary>
    <p className="lp-admin-context">{p.t('店铺代理收到的短信按发送方或正文关键词识别平台后投递给该号码在该平台的有效买家；未命中、无法唯一匹配或无有效买家的记录只在这里留档。')}</p>
    <label>{p.t('投递结果')}<SelectField aria-label={p.t('筛选店铺投递结果')} value={outcome} onValueChange={setOutcome} options={[
      { value: '', label: p.t('全部结果') },
      ...Object.entries(outcomeLabels).map(([value, label]) => ({ value, label: p.t(label) })),
    ]} /></label>
    {result.isError && <p className="lp-admin-error" role="alert">{apiMessage(result.error)}</p>}
    {result.isPending && <p className="lp-admin-context">{p.t('正在读取店铺投递记录…')}</p>}
    {!result.isPending && !rows.length && <p className="lp-admin-context">{p.t('暂无店铺投递记录。')}</p>}
    {Boolean(rows.length) && <Table label={p.t('店铺投递')} columns={[p.t('时间'), p.t('号码'), p.t('发送方'), p.t('命中平台'), p.t('结果'), p.t('买家')]}>
      {rows.map(row => <tr key={`${row.provider}/${row.externalMessageId}`}>
        <td><DateText value={row.occurredAt} /></td>
        <td><strong className="lp-admin-mono">{row.phoneNumber ?? '—'}</strong></td>
        <td>{row.sender ?? '—'}</td>
        <td>{row.platformName ?? row.platformId ?? '—'}</td>
        <td><Badge value={row.outcome} /></td>
        <td>{row.buyerName ?? row.buyerEmail ?? '—'}</td>
      </tr>)}
    </Table>}
    {result.data && <p className="lp-admin-context">{p.t('共')}{result.data.pagination.totalItems}{p.t(' 条')}</p>}
  </details>;
}
