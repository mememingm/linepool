import { Suspense, useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { Card } from '../ui/card';
import { SidebarProvider } from '../ui/sidebar';
import { TooltipProvider } from '../ui/tooltip';
import { LinepoolApiError } from '../api/client';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { State } from '../admin/primitives';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { navigate } from '../../app/router';
import { agentContextQueryKey, useAgentAccess, type AgentAccess } from './access';
import { AgentAccessGate, AgentPermissionGuard } from './AgentPermissionGuard';
import { AgentSidebar } from './AgentSidebar';
import { AgentTopbar } from './AgentTopbar';
import { agentPageTitle, canonicalAgentPath, parseAgentPath } from './navigation';
import { agentFullBleedPages, agentPageComponents } from './pages';
import '../admin/admin.css';
import './agent-center.css';

function AgentLayout({ access, address }: { access: Extract<AgentAccess, { status: 'active' }>; address: string }) {
  const p = useDisplayPreferences();
  const path = address.split('?')[0];
  const route = parseAgentPath(path) ?? { page: 'dashboard' as const, subagentId: null };
  const title = agentPageTitle(route.page, access.tier);
  const agentId = access.context.agent.id;
  const [revision, setRevision] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const fetching = useIsFetching({ queryKey: ['agent', agentId] }, queryClient) > 0;
  useEffect(() => { document.title = `${title} · LINEPOOL 代理中心`; }, [title]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    void queryClient.invalidateQueries({ queryKey: agentContextQueryKey(access.user.id) });
    setRevision(value => value + 1);
  }
  async function logout() {
    setLoggingOut(true);
    try { await api.logout(); }
    catch (cause) { if (!(cause instanceof LinepoolApiError && cause.status === 401)) { toast.error('退出失败，请重试。'); setLoggingOut(false); return; } }
    queryClient.clear();
    navigate('/login');
  }
  const Page = agentPageComponents[route.page];
  const content = <AgentPermissionGuard access={access} page={route.page}><Suspense fallback={<State loading error="" retry={() => {}} />}>
    <Page access={access} route={route} address={address} revision={revision} />
  </Suspense></AgentPermissionGuard>;

  return <TooltipProvider delayDuration={300}><SidebarProvider className="lp-admin lp-admin-theme lp-agent" data-theme={p.theme}>
    <AgentSidebar context={access.context} tier={access.tier} page={route.page} />
    <div className="lp-admin-main">
      <AgentTopbar user={access.user} agentName={access.context.agent.name} tier={access.tier} title={title} refreshing={fetching} onRefresh={refresh} onLogout={() => void logout()} loggingOut={loggingOut} />
      <main className="lp-admin-content" aria-busy={fetching}><div key={route.page} className="lp-admin-page">
        <div className="lp-admin-page-heading"><h1>{title}</h1><div className="lp-admin-actions" /></div>
        {agentFullBleedPages.includes(route.page) ? content : <Card className="lp-admin-records-card" id="lp-agent-records">{content}</Card>}
      </div></main>
    </div>
    <Toaster theme={p.theme === 'dark' ? 'dark' : 'light'} closeButton position="bottom-right" className="lp-admin-toaster" toastOptions={{ className: 'lp-admin-toast' }} />
  </SidebarProvider></TooltipProvider>;
}

/** Agent center: the platform admin layout, scoped by agent tier. Entered from the ordinary workspace. */
export default function AgentAdminShell({ address }: { address: string }) {
  const { access, retry } = useAgentAccess();
  const path = address.split('?')[0];
  useEffect(() => {
    const canonical = canonicalAgentPath(path);
    if (canonical) navigate(canonical + window.location.search, true);
  }, [path]);
  return <AgentAccessGate access={access} retry={retry}>{active => <AgentLayout access={active} address={address} />}</AgentAccessGate>;
}
