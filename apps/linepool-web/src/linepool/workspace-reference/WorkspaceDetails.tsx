import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { translateCopy } from '../i18n/format';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronRight, FileSearch, Inbox, RefreshCw, ShoppingBag } from 'lucide-react';
import { CopyValue } from '../business';
import { ActionButton, OrderStatusPill, fulfillmentDisplay } from '../components';
import { StatusPill } from '../../vendor/beautiful/src/components/atoms/StatusPill';
import { Flag } from '../showcase/shared';
import { apiMessage, type WorkspaceActions, type WorkspaceData } from './workspace-data';
import { detailHref, shellHref, type ShellRoute } from './navigation';
import { catalogDetailTitle, detailCopy, loadOrderDetail, resolveCatalogDetail, type CatalogOffer, type OrderDetailState } from './detail-data';
import './WorkspaceDetails.css';
import { platformCatalog } from '../api/contracts';
import { receivingModeLabel, receivingTerm, ReceivingStatus, ReceivingWindow } from './ReceivingService';

const logoFiles = import.meta.glob<string>('../assets/platform-logos/*.svg', { eager: true, query: '?url', import: 'default' });
const serviceLogos: Record<string, string | undefined> = Object.fromEntries(platformCatalog.map(platform => [platform.name, logoFiles[`../assets/platform-logos/${platform.slug}.svg`]]));

export function ServiceLabel({ service }: { service: string }) {
  return <span className="lp-shell-view-service">{serviceLogos[service] && <img src={serviceLogos[service]} width="18" height="18" alt="" />}{service}</span>;
}

function DetailLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="lp-shell-view-link" href={href}>{children}<ArrowRight size={15} aria-hidden="true" /></a>;
}

type Crumb = { label: string; href?: string };
function Breadcrumbs({ items }: { items: Crumb[] }) {
  const p = useDisplayPreferences();
  const copy = translateCopy(detailCopy, p.locale);
  return <nav className="lp-shell-detail-breadcrumbs" aria-label={copy.breadcrumb}><ol>{items.map((item, index) => <li key={index}>{index > 0 && <ChevronRight size={14} aria-hidden="true" />}{item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>;
}

function DetailState({ title, error = false, retry }: { title: string; error?: boolean; retry?: () => void }) {
  const p = useDisplayPreferences();
  return <div className={`lp-shell-detail-state${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}><FileSearch size={28} strokeWidth={1.4} aria-hidden="true" /><p>{p.t(title)}</p>{retry && <ActionButton size="sm" onClick={retry}><RefreshCw size={14} aria-hidden="true" />{p.t(detailCopy.links.retry)}</ActionButton>}</div>;
}

function OfferTable({ offers, data }: { offers: CatalogOffer[]; data: WorkspaceData }) {
  const p = useDisplayPreferences();
  const copy = translateCopy(detailCopy, p.locale);
  if (!offers.length) return <DetailState title={copy.emptyOffers} />;
  return <div className="lp-shell-view-table-scroll" tabIndex={0} role="region" aria-label={copy.labels.offers}><table className="lp-shell-detail-table"><thead><tr><th scope="col">{copy.labels.region}</th><th scope="col">{copy.labels.service}</th><th scope="col">{copy.labels.plan}</th><th scope="col">{copy.labels.price}</th><th scope="col">{copy.labels.stock}</th><th scope="col">{copy.labels.action}</th></tr></thead><tbody>{offers.map(offer => <tr key={detailHref({ page: 'offer-detail', ...offer })}>
    <td><a className="lp-shell-detail-region" href={detailHref({ page: 'region-detail', region: offer.region })}><Flag code={offer.region} />{p.t(data.catalog.regions.find(region => region.id === offer.region)?.name ?? '')}</a></td>
    <td><a href={detailHref({ page: 'service-detail', service: offer.service })}><ServiceLabel service={offer.service} /></a></td>
    <td>{p.t(offer.name)}<small>{receivingTerm(offer, p)}</small></td><td>{p.n(offer.unitPoints)}<small>{copy.units.perNumber}</small></td><td>{p.n(offer.availableCount)} {copy.units.numbers}</td>
    <td><DetailLink href={detailHref({ page: 'offer-detail', ...offer })}>{copy.links.offer}</DetailLink></td>
  </tr>)}</tbody></table></div>;
}

function CatalogDetails({ data, route }: { data: WorkspaceData; route: ShellRoute }) {
  const p = useDisplayPreferences();
  const copy = translateCopy(detailCopy, p.locale);
  const detail = resolveCatalogDetail(data.catalog, route);
  const crumbs: Crumb[] = [{ label: copy.links.dashboard, href: shellHref('dashboard') }, { label: copy.links.regions, href: shellHref('regions') }];
  if (detail?.kind === 'offer') crumbs.push({ label: p.t(detail.region.name), href: detailHref({ page: 'region-detail', region: detail.region.id }) }, { label: detail.offer.service, href: detailHref({ page: 'service-detail', service: detail.offer.service }) });
  crumbs.push({ label: catalogDetailTitle(data.catalog, route, p.locale) });
  if (!detail) return <><Breadcrumbs items={crumbs} /><DetailState title={copy.catalogNotFound} /><DetailLink href={shellHref('regions')}>{copy.links.regions}</DetailLink></>;
  if (detail.kind === 'offer') {
    const { region, offer } = detail;
    return <>
      <Breadcrumbs items={crumbs} />
      <div className="lp-shell-detail-identity"><Flag code={region.id} /><ServiceLabel service={offer.service} /><StatusPill tone={offer.availableCount ? 'green' : 'neutral'}>{offer.availableCount ? copy.available : copy.soldOut}</StatusPill></div>
      <dl className="lp-shell-detail-facts">
        <div><dt>{copy.labels.region}</dt><dd><DetailLink href={detailHref({ page: 'region-detail', region: region.id })}>{p.t(region.name)}</DetailLink></dd></div>
        <div><dt>{copy.labels.service}</dt><dd><DetailLink href={detailHref({ page: 'service-detail', service: offer.service })}>{offer.service}</DetailLink></dd></div>
        <div><dt>{copy.labels.plan}</dt><dd>{p.t(offer.name)}</dd></div><div><dt>{copy.labels.duration}</dt><dd>{receivingTerm(offer, p)}</dd></div>
        <div><dt>{copy.labels.price}</dt><dd>{p.n(offer.unitPoints)} {copy.units.perNumber}</dd></div><div><dt>{copy.labels.inventory}</dt><dd>{p.n(offer.availableCount)} {copy.units.numbers}</dd></div>
      </dl>
      <div className="lp-shell-detail-actions"><DetailLink href={shellHref('purchase', { region: offer.region, service: offer.service, plan: offer.plan })}><ShoppingBag size={15} aria-hidden="true" />{copy.links.purchase}</DetailLink><DetailLink href={shellHref('numbers', { region: region.id })}>{copy.links.numbers}</DetailLink></div>
    </>;
  }
  return <>
    <Breadcrumbs items={crumbs} />
    {detail.kind === 'region' ? <>
      <div className="lp-shell-detail-identity"><Flag code={detail.region.id} /><span>{detail.region.english}</span><StatusPill tone={detail.region.availableCount ? 'green' : 'neutral'}>{detail.region.availableCount ? copy.available : copy.soldOut}</StatusPill></div>
      <dl className="lp-shell-detail-facts"><div><dt>{copy.labels.area}</dt><dd>{p.t(detail.region.area)}</dd></div><div><dt>{copy.labels.prefix}</dt><dd>{detail.region.prefix}</dd></div><div><dt>{copy.labels.inventory}</dt><dd>{p.n(detail.region.availableCount)} {copy.units.numbers}</dd></div></dl>
      <div className="lp-shell-detail-actions"><DetailLink href={shellHref('purchase', { region: detail.region.id })}><ShoppingBag size={15} aria-hidden="true" />{copy.links.purchase}</DetailLink><DetailLink href={shellHref('numbers', { region: detail.region.id })}>{copy.links.numbers}</DetailLink></div>
    </> : <div className="lp-shell-detail-identity"><ServiceLabel service={detail.service} /></div>}
    <section className="lp-shell-detail-section"><h2>{copy.labels.offers}</h2><OfferTable offers={detail.offers} data={data} /></section>
  </>;
}

function OrderDetails({ data, actions, route }: { data: WorkspaceData; actions: WorkspaceActions; route: ShellRoute }) {
  const p = useDisplayPreferences();
  const copy = translateCopy(detailCopy, p.locale);
  const [state, setState] = useState<OrderDetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const fetchOrder = useRef(actions.order);
  useEffect(() => { fetchOrder.current = actions.order; }, [actions.order]);
  useEffect(() => {
    const request = loadOrderDetail(route.orderId, id => fetchOrder.current(id), setState);
    return request.cancel;
  }, [route.orderId, data.account.id, data.orders, attempt]);
  const order = state.status === 'ready' ? state.order : null;
  return <>
    <Breadcrumbs items={[{ label: copy.links.dashboard, href: shellHref('dashboard') }, { label: copy.links.orders, href: shellHref('orders') }, { label: order?.orderNumber ?? copy.titles['order-detail'] }]} />
    {state.status === 'loading' && <DetailState title={copy.loading} />}
    {state.status === 'not-found' && <DetailState title={copy.orderNotFound} />}
    {state.status === 'expired' && <DetailState title={copy.expired} error />}
    {state.status === 'error' && <DetailState title={p.t(apiMessage(state.error))} error retry={() => setAttempt(value => value + 1)} />}
    {order && <>
      <div className="lp-shell-detail-identity"><Flag code={order.region} /><ServiceLabel service={order.service} /><OrderStatusPill status={fulfillmentDisplay[order.status].status} label={p.t(order.status === 'COMPLETED' ? '号码已交付' : fulfillmentDisplay[order.status].label)} /></div>
      <dl className="lp-shell-detail-facts">
        <div><dt>{copy.labels.orderNumber}</dt><dd className="lp-shell-detail-copy">{order.orderNumber}<CopyValue labels={p.copyLabels} value={order.orderNumber} label={copy.links.copyOrder} /></dd></div>
        <div><dt>{copy.labels.orderId}</dt><dd>{order.id}</dd></div>
        <div><dt>{copy.labels.region}</dt><dd><DetailLink href={detailHref({ page: 'region-detail', region: order.region })}>{p.t(order.country)}</DetailLink></dd></div>
        <div><dt>{copy.labels.service}</dt><dd><DetailLink href={detailHref({ page: 'service-detail', service: order.service })}>{order.service}</DetailLink></dd></div>
        <div><dt>{copy.labels.plan}</dt><dd><DetailLink href={detailHref({ page: 'offer-detail', ...order })}>{p.t(order.planName)}</DetailLink></dd></div>
        <div><dt>{p.t("服务期限")}</dt><dd>{receivingTerm(order, p)}</dd></div>
        <div><dt>{p.t("分配方式")}</dt><dd>{order.areaCode ? p.t("指定区号 {code}", { code: order.areaCode }) : p.t("自动分配")}</dd></div>
        <div><dt>{p.t("服务类型")}</dt><dd>{p.t(receivingModeLabel(order))}</dd></div>
        <div><dt>{copy.labels.quantity}</dt><dd>{p.n(order.quantity)} {copy.units.numbers}</dd></div>
        <div><dt>{copy.labels.price}</dt><dd>{p.n(order.unitPoints)} {copy.units.perNumber}</dd></div>
        <div><dt>{copy.labels.total}</dt><dd>{p.n(order.totalPoints)} {copy.units.points}</dd></div>
        <div><dt>{copy.labels.created}</dt><dd>{p.date(order.createdAt)}</dd></div>
      </dl>
      <section className="lp-shell-detail-section"><h2>{copy.labels.assignedNumbers}</h2>{!order.numbers.length ? <div className="lp-shell-detail-state" role="status"><Inbox size={28} aria-hidden="true" /><p>{copy.emptyNumbers}</p></div> : <div className="lp-shell-view-table-scroll" tabIndex={0} role="region" aria-label={copy.labels.assignedNumbers}><table className="lp-shell-detail-table"><thead><tr><th scope="col">{copy.labels.phone}</th><th scope="col">{p.t('服务窗口')}</th><th scope="col">{copy.labels.status}</th><th scope="col">{copy.labels.messages}</th><th scope="col">{copy.labels.action}</th></tr></thead><tbody>{order.numbers.map(number => <tr key={number.allocationId ?? number.id}><td><div className="lp-shell-detail-copy">{number.phoneNumber}<CopyValue labels={p.copyLabels} value={number.phoneNumber} label={copy.links.copyNumber} /></div></td><td><ReceivingWindow number={number} /></td><td><ReceivingStatus number={number} /></td><td>{p.n(number.messageCount)} {copy.units.messages}</td><td><DetailLink href={shellHref('inbox', { number: number.id, allocation: number.allocationId, message: number.firstMessageId ?? undefined })}>{number.receivingStatus === 'SUCCESS' ? p.t('回看首码') : copy.links.inbox}</DetailLink></td></tr>)}</tbody></table></div>}</section>
    </>}
    <div className="lp-shell-detail-actions"><DetailLink href={shellHref('orders')}>{copy.links.orders}</DetailLink>{order && <DetailLink href={shellHref('numbers', { region: order.region })}>{copy.links.numbers}</DetailLink>}</div>
  </>;
}

export default function WorkspaceDetails(props: { data: WorkspaceData; actions: WorkspaceActions; route: ShellRoute }) {
  return <div className="lp-shell-details">{props.route.page === 'order-detail' ? <OrderDetails {...props} /> : <CatalogDetails {...props} />}</div>;
}
