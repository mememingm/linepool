import type { ComponentProps, ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { useReducedMotion } from 'motion/react';
import { Button } from '../vendor/beautiful/src/components/atoms/Button';
import { StatusPill } from '../vendor/beautiful/src/components/atoms/StatusPill';
import TaskRows, { type TaskRow } from '../vendor/beautiful/src/components/primitives/TaskRows';
import { MagicCard } from '../vendor/magic/src/components/ui/magic-card';
import { NumberTicker } from '../vendor/magic/src/components/ui/number-ticker';

export function LinePoolUIProvider({ children, ...props }: ComponentProps<typeof ThemeProvider>) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem {...props}>{children}</ThemeProvider>;
}

export type ActionButtonProps = ComponentProps<typeof Button> & { busy?: boolean; busyLabel?: string };
/** Only adds business state; all visual styling remains upstream. */
export function ActionButton({ busy = false, busyLabel = '处理中…', disabled, children, type = 'button', ...props }: ActionButtonProps) {
  return <Button {...props} type={type} disabled={disabled || busy} aria-busy={busy}>{busy ? busyLabel : children}</Button>;
}

export const fulfillmentDisplay = {
  PROCESSING: { status: 'pending', label: '处理中' },
  COMPLETED: { status: 'completed', label: '已完成' },
  FAILED: { status: 'failed', label: '失败' },
  CANCELLED: { status: 'cancelled', label: '已取消' },
} as const;

export type OrderStatus = 'pending' | 'active' | 'completed' | 'cancelled' | 'failed';
const statuses = {
  pending: { label: '待处理', tone: 'orange' },
  active: { label: '进行中', tone: 'accent' },
  completed: { label: '已完成', tone: 'green' },
  cancelled: { label: '已取消', tone: 'neutral' },
  failed: { label: '失败', tone: 'red' },
} as const;
export function OrderStatusPill({ status, label }: { status: OrderStatus; label?: string }) {
  const item = statuses[status];
  return <StatusPill tone={item.tone}>{label ?? item.label}</StatusPill>;
}

export type MetricCardProps = { label: string; value: number; decimalPlaces?: number; unit?: string; description?: ReactNode; animated?: boolean };
/** Content composition around untouched MagicCard / NumberTicker. */
export function MetricCard({ label, value, decimalPlaces = 0, unit, description, animated = true }: MetricCardProps) {
  const reducedMotion = useReducedMotion();
  return <MagicCard className="rounded-xl"><div className="lp-metric"><h3>{label}</h3><div className="lp-metric-value">{animated && !reducedMotion ? <NumberTicker value={value} decimalPlaces={decimalPlaces} /> : <span>{value.toFixed(decimalPlaces)}</span>}{unit && <small>{unit}</small>}</div>{description && <p>{description}</p>}</div></MagicCard>;
}

export type ServiceTask = { id: string; title: string; amount: string; status: 'done' | 'running'; step?: number; details?: { label: string; meta: string }[] };
/** No fabricated progress: never uses upstream's animated demo "sequence" mode. */
export function ServiceTasks({ tasks }: { tasks: ServiceTask[] }) {
  const rows: TaskRow[] = tasks.map(task => ({ key: task.id, label: task.title, amount: task.amount, status: task.status, step: task.step, details: task.details ?? [] }));
  return <TaskRows rows={rows} labels={{ completed: '已完成', failed: '失败' }} />;
}
