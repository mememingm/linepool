import type { Locale } from '../preferences/store';
import { dateLabel } from '../i18n/format';
import type { WorkspaceData } from './workspace-data';

export type ReferenceMessage = { id: string; numberId: string; sender: string; code: string; body: string; date: string; time: string; unread: boolean };
export type ReferenceNumber = { id: string; phone: string; phoneLabel: string; country: string; service: string; remaining: number; status: string };
export type ReferencePeriod = { label: string; messages: number; numbers: number };
export type ReferenceData = {
  userName: string; isDemo: boolean; balance: number; orderCount: number;
  numbers: ReferenceNumber[]; messages: ReferenceMessage[]; services: string[];
  currentMonth: string; months: string[];
  trends: Record<string, { endDate: string; monthMessages: number; weeks: ReferencePeriod[]; days: ReferencePeriod[] }>;
};
export function referenceData(data: WorkspaceData, locale: Locale = 'zh-CN'): ReferenceData {
  const now = new Date();
  const monthId = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  const dayLabel = (value: Date) => dateLabel(value, locale, { month: '2-digit', day: '2-digit' });
  const months = Array.from({ length: 4 }, (_, index) => monthId(new Date(now.getFullYear(), now.getMonth() - 3 + index, 1)));
  const messageTimes = data.messages.map(message => new Date(message.receivedAt).getTime());
  const numberTimes = data.numbers.map(number => ({ start: new Date(number.assignedAt).getTime(), end: new Date(number.expiresAt).getTime() }));
  const trends: ReferenceData['trends'] = {};
  for (const id of months) {
    const [year, month] = id.split('-').map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    const end = id === monthId(now) ? now : new Date(monthEnd.getTime() - 1);
    function period(first: Date, last: Date): ReferencePeriod {
      const start = new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime();
      const stop = Math.min(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime(), end.getTime() + 1);
      return {
        label: first.getTime() === last.getTime() ? dayLabel(first) : `${dayLabel(first)} ~ ${dayLabel(last)}`,
        messages: messageTimes.filter(time => time >= start && time < stop).length,
        numbers: numberTimes.filter(number => number.start < stop && number.end >= stop).length,
      };
    }
    const beforeEnd = (days: number) => new Date(end.getFullYear(), end.getMonth(), end.getDate() - days);
    trends[id] = {
      endDate: dateLabel(end, locale, { year: 'numeric', month: '2-digit', day: '2-digit' }),
      monthMessages: messageTimes.filter(time => time >= monthStart.getTime() && time < monthEnd.getTime() && time <= now.getTime()).length,
      days: Array.from({ length: 7 }, (_, index) => { const day = beforeEnd(6 - index); return period(day, day); }),
      weeks: [0, 7, 14, 21].map((offset, index) => period(beforeEnd(29 - offset), beforeEnd(index === 3 ? 0 : 23 - offset))),
    };
  }
  return {
    userName: data.account.displayName, isDemo: data.account.isDemo, balance: data.account.pointsBalance,
    orderCount: data.orders.length, services: [...new Set(data.numbers.map(number => number.service))],
    numbers: data.numbers.map(number => ({
      id: number.id, phone: number.phoneNumber,
      phoneLabel: number.phoneNumber,
      country: number.country, service: number.service, remaining: number.remainingDays, status: number.status,
    })),
    messages: data.messages.map(message => ({
      id: message.id, numberId: message.numberId, sender: message.sender, code: message.verificationCode ?? '', body: message.body,
      date: dayLabel(new Date(message.receivedAt)), time: dateLabel(message.receivedAt, locale, { hour: '2-digit', minute: '2-digit', hour12: false }), unread: !message.isRead,
    })),
    currentMonth: monthId(now), months, trends,
  };
}
