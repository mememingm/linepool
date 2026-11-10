import { useEffect, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { navigate } from '../../app/router';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { ActionButton, State } from '../admin/primitives';
import { shellHref } from '../workspace-reference/navigation';
import type { AgentAccess } from './access';
import { agentAllowedPages, agentHref, agentPageTitle, type AgentPage } from './navigation';

function AccessNotice({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  const p = useDisplayPreferences();
  return <main className="lp-admin-access lp-agent-access" data-theme={p.theme}><ShieldCheck size={32} /><h1>{title}</h1><p>{message}</p>{children}<a href={shellHref('dashboard')}>返回普通工作台</a></main>;
}

/** Whole-center gate: only ACTIVE agents enter. URL access by non-agents lands here, never on a page. */
export function AgentAccessGate({ access, retry, children }: { access: AgentAccess; retry: () => void; children: (active: Extract<AgentAccess, { status: 'active' }>) => ReactNode }) {
  const p = useDisplayPreferences();
  useEffect(() => {
    if (access.status === 'signed-out') navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`, true);
  }, [access.status]);
  switch (access.status) {
    case 'signed-out': return null;
    case 'loading': return <main className="lp-admin-access lp-agent-access" data-theme={p.theme}><a href="/">LINEPOOL</a><State loading error="" retry={retry} /></main>;
    case 'none': return <AccessNotice title="403 · 无代理中心访问权限" message="当前账号尚未开通代理身份。如果你是合作伙伴，请联系平台管理员开通；开通后退出并重新登录即可进入代理中心。" />;
    case 'inactive': return <AccessNotice title="代理中心暂不可用" message={access.message} />;
    case 'error': return <AccessNotice title="代理身份加载失败" message={access.message}><ActionButton onClick={retry}>重试</ActionButton></AccessNotice>;
    case 'active': return <>{children(access)}</>;
  }
}

/** Per-page gate inside the layout: hides pages outside the agent's tier (e.g. 代理管理 for 下级代理). */
export function AgentPermissionGuard({ access, page, children }: { access: Extract<AgentAccess, { status: 'active' }>; page: AgentPage; children: ReactNode }) {
  if (agentAllowedPages(access.context).includes(page)) return <>{children}</>;
  return <div className="lp-admin-state" role="alert"><ShieldCheck size={24} /><p>当前身份无法访问「{agentPageTitle(page, access.tier)}」。</p><ActionButton onClick={() => navigate(agentHref('dashboard'))}>返回代理概览</ActionButton></div>;
}
