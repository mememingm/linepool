import { Boxes, MessageSquare, Network, ReceiptText, TrendingUp, Users, WalletCards, type LucideIcon } from 'lucide-react';
import { Card } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { agentHref, type AgentPage, type AgentTier } from '../navigation';
import type { AgentDashboardData, AgentKpiKey } from './types';

type MetricDefinition = { key: AgentKpiKey; label: string; kind: 'money' | 'count' | 'profit'; icon: LucideIcon; page?: AgentPage };
const partnerMetrics: MetricDefinition[] = [
  { key: 'balance', label: '当前余额', kind: 'money', icon: WalletCards, page: 'finance' },
  { key: 'availableInventory', label: '可售号码', kind: 'count', icon: Boxes, page: 'inventory' },
  { key: 'subagentCount', label: '直属下级代理', kind: 'count', icon: Network, page: 'agents' },
  { key: 'customerCount', label: '客户数量', kind: 'count', icon: Users, page: 'customers' },
  { key: 'todaySales', label: '今日销售额', kind: 'money', icon: TrendingUp, page: 'orders' },
  { key: 'todayProfit', label: '今日利润', kind: 'profit', icon: TrendingUp, page: 'finance' },
  { key: 'todayCodes', label: '今日接码数量', kind: 'count', icon: MessageSquare, page: 'reports' },
];
const subagentMetrics: MetricDefinition[] = [
  { key: 'todaySales', label: '今日销售额', kind: 'money', icon: TrendingUp, page: 'orders' },
  { key: 'todayProfit', label: '今日利润', kind: 'profit', icon: TrendingUp, page: 'finance' },
  { key: 'currentInventory', label: '当前库存', kind: 'count', icon: Boxes, page: 'inventory' },
  { key: 'customerCount', label: '客户数量', kind: 'count', icon: Users, page: 'customers' },
  { key: 'todayOrders', label: '今日订单数', kind: 'count', icon: ReceiptText, page: 'orders' },
  { key: 'todayCodes', label: '今日接码量', kind: 'count', icon: MessageSquare, page: 'reports' },
];

/** KPI row in the admin metric-card style. Metrics without a data source (or profit without synced cost) are hidden, never shown as 0. */
export function AgentMetricCards({ tier, data, loading = false }: { tier: AgentTier; data?: AgentDashboardData; loading?: boolean }) {
  const p = useDisplayPreferences();
  const all = tier === 'PARTNER' ? partnerMetrics : subagentMetrics;
  const metrics = data ? all.filter(metric => data.kpis[metric.key] != null && (metric.kind !== 'profit' || data.costStatus === 'SYNCED')) : all;
  if (loading && !data) return <div className="lp-agent-metrics" aria-hidden="true">{metrics.map(m => <Card className="lp-admin-metric-skeleton" key={m.key}><Skeleton /><Skeleton /></Card>)}</div>;
  const format = (metric: MetricDefinition) => {
    const value = data?.kpis[metric.key];
    if (value == null) return { text: '待接入', note: '数据源尚未接入' };
    if (metric.kind === 'count') return { text: p.n(value), note: '' };
    if (metric.kind === 'profit' && data!.costStatus !== 'SYNCED') return { text: '—', note: data!.costStatus === 'LOCAL_SIMULATED' ? '本地模拟成本' : '成本待同步' };
    return { text: `${(value / 100).toFixed(2)} ${data!.currency}`, note: '' };
  };
  return <div className="lp-agent-metrics">{metrics.map(metric => {
    const Icon = metric.icon;
    const { text, note } = format(metric);
    const body = <><span>{metric.label}</span><Icon size={18} className="lp-admin-metric-icon" aria-hidden="true" /><strong data-pending={text === '待接入' || undefined}>{text}</strong>{note && <small>{note}</small>}</>;
    return <Card className="lp-admin-metric" key={metric.key}>{metric.page ? <a href={agentHref(metric.page)}>{body}</a> : <div className="lp-agent-metric-body">{body}</div>}</Card>;
  })}</div>;
}
