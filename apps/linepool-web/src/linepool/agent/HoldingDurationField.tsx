import { useMemo, useState } from 'react';
import type { NumberHolding } from '@linepool/contracts';

type Duration = '7' | '30' | '90' | 'all' | 'custom';
type HoldingWindowSource = Pick<NumberHolding, 'id' | 'startsAt' | 'expiresAt'>;
export type HoldingWindow = { startsAt: string; expiresAt: string; valid: boolean };
const DAY = 86400000;
const presets = [7, 30, 90] as const;
const localDate = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function holdingWindow(holding: HoldingWindowSource | undefined, duration: Duration, customDate: string): HoldingWindow {
  const invalid = { startsAt: '', expiresAt: '', valid: false };
  if (!holding) return invalid;
  const start = Math.max(Date.now(), Date.parse(holding.startsAt));
  const limit = holding.expiresAt ? Date.parse(holding.expiresAt) : Infinity;
  if (!Number.isFinite(start) || Number.isNaN(limit)) return invalid;
  // On the holding's last day, respect its exact expiry rather than extending it to midnight.
  const customEnd = /^\d{4}-\d{2}-\d{2}$/.test(customDate) ? Date.parse(`${customDate}T23:59:00`) : NaN;
  const withinDateLimit = !Number.isFinite(limit) || customDate <= localDate(limit);
  const end = duration === 'all' ? limit
    : duration === 'custom' ? (withinDateLimit ? Math.min(customEnd, limit) : NaN)
    : start + Number(duration) * DAY;
  if (!Number.isFinite(end) || end <= start || end > limit) return invalid;
  return { startsAt: new Date(start).toISOString(), expiresAt: new Date(end).toISOString(), valid: true };
}

export function useHoldingDuration(holding: HoldingWindowSource | undefined) {
  const [choice, setChoice] = useState<{ holdingId: string; duration: Duration; customDate: string } | null>(null);
  const remaining = holding ? (holding.expiresAt ? Date.parse(holding.expiresAt) : Infinity) - Math.max(Date.now(), Date.parse(holding.startsAt)) : 0;
  const current = choice?.holdingId === holding?.id ? choice : null;
  const duration = current?.duration ?? (remaining >= 30 * DAY || !holding?.expiresAt ? '30' : 'all');
  const customDate = current?.customDate ?? '';
  function update(value: { duration?: Duration; customDate?: string }) {
    if (holding) setChoice({ holdingId: holding.id, duration, customDate, ...value });
  }
  const window = useMemo(() => holdingWindow(holding, duration, customDate), [holding?.id, holding?.startsAt, holding?.expiresAt, duration, customDate]);
  return {
    duration, customDate, remaining,
    setDuration: (value: Duration) => update({ duration: value }),
    setCustomDate: (value: string) => update({ customDate: value }),
    window,
    // Recompute at the confirmation click, then freeze this result for submission and retries.
    resolveWindow: () => holdingWindow(holding, duration, customDate),
  };
}

export function HoldingDurationField({ holding, state, hintClassName = 'lp-admin-context' }: {
  holding: HoldingWindowSource; state: ReturnType<typeof useHoldingDuration>; hintClassName?: string;
}) {
  const expiry = holding.expiresAt ? Date.parse(holding.expiresAt) : null;
  const futureStart = Date.parse(holding.startsAt) > Date.now();
  return <>
    <label>使用时长<select value={state.duration} onChange={event => state.setDuration(event.target.value as Duration)}>
      {presets.map(days => <option key={days} value={String(days)} disabled={days * DAY > state.remaining}>{days} 天{days * DAY > state.remaining ? '（号码剩余不足）' : ''}</option>)}
      {expiry !== null && <option value="all">用到号码到期（{new Date(expiry).toLocaleDateString('zh-CN')}）</option>}
      <option value="custom">自定义到期日</option>
    </select></label>
    {state.duration === 'custom' && <label>到期日<input type="date" required value={state.customDate} min={localDate(Math.max(Date.now(), Date.parse(holding.startsAt)))} max={expiry !== null ? localDate(expiry) : undefined} onChange={event => state.setCustomDate(event.target.value)} /></label>}
    <p className={hintClassName}>{futureStart ? `从原号码开始时间 ${new Date(holding.startsAt).toLocaleString('zh-CN', { hour12: false })} 生效` : '确认后立即生效'}{state.window.valid ? `，到 ${new Date(state.window.expiresAt).toLocaleString('zh-CN', { hour12: false })} 结束` : ''}。{expiry !== null ? `号码本身有效至 ${new Date(expiry).toLocaleString('zh-CN', { hour12: false })}，时长不能超过它。` : ''}</p>
    {state.duration === 'custom' && state.customDate && !state.window.valid && <p className={hintClassName} role="alert">请选择号码有效期内、尚未过去的到期日。</p>}
  </>;
}
