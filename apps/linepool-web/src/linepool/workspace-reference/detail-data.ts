import type { Locale } from '../preferences/store';
import { translate } from '../i18n/format';
import { LinepoolApiError } from '../api/client';
import { uuidSchema, type Catalog, type CreateOrderInput, type OrderDetail } from '../api/contracts';
import type { ShellFilters, ShellRoute } from './navigation';
import { saleOffers, saleRegions } from './sale-catalog';

// Keep new detail-page copy together for the following preferences/i18n phase.
export const detailCopy = {
  titles: { 'region-detail': '地区详情', 'service-detail': '服务详情', 'offer-detail': '服务方案详情', 'order-detail': '订单详情' },
  notFound: '页面不存在',
  catalogNotFound: '地区、服务或方案不存在',
  orderNotFound: '订单不存在或不属于当前账户',
  expired: '登录已过期，请重新登录',
  loading: '正在加载订单…',
  emptyOffers: '暂无可用服务',
  emptyNumbers: '此订单暂无关联号码',
  breadcrumb: '详情导航',
  available: '可用',
  soldOut: '暂无库存',
  completed: '已完成',
  active: '使用中',
  expiredNumber: '已过期',
  links: {
    dashboard: '工作台', regions: '全部地区', orders: '订单记录', purchase: '创建服务',
    region: '地区详情', service: '服务详情', offer: '服务方案详情', order: '独立详情',
    numbers: '我的号码', inbox: '收件箱', retry: '重试', copyNumber: '复制号码', copyOrder: '复制订单号',
  },
  labels: {
    region: '地区', service: '服务', plan: '服务方案', offers: '可选服务', area: '所属区域', prefix: '国际区号',
    inventory: '可用库存', duration: '服务期限', price: '单价', action: '操作', stock: '库存',
    orderNumber: '订单号', orderId: '订单编号', quantity: '服务数量', total: '扣除积分', created: '创建时间',
    assignedNumbers: '服务号码', phone: '号码', expires: '到期时间', status: '状态', messages: '短信',
  },
  units: { points: '积分', perNumber: '积分 / 个', days: '天', numbers: '个', messages: '条' },
} as const;

type Region = Catalog['regions'][number];
export type CatalogOffer = Catalog['offers'][number];
export type CatalogDetail =
  | { kind: 'region'; region: Region; offers: CatalogOffer[] }
  | { kind: 'service'; service: string; offers: CatalogOffer[] }
  | { kind: 'offer'; region: Region; offer: CatalogOffer };

export function resolveCatalogDetail(catalog: Catalog, route: ShellRoute): CatalogDetail | null {
  const regions = saleRegions(catalog);
  const region = regions.find(item => item.id === route.region);
  const offers = saleOffers(catalog).filter(offer => regions.some(item => item.id === offer.region) && catalog.services.includes(offer.service));
  const hasService = offers.some(offer => offer.service === route.service);
  if (route.page === 'region-detail') return region ? { kind: 'region', region, offers: offers.filter(offer => offer.region === region.id) } : null;
  if (route.page === 'service-detail') return hasService ? { kind: 'service', service: route.service, offers: offers.filter(offer => offer.service === route.service) } : null;
  if (route.page === 'offer-detail' && region && hasService) {
    const offer = offers.find(item => item.region === route.region && item.service === route.service && item.plan === route.plan);
    return offer ? { kind: 'offer', region, offer } : null;
  }
  return null;
}

export function regionPageTitle(catalog: Catalog, regionId: string, locale: Locale = 'zh-CN') {
  if (!regionId) return translate('地区服务', locale);
  const region = saleRegions(catalog).find(item => item.id === regionId);
  return region
    ? translate('{region}号码', locale, { region: locale === 'en-US' ? region.english : region.name })
    : translate(detailCopy.catalogNotFound, locale);
}

export function catalogDetailTitle(catalog: Catalog, route: ShellRoute, locale: Locale = 'zh-CN') {
  const t = (source: string) => translate(source, locale);
  if (route.page === 'order-detail') return t(detailCopy.titles['order-detail']);
  const detail = resolveCatalogDetail(catalog, route);
  if (!detail) return t(detailCopy.notFound);
  if (detail.kind === 'region') return t(detail.region.name);
  if (detail.kind === 'service') return detail.service;
  return `${t(detail.region.name)} · ${detail.offer.service} · ${t(detail.offer.name)}`;
}

export type PurchaseSelection = { region: string; service: string; plan: string; quantity: number };
export function purchaseSelection(catalog: Catalog, filters: ShellFilters, pending: CreateOrderInput | null): PurchaseSelection {
  // A frozen intent must outrank a new URL, even after inventory/catalog changes.
  if (pending) return { region: pending.region, service: pending.service, plan: pending.plan, quantity: pending.quantity };
  const regions = saleRegions(catalog);
  const region = regions.some(item => item.id === filters.region) ? filters.region! : regions[0]?.id ?? '';
  const offers = saleOffers(catalog).filter(offer => offer.region === region);
  const service = offers.some(item => item.service === filters.service) ? filters.service! : offers[0]?.service ?? '';
  const plans = offers.filter(offer => offer.service === service);
  const plan = plans.find(item => item.plan === filters.plan)?.plan ?? plans.find(item => item.plan === 'month')?.plan ?? plans[0]?.plan ?? 'month';
  return { region, service, plan, quantity: 1 };
}

export type OrderDetailState =
  | { status: 'loading' }
  | { status: 'ready'; order: OrderDetail }
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'error'; error: unknown };

export function loadOrderDetail(orderId: string, fetchOrder: (id: string) => Promise<OrderDetail>, publish: (state: OrderDetailState) => void) {
  let active = true;
  const cancel = () => { active = false; };
  if (!uuidSchema.safeParse(orderId).success) {
    publish({ status: 'not-found' });
    return { cancel, completion: Promise.resolve() };
  }
  publish({ status: 'loading' });
  const completion = (async () => {
    try {
      const order = await fetchOrder(orderId);
      if (!active) return;
      if (order.id.toLowerCase() !== orderId.toLowerCase()) throw new LinepoolApiError(200, 'INVALID_RESPONSE', 'Order identifier does not match the request');
      publish({ status: 'ready', order });
    } catch (error) {
      if (!active) return;
      if (error instanceof LinepoolApiError && error.status === 404) publish({ status: 'not-found' });
      else if (error instanceof LinepoolApiError && error.status === 401) publish({ status: 'expired' });
      else publish({ status: 'error', error });
    }
  })();
  return { cancel, completion };
}
