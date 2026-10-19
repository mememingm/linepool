import './shared.css';

export const balance = 1280;
export const regions = [
  { id: 'us', name: '美国', english: 'United States', prefix: '+1', stock: 1248, price: 15, area: '北美', tag: '热门' },
  { id: 'gb', name: '英国', english: 'United Kingdom', prefix: '+44', stock: 826, price: 18, area: '欧洲', tag: '' },
  { id: 'ca', name: '加拿大', english: 'Canada', prefix: '+1', stock: 562, price: 15, area: '北美', tag: '' },
  { id: 'sg', name: '新加坡', english: 'Singapore', prefix: '+65', stock: 318, price: 22, area: '亚洲', tag: '新上架' },
  { id: 'de', name: '德国', english: 'Germany', prefix: '+49', stock: 684, price: 20, area: '欧洲', tag: '' },
  { id: 'nl', name: '荷兰', english: 'Netherlands', prefix: '+31', stock: 215, price: 18, area: '欧洲', tag: '' },
] as const;
export const numbers = [
  { id: 'n1', phone: '+1 202 555 0138', country: '美国', region: 'us', service: 'Telegram', remaining: 23, expires: '2026-11-01', unread: 2, messages: 8, status: 'ACTIVE' },
  { id: 'n2', phone: '+44 7700 900124', country: '英国', region: 'gb', service: 'WhatsApp', remaining: 3, expires: '2026-10-12', unread: 1, messages: 5, status: 'ACTIVE' },
  { id: 'n3', phone: '+1 613 555 0146', country: '加拿大', region: 'ca', service: 'Google', remaining: 18, expires: '2026-10-27', unread: 0, messages: 3, status: 'ACTIVE' },
  { id: 'n4', phone: '+65 8123 4567', country: '新加坡', region: 'sg', service: 'Telegram', remaining: 2, expires: '2026-10-11', unread: 1, messages: 4, status: 'ACTIVE' },
  { id: 'n5', phone: '+49 151 2345 6789', country: '德国', region: 'de', service: 'WhatsApp', remaining: 26, expires: '2026-11-04', unread: 0, messages: 2, status: 'ACTIVE' },
  { id: 'n6', phone: '+31 6 1234 5678', country: '荷兰', region: 'nl', service: 'Google', remaining: 0, expires: '2026-10-08', unread: 0, messages: 2, status: 'EXPIRED' },
] as const;
export const messages = [
  { id: 's1', numberId: 'n1', sender: 'Telegram', code: '482 916', time: '14:32:08', date: '今天', body: 'Telegram code: 482916. You can use this code to log in to your Telegram account.', unread: true },
  { id: 's2', numberId: 'n1', sender: 'Telegram', code: '739 204', time: '14:26:41', date: '今天', body: 'Your Telegram login code is 739204. Do not share this code with anyone.', unread: true },
  { id: 's3', numberId: 'n1', sender: 'Google', code: 'G-158629', time: '13:58:12', date: '今天', body: 'G-158629 is your Google verification code.', unread: false },
  { id: 's4', numberId: 'n1', sender: 'WhatsApp', code: '625 381', time: '11:04:36', date: '今天', body: 'Your WhatsApp code: 625-381. Do not share this code with anyone.', unread: false },
  { id: 's5', numberId: 'n2', sender: 'WhatsApp', code: '816 402', time: '14:28:16', date: '今天', body: 'Your WhatsApp code: 816-402. Do not share this code with anyone.', unread: true },
  { id: 's6', numberId: 'n3', sender: 'Google', code: 'G-904218', time: '12:42:09', date: '今天', body: 'G-904218 is your Google verification code.', unread: false },
  { id: 's7', numberId: 'n4', sender: 'Telegram', code: '357 862', time: '14:15:32', date: '今天', body: 'Telegram code: 357862. You can use this code to log in to your Telegram account.', unread: true },
  { id: 's8', numberId: 'n5', sender: 'WhatsApp', code: '194 703', time: '10:12:47', date: '今天', body: 'Your WhatsApp code: 194-703.', unread: false },
  { id: 's9', numberId: 'n6', sender: 'Google', code: 'G-462801', time: '09:31:05', date: '昨天', body: 'G-462801 is your Google verification code.', unread: false },
] as const;
export const orders = [
  { id: 'LP202610090018', region: 'us', country: '美国', plan: '30 天标准套餐', quantity: 2, points: 30, time: '今天 14:20', status: 'completed' },
  { id: 'LP202610080026', region: 'gb', country: '英国', plan: '7 天轻量套餐', quantity: 1, points: 8, time: '昨天 18:42', status: 'completed' },
  { id: 'LP202610080012', region: 'sg', country: '新加坡', plan: '30 天标准套餐', quantity: 1, points: 22, time: '昨天 10:16', status: 'completed' },
] as const;
export const ledger = [
  { id: 'l1', title: '购买美国号码', time: '10 月 09 日 · 14:20', delta: -30, balance: 1280 },
  { id: 'l2', title: '积分入账', time: '10 月 09 日 · 09:00', delta: 500, balance: 1310 },
  { id: 'l3', title: '购买英国号码', time: '10 月 08 日 · 18:42', delta: -8, balance: 810 },
  { id: 'l4', title: '购买新加坡号码', time: '10 月 08 日 · 10:16', delta: -22, balance: 818 },
] as const;
export function Flag({ code, className = '' }: { code: string; className?: string }) {
  return <img className={`ws-flag ${className}`} src={new URL(`./assets/${code}.png`, import.meta.url).href} alt="" width="40" height="28" />;
}
