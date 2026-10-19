import { describe, expect, it } from 'vitest';
import { detailHref, isDetailRoute, isShellPath, pageTitles, parseShellRoute, SHELL_PATH, shellHref, shellPageTitle, shellRouteKey, shellSidebarPage, type ShellPage } from '../../src/linepool/workspace-reference/navigation';
import { ORDER_ID } from './fixtures';

describe('clean workbench links', () => {
  it('keeps root, explicit dashboard and filtered lists', () => {
    expect(shellHref('dashboard')).toBe(SHELL_PATH);
    expect(parseShellRoute(SHELL_PATH).page).toBe('dashboard');
    expect(parseShellRoute(`${SHELL_PATH}/dashboard`).page).toBe('dashboard');
    for (const page of Object.keys(pageTitles) as ShellPage[]) {
      const href = shellHref(page, { region: 'us', number: ORDER_ID });
      expect(parseShellRoute(href)).toMatchObject({ page, region: 'us', number: ORDER_ID });
      expect(isDetailRoute(parseShellRoute(href))).toBe(false);
    }
    expect(shellHref('regions', { region: 'us' })).toBe(`${SHELL_PATH}/regions?region=us`);
    expect(shellHref('inbox', { number: ORDER_ID })).toBe(`${SHELL_PATH}/inbox?number=${ORDER_ID}`);
  });
  it('preserves query encoding and adds optional offer preselection', () => {
    expect(parseShellRoute(shellHref('purchase', { region: 'us', service: 'Telegram', plan: 'week' })))
      .toMatchObject({ page: 'purchase', region: 'us', service: 'Telegram', plan: 'week' });
    expect(parseShellRoute(shellHref('numbers', { region: 'a&b + c', number: 'x/y?z' })))
      .toMatchObject({ region: 'a&b + c', number: 'x/y?z' });
  });
  it('does not claim unrelated pages', () => {
    for (const hash of ['#welcome', '#workspace-reference', `${SHELL_PATH}-other`, '']) {
      expect(isShellPath(hash)).toBe(false);
      expect(parseShellRoute(hash).page).toBe('not-found');
    }
  });
});

describe('addressable detail routes', () => {
  it('round-trips all four identifiers without relying on browser state', () => {
    expect(parseShellRoute(detailHref({ page: 'region-detail', region: 'us' }))).toMatchObject({ page: 'region-detail', region: 'us' });
    expect(parseShellRoute(detailHref({ page: 'service-detail', service: 'Telegram' }))).toMatchObject({ page: 'service-detail', service: 'Telegram' });
    expect(parseShellRoute(detailHref({ page: 'offer-detail', region: 'us', service: 'Telegram', plan: 'month' }))).toMatchObject({ page: 'offer-detail', region: 'us', service: 'Telegram', plan: 'month' });
    expect(parseShellRoute(detailHref({ page: 'order-detail', orderId: ORDER_ID }))).toMatchObject({ page: 'order-detail', orderId: ORDER_ID });
  });
  it('encodes component boundaries and decodes only once', () => {
    const target = { page: 'offer-detail' as const, region: 'region/a?#', service: '服务 + !()*', plan: 'plan%2Fpart' };
    const href = detailHref(target);
    expect(href).toContain('region%2Fa%3F%23');
    expect(href).toContain('%21%28%29%2A');
    expect(href).toContain('plan%252Fpart');
    expect(parseShellRoute(href)).toMatchObject(target);
    expect(parseShellRoute(`${SHELL_PATH}/services/%252F`).service).toBe('%2F');
  });
  it.each([
    'regions/', 'regions/us/extra', 'services/', 'offers/us/Telegram', 'offers/us//month',
    'offers/us/Telegram/month/extra', 'regions/%E0%A4%A', 'services/%ZZ',
    'regions/..', 'regions/%2e%2e', 'services/%00', 'orders/LP202610100001',
    `orders/${ORDER_ID}/extra`, 'orders/11111111-1111-1111-1111-111111111111',
  ])('rejects malformed paths: %s', path => {
    expect(parseShellRoute(`${SHELL_PATH}/${path}`).page).toBe('not-found');
  });
  it('rejects bad link identifiers and normalizes valid UUID casing', () => {
    expect(() => detailHref({ page: 'region-detail', region: '' })).toThrow();
    expect(() => detailHref({ page: 'service-detail', service: '..' })).toThrow();
    expect(() => detailHref({ page: 'order-detail', orderId: 'not-a-uuid' })).toThrow();
    const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(detailHref({ page: 'order-detail', orderId: id.toUpperCase() })).toBe(`${SHELL_PATH}/orders/${id}`);
    expect(parseShellRoute(`${SHELL_PATH}/orders/${id.toUpperCase()}`).orderId).toBe(id);
  });
  it('path identifiers outrank query overrides', () => {
    expect(parseShellRoute(`${SHELL_PATH}/offers/us/Telegram/month?region=gb&service=Google&plan=week`))
      .toMatchObject({ page: 'offer-detail', region: 'us', service: 'Telegram', plan: 'month' });
  });
  it('maps detail navigation and creates unambiguous component identities', () => {
    const first = parseShellRoute(`${SHELL_PATH}/offers/us/Telegram/month`);
    const second = parseShellRoute(`${SHELL_PATH}/offers/us/Telegram/week`);
    expect(shellRouteKey(first)).not.toBe(shellRouteKey(second));
    expect(shellRouteKey(parseShellRoute(detailHref({ page: 'service-detail', service: 'a:b' }))))
      .not.toBe(shellRouteKey(parseShellRoute(detailHref({ page: 'service-detail', service: 'a' }))));
    expect(shellSidebarPage(first)).toBe('purchase');
    expect(shellSidebarPage(parseShellRoute(`${SHELL_PATH}/regions/us`))).toBe('regions');
    expect(shellSidebarPage(parseShellRoute(`${SHELL_PATH}/services/Telegram`))).toBe('regions');
    expect(shellSidebarPage(parseShellRoute(`${SHELL_PATH}/orders/${ORDER_ID}`))).toBe('orders');
    expect(isDetailRoute(first)).toBe(true);
    expect(shellPageTitle(first)).toBe('服务方案详情');
  });
});
