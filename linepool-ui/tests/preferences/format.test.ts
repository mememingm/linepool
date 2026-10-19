import { describe, expect, it } from 'vitest';
import { dateLabel, monthLabel, numberLabel, translate, translateCopy } from '../../src/linepool/i18n/format';
import { workspaceMessages } from '../../src/linepool/i18n/messages';
import { englishMessages } from '../../src/linepool/welcome/reference/messages';
import { apiMessage } from '../../src/linepool/workspace-reference/workspace-data';
import { LinepoolApiError } from '../../src/linepool/api/client';
import { detailCopy } from '../../src/linepool/workspace-reference/detail-data';

const flatten = (value: unknown): string[] => typeof value === 'string' ? [value] : value !== null && typeof value === 'object' ? Object.values(value).flatMap(flatten) : [];

describe('display copy and formatters', () => {
  it('translates shared welcome/workbench copy and interpolates literal values', () => {
    expect(translate('登录', 'en-US')).toBe('Sign in');
    expect(translate('欢迎回来，{name}', 'en-US', { name: '$& {count}' })).toBe('Welcome back, $& {count}');
    expect(translate('第 {step} 步，共 {total} 步', 'en-US', { step: 2, total: 4 })).toBe('Step 2 of 4');
    expect(translate(' 订单详情 ', 'en-US')).toBe(' Order details ');
    expect(translate('订单详情', 'zh-CN')).toBe('订单详情');
    expect(translate('unknown identifier', 'en-US')).toBe('unknown identifier');
    expect(translate('constructor', 'en-US')).toBe('constructor');
    expect(translate('__proto__', 'en-US')).toBe('__proto__');
    expect(translate('{missing}', 'en-US')).toBe('{missing}');
  });

  it('covers every detail-page label without changing stable keys', () => {
    const translated = translateCopy(detailCopy, 'en-US');
    expect(Object.keys(translated.titles)).toEqual(Object.keys(detailCopy.titles));
    expect(translated.titles['offer-detail']).toBe('Service offer details');
    for (const source of flatten(detailCopy)) expect(translate(source, 'en-US')).not.toMatch(/[\u3400-\u9fff]/u);
    expect(detailCopy.titles['offer-detail']).toBe('服务方案详情');
  });

  it('keeps interpolation names consistent across dictionaries', () => {
    const keys = (value: string) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
    for (const [source, translated] of Object.entries({ ...englishMessages, ...workspaceMessages })) expect(keys(translated)).toEqual(keys(source));
  });

  it('localizes known API errors without exposing their raw server messages', () => {
    const codes = ['INVALID_CREDENTIALS', 'EMAIL_EXISTS', 'UNAUTHENTICATED', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'INSUFFICIENT_POINTS', 'INSUFFICIENT_STOCK', 'IDEMPOTENCY_CONFLICT', 'INVALID_RESPONSE', 'ORIGIN_REJECTED', 'ORDER_NOT_FOUND', 'MESSAGE_NOT_FOUND', 'VALIDATION_ERROR'];
    for (const code of codes) {
      const label = apiMessage(new LinepoolApiError(400, code, 'raw-server-message'), 'en-US');
      expect(label).not.toMatch(/[\u3400-\u9fff]/u);
      expect(label).not.toBe('raw-server-message');
    }
    expect(apiMessage(new Error('internal'), 'en-US')).toBe('Operation failed. Please retry.');
    expect(apiMessage(new LinepoolApiError(401, 'UNAUTHENTICATED', 'raw'), 'en-US')).toContain('session has expired');
  });

  it('uses Intl for grouped/signed numbers and safe invalid-number fallbacks', () => {
    expect(numberLabel(12345.5, 'en-US')).toBe(new Intl.NumberFormat('en-US').format(12345.5));
    expect(numberLabel(-1500, 'zh-CN')).toBe(new Intl.NumberFormat('zh-CN').format(-1500));
    expect(numberLabel(0, 'en-US')).toBe('0');
    expect(numberLabel(Number.NaN, 'en-US')).toBe('--');
    expect(numberLabel(Infinity, 'zh-CN')).toBe('--');
  });

  it('uses an explicit timezone when supplied and handles invalid dates', () => {
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' };
    const value = '2026-10-10T01:30:00Z';
    expect(dateLabel(value, 'en-US', options)).toBe(new Intl.DateTimeFormat('en-US', options).format(new Date(value)));
    expect(dateLabel('not-a-date', 'en-US')).toBe('Unknown time');
    expect(dateLabel('not-a-date', 'zh-CN')).toBe('时间未知');
    expect(monthLabel('2026-10', 'en-US')).toContain('Oct');
    expect(monthLabel('10', 'en-US', false)).toBe('Oct');
    expect(monthLabel('2026-13', 'en-US')).toBe('--');
    expect(monthLabel('invalid', 'zh-CN')).toBe('--');
  });
});
