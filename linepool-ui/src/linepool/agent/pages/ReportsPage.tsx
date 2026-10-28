import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentMetricPeriod } from '@linepool/contracts';
import { Download } from 'lucide-react';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, State, Table } from '../../admin/primitives';
import { agentQueryKey } from '../access';
import { agentError } from '../subagent-shared';
import { exportCsv, Filter, money } from './shared';
import type { AgentPageProps } from '../pages';
import SettlementMetrics from '../SettlementMetrics';

export default function ReportsPage({ access }: AgentPageProps) {
  const [period, setPeriod] = useState<AgentMetricPeriod>('7d');
  const result = useQuery({ queryKey: agentQueryKey(access.context.agent.id, 'dashboard', period), queryFn: async ({ signal }) => (await api.agentDashboard(period, { signal })).data }, queryClient);
  const data = result.data;
  const codes = data?.codeVolume.reduce((total, row) => total + row.count, 0);
  // Money columns appear only once settlement data exists; otherwise every cell would read 待核算.
  const hasMoney = Boolean(data?.trend.some(row => row.salesMinor != null));
  const records = data?.trend.map(row => ({ ...row, codes: data.codeVolume.filter(bucket => bucket.bucket === row.date).reduce((total, bucket) => total + bucket.count, 0) })) ?? [];
  return <>
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <Filter title="统计周期"><select value={period} onChange={e => setPeriod(e.target.value as AgentMetricPeriod)}><option value="today">今日</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></Filter>
      <ActionButton disabled={!data || !!result.error} onClick={() => exportCsv(`代理经营报表-${period}.csv`, [['日期 / 小时', '接码量', '销售额（含客户记账）', '已售成本', '毛利', '币种'], ...records.map(row => [row.date, row.codes, row.salesMinor == null ? '待核算' : (row.salesMinor / 100).toFixed(2), row.costMinor == null ? '待核算' : (row.costMinor / 100).toFixed(2), row.profitMinor == null ? '待核算' : (row.profitMinor / 100).toFixed(2), data!.currency])])}><Download size={16} />导出经营报表</ActionButton>
    </div>
    <p className="lp-admin-context">按北京时间每天统计，选「今日」时按小时显示。接码量只统计你有效号码收到的短信。</p>
    <State loading={result.isFetching} error={result.error ? agentError(result.error) : ''} retry={() => void result.refetch()} data={data} columns={5} />
    {data && <>
      <SettlementMetrics data={data} partner={access.tier === 'PARTNER'} />
      <div className="lp-agent-account-summary"><div><span>本周期接码量</span><strong>{codes ?? '—'}</strong></div><div><span>当前持有号码</span><strong>{data.kpis.currentInventory ?? '—'}</strong></div></div>
      <Table columns={hasMoney ? ['日期 / 小时', '接码量', '销售额（含客户记账）', '已售成本', '毛利'] : ['日期 / 小时', '接码量']} label="经营周期报表">{records.map(row => <tr key={row.date}><td>{row.date}</td><td>{row.codes}</td>{hasMoney && <><td>{money(row.salesMinor, data.currency)}</td><td>{money(row.costMinor, data.currency)}</td><td>{money(row.profitMinor, data.currency)}</td></>}</tr>)}</Table>
      {data.subagents && <><div className="lp-admin-section-heading"><h2>直属下级经营汇总</h2></div>{data.subagents.length ? <Table columns={['代理名称', '接码量', '当前库存', '我向下级销售额', '我的毛利']} label="直属下级经营报表">{data.subagents.map(child => <tr key={child.agentId}><td>{child.name}</td><td>{child.codeCount}</td><td>{child.inventoryCount}</td><td>{money(child.salesMinor, data.currency)}</td><td>{money(child.profitMinor, data.currency)}</td></tr>)}</Table> : <p className="lp-admin-context">暂无直属下级代理。</p>}</>}
      {!hasMoney && <p className="lp-admin-context">销售额、成本和利润会在客户下单结算接入后显示。</p>}
    </>}
  </>;
}
