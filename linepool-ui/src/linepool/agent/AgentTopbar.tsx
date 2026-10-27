import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { User } from '../api/contracts';
import { SidebarTrigger } from '../ui/sidebar';
import { DropdownMenuItem } from '../ui/dropdown-menu';
import { AdminAccountMenu, AdminTooltip } from '../admin/Presentation';
import { ActionButton } from '../admin/primitives';
import { navigate } from '../../app/router';
import { shellHref } from '../workspace-reference/navigation';
import { agentTierLabels, type AgentTier } from './navigation';

/** Admin header layout plus the agent identity line and a way back to the ordinary workspace. */
export function AgentTopbar({ user, agentName, tier, title, refreshing, onRefresh, onLogout, loggingOut }: {
  user: User; agentName: string; tier: AgentTier; title: string;
  refreshing: boolean; onRefresh: () => void; onLogout: () => void; loggingOut: boolean;
}) {
  return <header className="lp-admin-header lp-agent-header"><div className="lp-admin-header-leading lp-agent-header-leading">
    <AdminTooltip label="展开 / 收起导航" side="bottom"><SidebarTrigger className="lp-admin-button lp-admin-sidebar-trigger" aria-label="展开 / 收起导航" /></AdminTooltip>
    <nav className="lp-admin-breadcrumb lp-agent-breadcrumb" aria-label="面包屑"><span>LINEPOOL 代理中心</span><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
  </div><div className="lp-admin-header-actions lp-agent-header-actions">
    <span className="lp-agent-identity" title={agentName}>当前身份：<strong>{agentTierLabels[tier]}</strong><small>{agentName}</small></span>
    <a className="lp-agent-back" href={shellHref('dashboard')}><ArrowLeft size={15} aria-hidden="true" />返回普通工作台</a>
    <AdminTooltip label="刷新数据"><span><ActionButton variant="ghost" aria-label="刷新数据" aria-busy={refreshing} disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'lp-admin-spin' : ''} /><span className="lp-admin-refresh-label">{refreshing ? '正在刷新…' : '刷新数据'}</span></ActionButton></span></AdminTooltip>
    <AdminAccountMenu user={user} roleLabel={agentTierLabels[tier]} logout={onLogout} busy={loggingOut}>
      <DropdownMenuItem onSelect={() => navigate(shellHref('dashboard'))}><ArrowLeft size={16} />返回普通工作台</DropdownMenuItem>
    </AdminAccountMenu>
  </div></header>;
}
