import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { apiMessage } from '../workspace-reference/workspace-data';
import SelectField from '../SelectField';
import { ActionButton, Badge, DateText, Table } from './primitives';

const outcomeLabels: Record<string, string> = {
  DELIVERED: '已投递',
  UNMATCHED: '未识别平台',
  AMBIGUOUS: '无法唯一匹配',
  NO_BUYER: '无有效买家',
};
const attemptLabels: Record<string, string> = {
  RETRYING: '等待重试',
  FAILED: '投递失败',
};

/** Immutable shop delivery outcomes plus mutable failed-attempt recovery. */
export default function ShopDeliveries() {
  const p = useDisplayPreferences();
  const [view, setView] = useState<'deliveries' | 'attempts'>('deliveries');
  const [outcome, setOutcome] = useState('');
  const [attemptStatus, setAttemptStatus] = useState('');
  const [retrying, setRetrying] = useState('');
  const [retryError, setRetryError] = useState('');
  const deliveries = useQuery({
    queryKey: ['admin-shop-deliveries', outcome],
    queryFn: async ({ signal }) => api.adminShopDeliveries({ page: 1, pageSize: 50, ...(outcome ? { outcome: outcome as 'DELIVERED' | 'UNMATCHED' | 'AMBIGUOUS' | 'NO_BUYER' } : {}) }, { signal }),
    staleTime: 0,
  }, queryClient);
  const attempts = useQuery({
    queryKey: ['admin-shop-delivery-attempts', attemptStatus],
    queryFn: async ({ signal }) => api.adminShopDeliveryAttempts({ page: 1, pageSize: 50, ...(attemptStatus ? { status: attemptStatus as 'RETRYING' | 'FAILED' } : {}) }, { signal }),
    staleTime: 0,
  }, queryClient);
  const deliveryRows = deliveries.data?.data ?? [];
  const attemptRows = attempts.data?.data ?? [];

  async function retry(provider: 'pingcode' | 'pingcode-mock', externalMessageId: string) {
    if (retrying) return;
    setRetrying(externalMessageId); setRetryError('');
    try {
      await api.adminRetryShopDeliveryAttempt(provider, externalMessageId);
      toast.success(p.t('已加入补投队列，Worker 会在下一轮处理。'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-shop-delivery-attempts'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-shop-deliveries'] }),
      ]);
    } catch (cause) { setRetryError(apiMessage(cause)); }
    finally { setRetrying(''); }
  }

  return <details className="lp-admin-tech" open>
    <summary>{p.t('店铺投递')}</summary>
    <p className="lp-admin-context">{p.t('店铺代理收到的短信按发送方或正文关键词识别平台后投递给该号码在该平台的有效买家；未命中、无法唯一匹配或无有效买家的记录只在这里留档。投递失败只影响买家投递，不影响代理工作台。')}</p>
    <div className="lp-admin-status-chips" role="group" aria-label={p.t('店铺投递视图')}>
      <button type="button" aria-pressed={view === 'deliveries'} onClick={() => setView('deliveries')}>{p.t('投递结果')}</button>
      <button type="button" aria-pressed={view === 'attempts'} onClick={() => setView('attempts')}>{p.t('投递失败')}{attempts.data ? ` (${attempts.data.pagination.totalItems})` : ''}</button>
    </div>
    {view === 'deliveries' ? <>
      <label>{p.t('投递结果')}<SelectField aria-label={p.t('筛选店铺投递结果')} value={outcome} onValueChange={setOutcome} options={[
        { value: '', label: p.t('全部结果') },
        ...Object.entries(outcomeLabels).map(([value, label]) => ({ value, label: p.t(label) })),
      ]} /></label>
      {deliveries.isError && <p className="lp-admin-error" role="alert">{apiMessage(deliveries.error)}</p>}
      {deliveries.isPending && <p className="lp-admin-context">{p.t('正在读取店铺投递记录…')}</p>}
      {!deliveries.isPending && !deliveryRows.length && <p className="lp-admin-context">{p.t('暂无店铺投递记录。')}</p>}
      {Boolean(deliveryRows.length) && <Table label={p.t('店铺投递')} columns={[p.t('时间'), p.t('号码'), p.t('发送方'), p.t('命中平台'), p.t('结果'), p.t('买家')]}>
        {deliveryRows.map(row => <tr key={`${row.provider}/${row.externalMessageId}`}>
          <td><DateText value={row.occurredAt} /></td>
          <td><strong className="lp-admin-mono">{row.phoneNumber ?? '—'}</strong></td>
          <td>{row.sender ?? '—'}</td>
          <td>{row.platformName ?? row.platformId ?? '—'}</td>
          <td><Badge value={row.outcome} /></td>
          <td>{row.buyerName ?? row.buyerEmail ?? '—'}</td>
        </tr>)}
      </Table>}
      {deliveries.data && <p className="lp-admin-context">{p.t('共')}{deliveries.data.pagination.totalItems}{p.t(' 条')}</p>}
    </> : <>
      <label>{p.t('失败状态')}<SelectField aria-label={p.t('筛选投递失败状态')} value={attemptStatus} onValueChange={setAttemptStatus} options={[
        { value: '', label: p.t('全部状态') },
        ...Object.entries(attemptLabels).map(([value, label]) => ({ value, label: p.t(label) })),
      ]} /></label>
      {retryError && <p className="lp-admin-error" role="alert">{retryError}</p>}
      {attempts.isError && <p className="lp-admin-error" role="alert">{apiMessage(attempts.error)}</p>}
      {attempts.isPending && <p className="lp-admin-context">{p.t('正在读取投递失败记录…')}</p>}
      {!attempts.isPending && !attemptRows.length && <p className="lp-admin-context">{p.t('暂无投递失败记录。')}</p>}
      {Boolean(attemptRows.length) && <Table label={p.t('投递失败')} columns={[p.t('时间'), p.t('号码'), p.t('发送方'), p.t('次数'), p.t('最后错误'), p.t('状态'), '']}>
        {attemptRows.map(row => <tr key={`${row.provider}/${row.externalMessageId}`}>
          <td><DateText value={row.updatedAt} /></td>
          <td><strong className="lp-admin-mono">{row.phoneNumber ?? '—'}</strong></td>
          <td>{row.sender ?? '—'}</td>
          <td className="lp-admin-numeric">{row.attempts}</td>
          <td><span title={row.lastError}>{row.lastError.length > 80 ? `${row.lastError.slice(0, 80)}…` : row.lastError}</span></td>
          <td><Badge value={row.status} /></td>
          <td><ActionButton size="sm" disabled={row.status !== 'FAILED' || Boolean(retrying)} busy={retrying === row.externalMessageId} onClick={() => void retry(row.provider, row.externalMessageId)}>{p.t('重试')}</ActionButton></td>
        </tr>)}
      </Table>}
      {attempts.data && <p className="lp-admin-context">{p.t('共')}{attempts.data.pagination.totalItems}{p.t(' 条')}</p>}
    </>}
  </details>;
}
