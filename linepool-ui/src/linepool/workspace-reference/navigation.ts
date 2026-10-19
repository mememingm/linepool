import { uuidSchema } from '../api/contracts';
import { detailCopy } from './detail-data';

export const SHELL_PATH = '/app';

export const pageTitles = {
  dashboard: '工作台',
  purchase: '购买服务',
  inbox: '短信中心',
  settings: '账户设置',
  numbers: '我的号码',
  orders: '我的订单',
  points: '积分明细',
  account: '我的账户',
  regions: '地区服务',
} as const;

export type ShellPage = keyof typeof pageTitles;
export type ShellDetailPage = 'region-detail' | 'service-detail' | 'offer-detail' | 'order-detail';
export type ShellFilters = { allocation?: string; region?: string; number?: string; message?: string; service?: string; plan?: string };
export type ShellRoute = {
  page: ShellPage | ShellDetailPage | 'not-found';
  region: string;
  number: string;
  message: string;
  service: string;
  plan: string;
  orderId: string;
  allocation?: string;
};
export type DetailTarget =
  | { page: 'region-detail'; region: string }
  | { page: 'service-detail'; service: string }
  | { page: 'offer-detail'; region: string; service: string; plan: string }
  | { page: 'order-detail'; orderId: string };

export function isShellPath(path: string) {
  return path === SHELL_PATH || path.startsWith(`${SHELL_PATH}/`) || path.startsWith(`${SHELL_PATH}?`);
}

function validSegment(value: string) {
  return Boolean(value) && value !== '.' && value !== '..' && !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseShellRoute(address: string): ShellRoute {
  const empty: ShellRoute = { page: 'not-found', region: '', number: '', message: '', service: '', plan: '', orderId: '' };
  if (!isShellPath(address) || address.includes('#')) return empty;
  const suffix = address.slice(SHELL_PATH.length);
  const queryIndex = suffix.indexOf('?');
  const path = (queryIndex < 0 ? suffix : suffix.slice(0, queryIndex)).replace(/^\/+/, '');
  const query = new URLSearchParams(queryIndex < 0 ? '' : suffix.slice(queryIndex + 1));
  const route = { ...empty, allocation: query.get('allocation') ?? '', region: query.get('region') ?? '', number: query.get('number') ?? '', message: query.get('message') ?? '', service: query.get('service') ?? '', plan: query.get('plan') ?? '' };
  // Decode each identifier once, without URL's dot-segment normalization.
  let segments: string[];
  try { segments = path ? path.split('/').map(decodeURIComponent) : ['dashboard']; }
  catch { return empty; }
  if (!segments.every(validSegment)) return empty;
  const [group, first, second, third] = segments;
  if (segments.length === 1 && Object.hasOwn(pageTitles, group)) return { ...route, page: group as ShellPage };
  if (segments.length === 2 && group === 'regions') return { ...route, page: 'region-detail', region: first };
  if (segments.length === 2 && group === 'services') return { ...route, page: 'service-detail', service: first };
  if (segments.length === 4 && group === 'offers') return { ...route, page: 'offer-detail', region: first, service: second, plan: third };
  if (segments.length === 2 && group === 'orders' && uuidSchema.safeParse(first).success) return { ...route, page: 'order-detail', orderId: first.toLowerCase() };
  return empty;
}

export function readShellRoute(): ShellRoute {
  return parseShellRoute(window.location.pathname + window.location.search);
}

export function shellHref(page: ShellPage, filters: ShellFilters = {}) {
  const query = new URLSearchParams();
  for (const key of ['allocation', 'region', 'number', 'message', 'service', 'plan'] as const) if (filters[key]) query.set(key, filters[key]);
  const path = page === 'dashboard' ? SHELL_PATH : `${SHELL_PATH}/${page}`;
  return `${path}${query.size ? `?${query}` : ''}`;
}

function encodeSegment(value: string) {
  if (!validSegment(value)) throw new Error('Invalid detail identifier');
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function detailHref(target: DetailTarget) {
  let segments: string[];
  switch (target.page) {
    case 'region-detail': segments = ['regions', target.region]; break;
    case 'service-detail': segments = ['services', target.service]; break;
    case 'offer-detail': segments = ['offers', target.region, target.service, target.plan]; break;
    case 'order-detail': segments = ['orders', uuidSchema.parse(target.orderId).toLowerCase()]; break;
  }
  return `${SHELL_PATH}/${segments.map(encodeSegment).join('/')}`;
}

export function isDetailRoute(route: ShellRoute) {
  return Object.hasOwn(detailCopy.titles, route.page);
}

export function shellPageTitle(route: ShellRoute) {
  if (route.page === 'not-found') return detailCopy.notFound;
  return Object.hasOwn(pageTitles, route.page) ? pageTitles[route.page as ShellPage] : detailCopy.titles[route.page as ShellDetailPage];
}

export function shellRouteKey(route: ShellRoute) {
  return JSON.stringify([route.allocation, route.page, route.region, route.number, route.message, route.service, route.plan, route.orderId]);
}

export function shellSidebarPage(route: ShellRoute): ShellPage | 'not-found' {
  switch (route.page) {
    case 'region-detail': case 'service-detail': return 'regions';
    case 'offer-detail': return 'purchase';
    case 'order-detail': return 'orders';
    default: return route.page;
  }
}
