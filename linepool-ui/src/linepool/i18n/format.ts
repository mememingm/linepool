import type { Locale } from '../preferences/store';
import { englishMessages } from '../welcome/reference/messages';
import { workspaceMessages } from './messages';
import { translateAdminText } from './admin-messages';
export type Values = Record<string, string | number>;
export function translate(source: string, locale: Locale, values: Values = {}): string {
  const trimmed = source.trim();
  const translated = locale === 'en-US'
    ? Object.hasOwn(workspaceMessages, trimmed) ? workspaceMessages[trimmed] : Object.hasOwn(englishMessages, trimmed) ? englishMessages[trimmed] : translateAdminText(trimmed)
    : undefined;
  const template = translated ? source.replace(trimmed, translated) : source;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
export function numberLabel(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(locale, options).format(value) : '--';
}
export function dateLabel(value: string | number | Date, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? translate('时间未知', locale) : new Intl.DateTimeFormat(locale, options ?? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}
export function monthLabel(value: string, locale: Locale, year = true): string {
  const match = /^(?:(\d{4})-)?(\d{2})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return '--';
  return dateLabel(new Date(Number(match[1] ?? 2026), Number(match[2]) - 1, 1), locale, { ...(year && match[1] ? { year: 'numeric' as const } : {}), month: 'short' });
}
export function translateCopy<T>(copy: T, locale: Locale): T {
  if (typeof copy === 'string') return translate(copy, locale) as T;
  if (copy !== null && typeof copy === 'object') return Object.fromEntries(Object.entries(copy).map(([key, value]) => [key, translateCopy(value, locale)])) as T;
  return copy;
}
