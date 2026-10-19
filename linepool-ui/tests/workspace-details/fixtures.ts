import type { Catalog, OrderDetail } from '../../src/linepool/api/contracts';

export const ORDER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORDER_ID = '22222222-2222-4222-8222-222222222222';
export const catalog: Catalog = {
  isDemo: true,
  regions: [
    { id: 'us', name: '美国', english: 'United States', prefix: '+1', area: '北美', availableCount: 8 },
    { id: 'gb', name: '英国', english: 'United Kingdom', prefix: '+44', area: '欧洲', availableCount: 0 },
  ],
  services: ['Telegram', 'WhatsApp', 'Google'],
  offers: [
    { region: 'us', service: 'Telegram', plan: 'month', name: '30 天标准套餐', durationDays: 30, unitPoints: 15, availableCount: 8 },
    { region: 'us', service: 'Telegram', plan: 'week', name: '7 天轻量套餐', durationDays: 7, unitPoints: 5, availableCount: 8 },
    { region: 'gb', service: 'WhatsApp', plan: 'week', name: '7 天轻量套餐', durationDays: 7, unitPoints: 8, availableCount: 0 },
  ],
};
export const order: OrderDetail = {
  id: ORDER_ID, orderNumber: 'LP202610100001', region: 'us', country: '美国', service: 'Telegram',
  plan: 'month', planName: '30 天标准套餐', quantity: 1, unitPoints: 15, totalPoints: 15,
  durationDays: 30, status: 'COMPLETED', createdAt: '2026-10-10T00:00:00.000Z', isDemo: true, numbers: [],
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
