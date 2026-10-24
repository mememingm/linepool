import { navigate } from '../../app/router';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { ArrowRight, ChevronsLeft, ChevronsRight, CircleUserRound, Clock3, LayoutDashboard, Menu, MessageCircle, Settings2, ShoppingBag, WalletCards, X } from 'lucide-react';
import UserAvatar from '../UserAvatar';
import SidebarTools from './SidebarTools';
import { RechargeProvider, SidebarRechargeButton } from '../wallet/Recharge';
import ReferenceWorkspace from '../showcase/Reference';
import { useWorkspaceApi } from './workspace-data';
import { referenceData } from './reference-data';
import { readShellRoute, shellHref, shellPageTitle, shellRouteKey, shellSidebarPage } from './navigation';
import { catalogDetailTitle, regionPageTitle } from './detail-data';
import PageContainer from './PageContainer';
import WorkspacePages from './WorkspacePages';
import './WorkspaceReferenceShell.css';
import './WorkspaceVisual.css';

const homepageLinks = { dashboard: shellHref('dashboard'), purchase: shellHref('purchase'), numbers: shellHref('numbers'), inbox: shellHref('inbox'), orders: shellHref('orders'), services: shellHref('regions') };

function WorkspaceLoading({ error, retry }: { error: string; retry: () => void }) {
  return <main className="lp-shell-page lp-shell-loading" role={error ? 'alert' : 'status'} aria-label={error ? '工作台加载失败' : '正在加载工作台'}><aside><i /><i /><i /><i /></aside><section><header><i /><i /></header><div className="lp-shell-loading-cards"><i /><i /><i /></div>{error && <div className="lp-shell-loading-error"><p>{error}</p><button type="button" onClick={retry}>重试</button></div>}</section></main>;
}

function SidebarItem({ label, icon, href, active = false, badge }: { label: string; icon: ReactNode; href: string; active?: boolean; badge?: string }) {
  const p = useDisplayPreferences();
  return <a className={`lp-shell-nav-item${active ? ' is-active' : ''}`} href={href} aria-label={badge ? p.t("{label}，{count} 条未读", { label, count: badge }) : label} title={badge ? p.t("{label}，{count} 条未读", { label, count: badge }) : label} aria-current={active ? 'page' : undefined}><span className="lp-shell-nav-icon">{icon}</span><span className="lp-shell-nav-label">{label}</span>{badge && <span className="lp-shell-nav-badge" aria-hidden="true">{badge}</span>}</a>;
}

export default function WorkspaceReferenceShell() {
  const p = useDisplayPreferences();
  const [route, setRoute] = useState(readShellRoute);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [alertVisible, setAlertVisible] = useState(true);
  const workspace = useWorkspaceApi(route.page);
  const { data } = workspace;
  const liveReference = useMemo(() => data ? referenceData(data, p.locale) : undefined, [data, p.locale]);
  const shellRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLElement>(null);
  const referenceRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const restoreDrawerFocus = useRef(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const unread = data?.dashboard.unreadMessages ?? 0;
  const expiring = data?.numbers.filter(number => number.status === 'ACTIVE' && number.remainingDays <= 3) ?? [];
  const expiringCount = data?.dashboard.expiringNumbers ?? 0;
  const expiryNotice = data?.account.preferences.expiryNotice ?? false;
  const isDashboard = route.page === 'dashboard';
  const shellMode = isDashboard ? 'is-dashboard' : route.page === 'purchase' ? 'is-purchase' : route.page === 'inbox' ? 'is-inbox' : route.page === 'settings' ? 'is-settings' : route.page === 'account' ? 'is-account' : '';
  const routeKey = shellRouteKey(route);
  const sidebarPage = shellSidebarPage(route);

  function closeSidebar(restoreFocus = true) {
    restoreDrawerFocus.current = restoreFocus;
    setSidebarOpen(false);
  }

  useEffect(() => {
    const originalTitle = document.title;
    const syncRoute = () => { setRoute(readShellRoute()); closeSidebar(false); };
    window.addEventListener('popstate', syncRoute);
    return () => { window.removeEventListener('popstate', syncRoute); document.title = originalTitle; };
  }, []);

  useEffect(() => {
    const title = data && route.page === 'regions'
      ? regionPageTitle(data.catalog, route.region, p.locale)
      : data && ['region-detail', 'service-detail', 'offer-detail'].includes(route.page)
        ? catalogDetailTitle(data.catalog, route, p.locale)
        : p.t(shellPageTitle(route));
    document.title = `${title} · LINEPOOL`;
  }, [routeKey, data?.catalog, p.locale]);

  useEffect(() => {
    const view = isDashboard ? referenceRef.current : viewRef.current;
    view?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    view?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [routeKey, data?.account.id]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 801px)');
    const closeDrawer = () => { if (desktop.matches) closeSidebar(sidebarRef.current?.contains(document.activeElement) ?? false); };
    desktop.addEventListener('change', closeDrawer);
    return () => desktop.removeEventListener('change', closeDrawer);
  }, []);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (!sidebarOpen) {
      if (restoreDrawerFocus.current) {
        restoreDrawerFocus.current = false;
        const target = window.matchMedia('(min-width: 801px)').matches ? sidebar.querySelector<HTMLElement>('a[aria-current="page"]') ?? sidebar.querySelector<HTMLButtonElement>('.lp-shell-sidebar-toggle') : mobileToggleRef.current;
        target?.focus({ preventScroll: true });
      }
      return;
    }
    const body = document.body;
    const overflow = body.style.overflow;
    const overscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    sidebar.querySelector<HTMLButtonElement>('.lp-shell-drawer-close')?.focus({ preventScroll: true });
    const handleKeys = (event: KeyboardEvent) => {
      // Portalled dropdowns manage their own keyboard navigation and Escape key.
      if (event.target instanceof Element && event.target.closest('[data-slot="dropdown-menu-content"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSidebar(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); sidebar.focus(); return; }
      if (!sidebar.contains(document.activeElement) || document.activeElement === sidebar || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', handleKeys, true);
    return () => { window.removeEventListener('keydown', handleKeys, true); body.style.overflow = overflow; body.style.overscrollBehavior = overscroll; };
  }, [sidebarOpen, data?.account.id]);

  useEffect(() => { if (!data) closeSidebar(false); }, [data?.account.id]);

  useEffect(() => {
    if (workspace.needsLogin) navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`, true);
  }, [workspace.needsLogin]);

  useLayoutEffect(() => {
    if (!data) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const context = gsap.context(() => {
        const targets = isDashboard
          ? ['.lp-ref-summary', '.lp-ref-analytics', '.lp-ref-sidebar'].flatMap(selector => [...shellRef.current!.querySelectorAll(selector)])
          : [viewRef.current].filter((element): element is HTMLElement => Boolean(element));
        gsap.fromTo(targets, { y: 12, opacity: 0 }, {
          y: 0, opacity: 1, duration: 0.48, stagger: 0.065, ease: 'power3.out',
          clearProps: 'transform,opacity',
        });
      }, shellRef);
      return () => context.revert();
    });
    return () => media.revert();
  }, [routeKey, data?.account.id]);

  if (workspace.needsLogin) return null;
  if (!data) return <WorkspaceLoading error={workspace.error} retry={() => void workspace.refresh(true)} />;

  return <RechargeProvider account={data.account} onCredit={workspace.refresh}><div ref={shellRef} className={`lp-shell-page${shellMode ? ` ${shellMode}` : ''}${sidebarOpen ? ' is-sidebar-open' : ''}${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`} lang={p.locale} data-theme={p.theme}>
    {sidebarOpen && <button type="button" className="lp-shell-scrim" aria-label={p.t("关闭导航")} tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => closeSidebar()} />}
    <aside ref={sidebarRef} id="lp-shell-sidebar" className="lp-shell-sidebar" tabIndex={-1} role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen || undefined} aria-label={p.t("工作台导航")} onClick={event => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (link && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && sidebarOpen) closeSidebar(link.pathname + link.search === window.location.pathname + window.location.search);
    }}>
      <button type="button" className="lp-shell-sidebar-toggle" aria-label={sidebarCollapsed ? p.t("展开侧边栏") : p.t("收纳侧边栏")} title={sidebarCollapsed ? p.t("展开侧边栏") : p.t("收纳侧边栏")} aria-expanded={!sidebarCollapsed} aria-controls="lp-shell-sidebar" onClick={() => setSidebarCollapsed(value => !value)}>{sidebarCollapsed ? <ChevronsRight size={17} strokeWidth={1.5} /> : <ChevronsLeft size={17} strokeWidth={1.5} />}</button>
      <div className="lp-shell-sidebar-content">
        <div className="lp-shell-drawer-header"><h2>{p.t("工作台导航")}</h2><button className="lp-shell-drawer-close" type="button" aria-label={p.t("关闭账户导航")} title={p.t("关闭账户导航")} onClick={() => closeSidebar()}><X size={17} /></button></div>
        <a className="lp-shell-account" href={shellHref('account')} aria-label={p.t("我的账户")} aria-current={route.page === 'account' ? 'page' : undefined} title={`${p.t("我的账户")} · ${data.account.displayName}`}><UserAvatar name={data.account.displayName} /><span><strong>LINEPOOL</strong><small>{data.account.displayName} · {p.t("标准账户")}</small></span></a>
        <nav className="lp-shell-primary" aria-label={p.t("主导航")}>
          <SidebarItem label={p.t("工作台")} active={isDashboard} href={shellHref('dashboard')} icon={<LayoutDashboard size={17} strokeWidth={1.45} />} />
          <SidebarItem label={p.t("购买服务")} active={sidebarPage === 'purchase'} href={shellHref('purchase')} icon={<ShoppingBag size={17} strokeWidth={1.45} />} />
          <SidebarItem label={p.t("短信中心")} active={route.page === 'inbox'} href={shellHref('inbox')} badge={unread ? p.n(unread) : undefined} icon={<MessageCircle size={17} strokeWidth={1.45} />} />
          <SidebarItem label={p.t("账户设置")} active={route.page === 'settings'} href={shellHref('settings')} icon={<Settings2 size={17} strokeWidth={1.45} />} />
        </nav>
        <nav className="lp-shell-nav-group" aria-label={p.t("号码与订单")}><p>{p.t("号码与订单")}</p><SidebarItem label={p.t("我的号码")} active={route.page === 'numbers'} href={shellHref('numbers')} icon={<CircleUserRound size={17} strokeWidth={1.35} />} /><SidebarItem label={p.t("我的订单")} active={sidebarPage === 'orders'} href={shellHref('orders')} icon={<Clock3 size={17} strokeWidth={1.35} />} /><SidebarItem label={p.t("积分明细")} active={route.page === 'points'} href={shellHref('points')} icon={<WalletCards size={17} strokeWidth={1.35} />} /></nav>
        <div className="lp-shell-recharge-entry"><SidebarRechargeButton onOpen={() => { if (sidebarOpen) closeSidebar(false); }} /></div>

        {alertVisible && expiryNotice && expiringCount > 0 && <section className="lp-shell-expiry-alert"><header><h2>{p.t("{count} 个号码即将到期", { count: p.n(expiring.length) })}</h2><button type="button" aria-label={p.t("关闭到期提醒")} onClick={() => setAlertVisible(false)}><X size={14} /></button></header>{expiring.length > 0 && <p>{p.t("最近到期：{days} 天后", { days: p.n(Math.min(...expiring.map(number => number.remainingDays))) })}</p>}<div className="lp-shell-expiry-segments" aria-hidden="true">{['#35b66c', '#65c372', '#a9c752', '#edbf25', '#f7a51b', '#f27c19', '#ee4f2b', '', ''].map((color, index) => <i key={index} style={color ? { background: color } : undefined} />)}</div><a className="lp-shell-alert-link" href={shellHref('numbers')}>{p.t("查看号码")}<ArrowRight size={13} /></a></section>}
        {alertVisible && expiryNotice && expiringCount > 0 && <a className="lp-shell-expiry-shortcut" aria-label={p.t("{count} 个号码即将到期，查看号码", { count: p.n(expiring.length) })} title={p.t("{count} 个号码即将到期，查看号码", { count: p.n(expiring.length) })} href={shellHref('numbers')}><Clock3 size={17} strokeWidth={1.5} /><span aria-hidden="true">{p.n(expiring.length)}</span></a>}
      </div>
      <SidebarTools />
    </aside>
    <header className="lp-shell-mobile-header"><button ref={mobileToggleRef} type="button" className="lp-shell-mobile-toggle" inert={sidebarOpen} aria-label={sidebarOpen ? p.t("关闭账户导航") : p.t("展开账户导航")} aria-expanded={sidebarOpen} aria-controls="lp-shell-sidebar" onClick={() => setSidebarOpen(value => !value)}><Menu size={17} /></button><span>LINEPOOL</span></header>
    <div className="lp-shell-body">
      {workspace.error && <aside className="lp-shell-api-banner" role="alert"><span>{p.t(workspace.error)}</span><button type="button" disabled={workspace.loading} onClick={() => void workspace.refresh()}>{p.t("重试")}</button></aside>}
      <div ref={referenceRef} className="lp-shell-reference" hidden={!isDashboard} inert={sidebarOpen} tabIndex={-1} role="region" aria-label={p.t("工作台")}>{isDashboard && <PageContainer title={p.t('工作台')} titleId="lp-dashboard-title"><ReferenceWorkspace showHeader={false} showSearch={false} enhancedMotion links={homepageLinks} messageHref={message => shellHref('inbox', { number: message.numberId, message: message.id })} numberHref={numberId => shellHref('numbers', { number: numberId })} data={liveReference} refreshing={workspace.loading} onRefresh={workspace.refresh} onMarkRead={workspace.markRead} /></PageContainer>}</div>
      {!isDashboard && <main key={`${data.account.id}:${routeKey}`} ref={viewRef} className="lp-shell-view" inert={sidebarOpen} tabIndex={-1} aria-labelledby="lp-shell-view-title"><WorkspacePages data={data} actions={workspace} route={route} refreshing={workspace.loading} lastUpdated={workspace.lastUpdated} /></main>}
    </div>
  </div></RechargeProvider>;
}
