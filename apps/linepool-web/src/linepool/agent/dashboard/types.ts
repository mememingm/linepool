import type { AgentDashboard, AgentDashboard as AgentDashboardContract, AgentMetricPeriod } from '../../api/contracts';

export type MetricPeriod = AgentMetricPeriod;
export const metricPeriodLabels: Record<MetricPeriod, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' };
export type CostStatus = AgentDashboard['costStatus'];
export const costStatusLabels: Record<CostStatus, string> = {
  SYNCED: '成本已同步', PENDING_SYNC: '成本待同步', LOCAL_SIMULATED: '本地模拟成本', UNAVAILABLE: '暂不计算真实利润',
};
export type AgentDashboardData = AgentDashboardContract;
export type AgentKpiKey = keyof AgentDashboard['kpis'];
export type TrendPoint = AgentDashboard['trend'][number];
export type CodeVolumePoint = AgentDashboard['codeVolume'][number];
export type InventoryBucket = keyof AgentDashboard['inventoryStatus'];
export const inventoryBucketLabels: Record<InventoryBucket, string> = {
  AVAILABLE: '可售（还没卖出）', SELF_ASSIGNED: '我持有的（含可售）', SUBAGENT_ASSIGNED: '已分配给下级', USED: '已使用', EXPIRED: '已过期', ERROR: '异常',
};
export type ServiceRankingRow = AgentDashboard['serviceRanking'][number];
export type SubagentSummaryRow = NonNullable<AgentDashboard['subagents']>[number];
