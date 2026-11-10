import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { PcConnection, PcNumber, PcSession, User } from '../../api/contracts';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { Card } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';

export type PcPageProps = { user: User; session: PcSession; connection: PcConnection; numberId: string };

export const pcSessionKey = (userId: string) => ['pc-session', userId] as const;
export function usePcSession(userId: string) {
  return useQuery({ queryKey: pcSessionKey(userId), queryFn: async ({ signal }) => (await api.pcSession({ signal })).data, staleTime: 0, refetchInterval: 15_000 }, queryClient);
}
/** Messages for one page of the list, or the newest 100 for overview statistics. */
export function usePcMessages(userId: string, connectionId: string, input: { numberId?: string; page: number; pageSize: number }, refetchInterval = 15_000) {
  return useQuery({
    queryKey: ['pc-messages', userId, connectionId, input.numberId ?? '', input.page, input.pageSize],
    queryFn: ({ signal }) => api.pcMessages({ numberId: input.numberId || undefined, page: input.page, pageSize: input.pageSize }, { signal }),
    staleTime: 0, refetchInterval,
  }, queryClient);
}

/** Display state derived only from fields the PC session returns; no upstream status is inferred. */
export type NumberState = 'AVAILABLE' | 'TERM_PENDING' | 'EXPIRED' | 'SOURCE_MISSING' | 'UNSUPPORTED';
export const numberStateLabels: Record<NumberState, string> = {
  AVAILABLE: '可取码', TERM_PENDING: '期限待确认', EXPIRED: '资源已到期', SOURCE_MISSING: '上游已缺失', UNSUPPORTED: '本站不可用',
};
const numberStateTones: Record<NumberState, 'success' | 'info' | 'warning'> = {
  AVAILABLE: 'success', TERM_PENDING: 'info', EXPIRED: 'warning', SOURCE_MISSING: 'warning', UNSUPPORTED: 'warning',
};
export const numberStates = Object.keys(numberStateLabels) as NumberState[];
export function numberState(number: PcNumber, now: number): NumberState {
  if (number.sourceMissing) return 'SOURCE_MISSING';
  if (!number.capabilities.includes('SMS_CODE')) return 'UNSUPPORTED';
  if (!number.resourceExpiresAt) return 'TERM_PENDING';
  return Date.parse(number.resourceExpiresAt) <= now ? 'EXPIRED' : 'AVAILABLE';
}
export function smsEnabled(connection: PcConnection) {
  return connection.status === 'ACTIVE' && connection.enabledCapabilities.includes('SMS_CODE');
}
/** Same rule the wait endpoint applies: a usable SMS number on an active, SMS-enabled connection. */
export function canReceive(number: PcNumber, connection: PcConnection, now: number) {
  const state = numberState(number, now);
  return smsEnabled(connection) && (state === 'AVAILABLE' || state === 'TERM_PENDING');
}
export function NumberStateBadge({ state }: { state: NumberState }) {
  const p = useDisplayPreferences();
  return <span className="lp-admin-status lp-pc-status" data-tone={numberStateTones[state]}>{p.t(numberStateLabels[state])}</span>;
}

export type Metric = { label: string; value: number | undefined; href: string; icon: LucideIcon; note?: string };
/** KPI row in the original agent metric-card style. */
export function PcMetricCards({ metrics, loading }: { metrics: Metric[]; loading?: boolean }) {
  const p = useDisplayPreferences();
  if (loading) return <div className="lp-agent-metrics" aria-hidden="true">{metrics.map(metric => <Card className="lp-admin-metric-skeleton" key={metric.label}><Skeleton /><Skeleton /></Card>)}</div>;
  return <div className="lp-agent-metrics">{metrics.map(metric => <Card className="lp-admin-metric" key={metric.label}><a href={metric.href}>
    <span>{p.t(metric.label)}</span><metric.icon size={18} className="lp-admin-metric-icon" aria-hidden="true" />
    <strong data-pending={metric.value === undefined || undefined}>{metric.value === undefined ? '—' : p.n(metric.value)}</strong>
    <small>{metric.note ? p.t(metric.note) : <>{p.t('查看详情')} <ArrowRight size={13} aria-hidden="true" /></>}</small>
  </a></Card>)}</div>;
}

/** Horizontal bars with the numbers in text, so the chart reads without colour or hover. */
export function PcBars({ rows, label, empty }: { rows: { key: string; label: string; value: number; tone?: string }[]; label: string; empty: string }) {
  const p = useDisplayPreferences();
  const max = Math.max(0, ...rows.map(row => row.value));
  if (!max) return <div className="lp-admin-state lp-agent-chart-pending"><p>{p.t(empty)}</p></div>;
  return <ul className="lp-agent-bars" aria-label={p.t(label)}>{rows.map(row => <li key={row.key}>
    <span className="lp-agent-bars-label">{row.label}</span>
    <span className="lp-agent-bars-track" aria-hidden="true"><span data-tone={row.tone} style={{ width: `${row.value ? Math.max(2, (row.value / max) * 100) : 0}%` }} /></span>
    <strong>{p.n(row.value)}</strong>
  </li>)}</ul>;
}

export function PcEmpty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }) {
  const p = useDisplayPreferences();
  return <div className="lp-agent-empty"><Icon size={26} aria-hidden="true" /><h3>{p.t(title)}</h3><p>{children}</p>{action}</div>;
}
export function PcTextLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="lp-agent-text-link" href={href}>{children} <ArrowRight size={15} aria-hidden="true" /></a>;
}
export function PcFeedback({ error, notice }: { error: string; notice: string }) {
  return <>{error && <p className="lp-admin-error" role="alert">{error}</p>}{notice && <p className="lp-pc-notice" role="status">{notice}</p>}</>;
}
