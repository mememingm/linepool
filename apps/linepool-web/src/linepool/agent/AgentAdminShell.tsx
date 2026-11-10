import { lazy, Suspense, useEffect, useState } from 'react';
import { useIsFetching, useQuery } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import type { User } from '../api/contracts';
import { LinepoolApiError } from '../api/client';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { Card } from '../ui/card';
import { SidebarProvider } from '../ui/sidebar';
import { TooltipProvider } from '../ui/tooltip';
import { State } from '../admin/primitives';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { navigate } from '../../app/router';
import { PcAuthFailure, PcLoginButton, pcError } from './pc-components';
import { AgentSidebar } from './AgentSidebar';
import { AgentTopbar } from './AgentTopbar';
import { pcAgentPages, type PcAgentPage } from './navigation';
import { usePcSession } from './pc/shared';
import '../admin/admin.css';
import './agent-center.css';
import './pc.css';

const OverviewPage = lazy(() => import('./pc/OverviewPage'));
const InventoryPage = lazy(() => import('./pc/InventoryPage'));
const ShopProductsPage = lazy(() => import('./pc/ShopProductsPage'));
const MessagesPage = lazy(() => import('./pc/MessagesPage'));
const ConnectionPage = lazy(() => import('./pc/ConnectionPage'));
const SettingsPage = lazy(() => import('./pc/SettingsPage'));

function AgentPageBody({ user, view, address }: { user: User; view: PcAgentPage; address: string }) {
  const p = useDisplayPreferences();
  const session = usePcSession(user.id);
  const params = new URLSearchParams(address.split('?')[1] ?? '');
  const connection = session.data?.connection;
  if (!session.data || !connection) return <>
    <State loading={session.isPending} data={session.data} error={session.error ? pcError(session.error) : ''} retry={() => void session.refetch()} />
    {session.data && <Card className="lp-admin-section lp-pc-panel"><h2>{p.t('连接你的 PC 账号')}</h2><p className="lp-admin-context">{p.t('通过 PinClode 授权后查看自己的号码和验证码。')}</p><PcLoginButton /></Card>}
  </>;
  const props = { user, session: session.data, connection, numberId: params.get('numberId') ?? '' };
  return <Suspense fallback={<State loading error="" retry={() => {}} />}>
    {session.error && <p className="lp-admin-warning" role="status">{p.t('数据刷新失败，当前显示的是上次加载的内容。')}</p>}
    {view === 'overview' && <OverviewPage {...props} />}
    {view === 'inventory' && <InventoryPage {...props} params={params} refetch={() => void session.refetch()} refreshing={session.isFetching} />}
    {view === 'pricing' && <ShopProductsPage {...props} />}
    {view === 'messages' && <MessagesPage {...props} />}
    {view === 'connection' && <ConnectionPage {...props} />}
    {view === 'settings' && <SettingsPage {...props} />}
  </Suspense>;
}

export default function AgentAdminShell({ address }: { address: string }) {
  const p = useDisplayPreferences();
  const session = useQuery({ queryKey: ['session'], queryFn: ({ signal }) => api.me({ signal }), staleTime: 0 }, queryClient);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const user = session.data?.data;
  const signedOut = session.error instanceof LinepoolApiError && session.error.status === 401;
  const params = new URLSearchParams(address.split('?')[1] ?? '');
  const authError = params.get('authError');
  const refreshCount = useIsFetching({ queryKey: ['pc-session', user?.id] }, queryClient) + useIsFetching({ queryKey: ['pc-messages', user?.id] }, queryClient);
  const pagePath = address.split(/[?#]/)[0].replace(/\/$/, '') || '/agent';
  const page = pcAgentPages.find(item => item.path === pagePath) ?? pcAgentPages[0];
  useEffect(() => {
    const title = document.title; document.title = `${p.t(page.title)} · LINEPOOL`;
    if (pagePath !== page.path) navigate(page.path, true);
    return () => { document.title = title; };
  }, [page.path, page.title, pagePath, p.locale]);
  useEffect(() => {
    if (user?.role === 'ADMIN' && !authError) navigate('/admin', true);
  }, [user?.id, user?.role, authError]);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true); setError('');
    try { await api.logout(); }
    catch (cause) { if (!(cause instanceof LinepoolApiError && cause.status === 401)) { setError(pcError(cause)); setLoggingOut(false); return; } }
    queryClient.clear(); navigate('/agent'); setLoggingOut(false);
  }
  if (session.isPending || signedOut || !user || session.error) return <TooltipProvider><main className="lp-admin-access" data-theme={p.theme}><a href="/">LINEPOOL</a><h1>{p.t('代理连接与取码')}</h1><PcAuthFailure code={authError} /><State loading={session.isPending} error={session.error && !signedOut ? pcError(session.error) : ''} retry={() => void session.refetch()} />{signedOut && <><p>{p.t('使用已开通本站应用的 PC 账号登录，查看自己的号码和验证码。')}</p><PcLoginButton /><a href="/login">{p.t('普通用户登录')}</a></>}</main></TooltipProvider>;
  if (user.role === 'ADMIN') return <TooltipProvider><main className="lp-admin-access" data-theme={p.theme}><a href="/">LINEPOOL</a><h1>{p.t('管理后台')}</h1><PcAuthFailure code={authError} /><a href="/admin">{p.t('返回管理后台')}</a></main></TooltipProvider>;
  if (user.authKind !== 'PINCLODE') return <TooltipProvider><main className="lp-admin-access" data-theme={p.theme}><a href="/">LINEPOOL</a><h1>{p.t('使用 PinClode 进入代理中心')}</h1><PcAuthFailure code={authError} /><p>{p.t('当前登录的是本站普通账号。代理连接使用 PinClode 身份登录。')}</p><PcLoginButton /><a href="/app">{p.t('返回工作台')}</a></main></TooltipProvider>;
  return <TooltipProvider><SidebarProvider className="lp-admin lp-admin-theme lp-agent" data-theme={p.theme}>
    <AgentSidebar page={page.id} />
    <div className="lp-admin-main">
      <AgentTopbar user={user} title={p.t(page.title)} refreshing={refreshCount > 0} onRefresh={() => { void queryClient.invalidateQueries({ queryKey: ['pc-session', user.id] }); void queryClient.invalidateQueries({ queryKey: ['pc-messages', user.id] }); }} onLogout={() => void logout()} loggingOut={loggingOut} />
      <main className="lp-admin-content"><div className="lp-admin-page-heading"><div><h1>{p.t(page.title)}</h1><p className="lp-admin-page-description">{p.t(page.description)}</p></div></div><PcAuthFailure code={authError} />{error && <p role="alert" className="lp-admin-error">{error}</p>}<AgentPageBody key={user.id} user={user} view={page.id} address={address} /></main>
    </div><Toaster theme={p.theme === 'dark' ? 'dark' : 'light'} closeButton />
  </SidebarProvider></TooltipProvider>;
}
