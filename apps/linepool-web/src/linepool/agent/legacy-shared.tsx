import type { ReactNode } from 'react';
import type { AgentMetricPeriod } from '../api/contracts';
import { Card } from '../ui/card';
import { ActionButton } from '../admin/primitives';

export function Filter({ title, children }: { title: string; children: ReactNode }) { return <label className="lp-agent-inventory-filter">{title}{children}</label>; }
export function money(value: number | null | undefined, currency = 'USD') { return value == null ? '待核算' : `${currency} ${(value / 100).toFixed(2)}`; }
export function exportCsv(name: string, rows: Array<Array<string | number>>) {
  const csv = rows.map(row => row.map(value => {
    // Prevent formula execution when downloaded business data is opened in a spreadsheet.
    const text = String(value); const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type MetricPeriod = AgentMetricPeriod;
export const metricPeriodLabels: Record<MetricPeriod, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' };

export function AgentChartPanel({ title, description, period, onPeriodChange, children }: {
  title: string; description?: string; period?: MetricPeriod; onPeriodChange?: (period: MetricPeriod) => void;
  children?: ReactNode;
}) {
  return <Card className="lp-admin-section lp-agent-chart">
    <div className="lp-admin-section-heading"><div><h2>{title}</h2>{description && <p className="lp-admin-context">{description}</p>}</div>
      <div className="lp-admin-actions">
        {period && onPeriodChange && <div className="lp-agent-period" role="group" aria-label={`${title}时间范围`}>{(Object.keys(metricPeriodLabels) as MetricPeriod[]).map(key =>
          <ActionButton key={key} size="sm" variant={period === key ? 'accent' : 'outline'} aria-pressed={period === key} onClick={() => onPeriodChange(key)}>{metricPeriodLabels[key]}</ActionButton>)}</div>}
      </div></div>
    {children}
  </Card>;
}
