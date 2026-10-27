import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { State } from '../../admin/primitives';
import type { AgentPageProps } from '../pages';
import { AgentMetricCards } from './AgentMetricCards';
import { AgentCodeVolumeChart, AgentInventoryChart, AgentProfitChart, AgentRevenueChart } from './AgentCharts';
import { AgentSettlementTable } from './AgentSettlementTable';
import type { AgentDashboardData, MetricPeriod } from './types';
import { agentQueryKey } from '../access';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { agentError } from '../subagent-shared';

function useAgentDashboard(agentId: string, period: MetricPeriod, revision: number): { data: AgentDashboardData | undefined; loading: boolean; error: string; retry: () => void } {
  const query = useQuery({
    queryKey: agentQueryKey(agentId, 'dashboard', period, revision),
    queryFn: ({ signal }) => api.agentDashboard(period, { signal }).then(result => result.data),
    enabled: Boolean(agentId),
    staleTime: 30_000,
  }, queryClient);
  return { data: query.data, loading: query.isPending || query.isFetching, error: query.error ? agentError(query.error) : '', retry: () => void query.refetch() };
}

/** §5.1 partner overview / §5.2 subagent overview. Same components, scope decided by the backend. */
export default function AgentDashboard({ access, revision }: AgentPageProps) {
  const [period, setPeriod] = useState<MetricPeriod>('7d');
  const { data, loading, error, retry } = useAgentDashboard(access.context.agent.id, period, revision);
  const chart = { data, period, onPeriodChange: setPeriod };
  // Sales and profit panels stay hidden until order settlement produces real figures.
  const hasSales = Boolean(data?.trend.some(row => row.salesMinor != null));
  const hasRanking = Boolean(data?.serviceRanking.length);
  return <>
    {error && <State loading={loading} error={error} retry={retry} data={data} columns={4} />}
    <AgentMetricCards tier={access.tier} data={data} loading={loading} />
    <div className="lp-agent-chart-grid">
      {hasSales && <AgentRevenueChart {...chart} />}
      <AgentCodeVolumeChart {...chart} />
      {access.tier === 'PARTNER' && <AgentInventoryChart data={data} />}
      {hasRanking && <AgentProfitChart {...chart} />}
    </div>
    {data && !hasSales && <p className="lp-admin-context">销售额和利润会在客户下单结算接入后显示。</p>}
    {access.tier === 'PARTNER'
      ? <AgentSettlementTable data={data} />
      : null}
  </>;
}
