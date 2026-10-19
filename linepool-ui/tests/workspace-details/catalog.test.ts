import { describe, expect, it } from 'vitest';
import { catalogDetailTitle, purchaseSelection, resolveCatalogDetail } from '../../src/linepool/workspace-reference/detail-data';
import { detailHref, parseShellRoute, SHELL_PATH, shellHref } from '../../src/linepool/workspace-reference/navigation';
import type { Catalog, CreateOrderInput } from '../../src/linepool/api/contracts';
import { catalog, ORDER_ID } from './fixtures';

describe('catalog identity and absence', () => {
  it('resolves region and service relationships from the same loaded catalog', () => {
    expect(resolveCatalogDetail(catalog, parseShellRoute(`${SHELL_PATH}/regions/us`)))
      .toMatchObject({ kind: 'region', region: { id: 'us' }, offers: catalog.offers.slice(0, 2) });
    expect(resolveCatalogDetail(catalog, parseShellRoute(`${SHELL_PATH}/services/WhatsApp`)))
      .toMatchObject({ kind: 'service', service: 'WhatsApp', offers: [catalog.offers[2]] });
  });
  it('finds exact offer tuples, not translated labels or partial matches', () => {
    const route = parseShellRoute(detailHref({ page: 'offer-detail', region: 'gb', service: 'WhatsApp', plan: 'week' }));
    expect(resolveCatalogDetail(catalog, route)).toMatchObject({ kind: 'offer', offer: catalog.offers[2] });
    expect(catalogDetailTitle(catalog, route)).toBe('英国 · WhatsApp · 7 天轻量套餐');
    const renamed: Catalog = { ...catalog, offers: catalog.offers.map(offer => ({ ...offer, name: 'Renamed offer' })) };
    expect(resolveCatalogDetail(renamed, route)).toMatchObject({ kind: 'offer', offer: { name: 'Renamed offer' } });
  });
  it('keeps sold-out offers and known empty services distinct from a 404', () => {
    expect(resolveCatalogDetail(catalog, parseShellRoute(`${SHELL_PATH}/offers/gb/WhatsApp/week`)))
      .toMatchObject({ kind: 'offer', offer: { availableCount: 0 } });
    expect(resolveCatalogDetail(catalog, parseShellRoute(`${SHELL_PATH}/services/Google`)))
      .toEqual({ kind: 'service', service: 'Google', offers: [] });
    const withoutOffers = { ...catalog, offers: [] };
    expect(resolveCatalogDetail(withoutOffers, parseShellRoute(`${SHELL_PATH}/regions/us`)))
      .toMatchObject({ kind: 'region', offers: [] });
  });
  it.each(['regions/ca', 'regions/US', 'services/telegram', 'services/Signal', 'offers/us/Google/week', 'offers/us/Telegram/year', 'offers/gb/Telegram/month'])
  ('marks catalog absence as 404: %s', path => {
    const route = parseShellRoute(`${SHELL_PATH}/${path}`);
    expect(resolveCatalogDetail(catalog, route)).toBeNull();
    expect(catalogDetailTitle(catalog, route)).toBe('页面不存在');
  });
  it('does not show offers pointing to missing catalog parents', () => {
    const incomplete = { ...catalog, regions: [] };
    expect(resolveCatalogDetail(incomplete, parseShellRoute(`${SHELL_PATH}/services/Telegram`)))
      .toEqual({ kind: 'service', service: 'Telegram', offers: [] });
  });
});

describe('purchase preselection without intent replacement', () => {
  it('preselects a valid tuple from an offer link', () => {
    const route = parseShellRoute(shellHref('purchase', { region: 'gb', service: 'WhatsApp', plan: 'week' }));
    expect(purchaseSelection(catalog, route, null)).toEqual({ region: 'gb', service: 'WhatsApp', plan: 'week', quantity: 1 });
  });
  it('keeps old region links and falls back to a valid month offer', () => {
    expect(purchaseSelection(catalog, parseShellRoute(shellHref('purchase', { region: 'us' })), null))
      .toEqual({ region: 'us', service: 'Telegram', plan: 'month', quantity: 1 });
    expect(purchaseSelection(catalog, { region: 'bad', service: 'bad', plan: 'bad' }, null))
      .toEqual({ region: 'us', service: 'Telegram', plan: 'month', quantity: 1 });
    expect(purchaseSelection(catalog, { region: 'gb', service: 'WhatsApp', plan: 'bad' }, null).plan).toBe('week');
  });
  it('retains pending selection and original idempotency key over a competing URL', () => {
    const pending: CreateOrderInput = Object.freeze({ region: 'us', service: 'Telegram', plan: 'month', quantity: 3, idempotencyKey: ORDER_ID });
    const route = parseShellRoute(shellHref('purchase', { region: 'gb', service: 'WhatsApp', plan: 'week' }));
    expect(purchaseSelection(catalog, route, pending)).toEqual({ region: 'us', service: 'Telegram', plan: 'month', quantity: 3 });
    expect(pending).toEqual({ region: 'us', service: 'Telegram', plan: 'month', quantity: 3, idempotencyKey: ORDER_ID });
  });
  it('does not reinterpret frozen intent after inventory and catalog changes', () => {
    const pending: CreateOrderInput = { region: 'us', service: 'Telegram', plan: 'week', quantity: 2, idempotencyKey: ORDER_ID };
    const empty: Catalog = { isDemo: true, regions: [], services: [], offers: [] };
    expect(purchaseSelection(empty, { region: 'gb', service: 'Google', plan: 'month' }, pending))
      .toEqual({ region: 'us', service: 'Telegram', plan: 'week', quantity: 2 });
    expect(pending.idempotencyKey).toBe(ORDER_ID);
  });
});
