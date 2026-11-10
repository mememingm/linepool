import { BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '../../ui/card';
import { ActionButton, Badge, Table } from '../../admin/primitives';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { costStatusLabels, inventoryBucketLabels, metricPeriodLabels, type AgentDashboardData, type CostStatus, type InventoryBucket, type MetricPeriod } from './types';

/**
 * Chart slots for the overview. Visualisation is intentionally not chosen yet: with data the
 * panels fall back to an accessible table, without data they show a pending state. Swap the
 * body for a real chart once the metrics endpoint exists; keep the panel chrome.
 */
export function AgentChartPanel({ title, description, period, onPeriodChange, costStatus, wide = false, children }: {
  title: string; description?: string; period?: MetricPeriod; onPeriodChange?: (period: MetricPeriod) => void;
  costStatus?: CostStatus; wide?: boolean; children?: ReactNode;
}) {
  return <Card className={`lp-admin-section lp-agent-chart${wide ? ' is-wide' : ''}`}>
    <div className="lp-admin-section-heading"><div><h2>{title}</h2>{description && <p className="lp-admin-context">{description}</p>}</div>
      <div className="lp-admin-actions">{costStatus && costStatus !== 'SYNCED' && <Badge value={costStatusLabels[costStatus]} />}
        {period && onPeriodChange && <div className="lp-agent-period" role="group" aria-label={`${title}时间范围`}>{(Object.keys(metricPeriodLabels) as MetricPeriod[]).map(key =>
          <ActionButton key={key} size="sm" variant={period === key ? 'accent' : 'outline'} aria-pressed={period === key} onClick={() => onPeriodChange(key)}>{metricPeriodLabels[key]}</ActionButton>)}</div>}
      </div></div>
    {children ?? <ChartPending />}
  </Card>;
}
function ChartPending() {
  return <div className="lp-admin-state lp-agent-chart-pending"><BarChart3 size={24} /><p>统计数据待接入</p></div>;
}
const amount = (minor: number | null, currency: string) => minor == null ? '—' : `${(minor / 100).toFixed(2)} ${currency}`;
const costAmount = (minor: number | null, currency: string, costStatus?: CostStatus) => costStatus === 'SYNCED' && minor != null ? amount(minor, currency) : '成本待同步';

type ChartProps = { data?: AgentDashboardData; period: MetricPeriod; onPeriodChange: (period: MetricPeriod) => void };

/** §5.1-1 销售额 = 实付；成本 = 上级结算价或平台成本；利润 = 销售额 - 成本. */
export function AgentRevenueChart({ data, period, onPeriodChange }: ChartProps) {
  return <AgentChartPanel wide title="销售额、成本、利润趋势" description="销售额为客户实际支付金额，成本为上级结算价或平台成本。" period={period} onPeriodChange={onPeriodChange} costStatus={data?.costStatus}>
    {data?.trend.length ? <Table columns={['日期', '销售额', '成本', '利润']} label="销售趋势">{data.trend.map(row => <tr key={row.date}><td>{row.date}</td><td className="lp-admin-numeric">{amount(row.salesMinor, data.currency)}</td><td className="lp-admin-numeric">{costAmount(row.costMinor, data.currency, data.costStatus)}</td><td className="lp-admin-numeric">{data.costStatus === 'SYNCED' ? amount(row.profitMinor, data.currency) : '—'}</td></tr>)}</Table> : undefined}
  </AgentChartPanel>;
}

/** §5.1-4 平台/服务销售排行（含利润）. */
export function AgentProfitChart({ data, period, onPeriodChange }: ChartProps) {
  return <AgentChartPanel title="服务销售排行" period={period} onPeriodChange={onPeriodChange} costStatus={data?.costStatus}>
    {data?.serviceRanking.length ? <Table columns={['服务', '销售数量', '销售额', '利润']} label="服务销售排行">{data.serviceRanking.map(row => <tr key={row.service}><td>{row.service}</td><td className="lp-admin-numeric">{row.quantity}</td><td className="lp-admin-numeric">{amount(row.salesMinor, data.currency)}</td><td className="lp-admin-numeric">{data.costStatus === 'SYNCED' ? amount(row.profitMinor, data.currency) : '—'}</td></tr>)}</Table> : undefined}
  </AgentChartPanel>;
}

/** §5.1-2 近期接码数量，来源为有效号码对应的短信接收记录. */
export function AgentCodeVolumeChart({ data, period, onPeriodChange }: ChartProps) {
  const p = useDisplayPreferences();
  return <AgentChartPanel title="近期接码数量" description="按有效号码的短信接收记录统计。" period={period} onPeriodChange={onPeriodChange}>
    {data?.codeVolume.length ? <Table columns={['时间', '平台', '接码数量']} label="接码数量">{data.codeVolume.map(row => <tr key={`${row.bucket}/${row.platform ?? ''}`}><td>{row.bucket}</td><td>{row.platform ?? '全部平台'}</td><td className="lp-admin-numeric">{p.n(row.count)}</td></tr>)}</Table> : undefined}
  </AgentChartPanel>;
}

/** §5.1-3 库存状态分布. */
export function AgentInventoryChart({ data }: { data?: AgentDashboardData }) {
  const p = useDisplayPreferences();
  const rows = (Object.entries(data?.inventoryStatus ?? {}) as [InventoryBucket, number][]).filter(([, count]) => count > 0);
  return <AgentChartPanel title="库存状态分布">
    {rows.length ? <Table columns={['状态', '数量']} label="库存状态分布">{rows.map(([bucket, count]) => <tr key={bucket}><td>{inventoryBucketLabels[bucket]}</td><td className="lp-admin-numeric">{p.n(count)}</td></tr>)}</Table> : undefined}
  </AgentChartPanel>;
}
