import { useEffect, useState } from 'react';
import type { AssignedNumber, Catalog, Order } from '../api/contracts';
import { useDisplayPreferences, type DisplayPreferences } from '../preferences/useDisplayPreferences';
import { StatusPill } from '../../vendor/beautiful/src/components/atoms/StatusPill';

type ReceivingTermData = Pick<Catalog['offers'][number] | Order, 'receivingMode' | 'durationDays'>;
type Display = Pick<DisplayPreferences, 't' | 'n'>;

export function receivingModeLabel(service: Pick<AssignedNumber, 'receivingMode'>) {
  return service.receivingMode === 'ONE_TIME' ? '一次性接码' : '托管接码';
}

export function receivingTerm(service: ReceivingTermData, display: Display) {
  return service.receivingMode === 'ONE_TIME' ? display.t('一次性 · 15 分钟')
    : service.durationDays === null ? display.t('服务期限待确认')
    : display.t('{days} 天托管', { days: display.n(service.durationDays) });
}

export function receivingWindow(number: AssignedNumber) {
  return { start: number.receivingStartedAt ?? number.assignedAt, end: number.receivingEndsAt ?? number.expiresAt };
}

export function ReceivingWindow({ number }: { number: AssignedNumber }) {
  const p = useDisplayPreferences();
  const window = receivingWindow(number);
  const format: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  return <span><time dateTime={window.start}>{p.date(window.start, format)}</time>{' – '}<time dateTime={window.end}>{p.date(window.end, format)}</time></span>;
}

export function ReceivingStatus({ number }: { number: AssignedNumber }) {
  const p = useDisplayPreferences();
  const [now, setNow] = useState(Date.now);
  const end = Date.parse(receivingWindow(number).end);
  useEffect(() => {
    setNow(Date.now());
    if (number.receivingMode !== 'ONE_TIME' || number.receivingStatus !== 'WAITING' || end <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), end - Date.now());
    return () => window.clearTimeout(timer);
  }, [number.receivingMode, number.receivingStatus, end]);
  if (number.receivingMode !== 'ONE_TIME') return <StatusPill tone={number.status === 'EXPIRED' ? 'neutral' : number.remainingDays <= 3 ? 'orange' : 'green'}>{p.t(number.status === 'EXPIRED' ? '已过期' : number.remainingDays <= 3 ? '即将到期' : '使用中')}</StatusPill>;
  const label = number.receivingStatus === 'SUCCESS' ? '接码成功'
    : number.receivingStatus === 'FAILED' ? '确认失败，积分已全退'
    : number.receivingStatus === 'WAITING' ? end <= now ? '窗口已结束，结果核对中' : '等待接码' : '接码结果待确认';
  return <StatusPill tone={number.receivingStatus === 'SUCCESS' ? 'green' : number.receivingStatus === 'FAILED' ? 'red' : 'orange'}>{p.t(label)}</StatusPill>;
}
