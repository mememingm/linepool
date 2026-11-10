import { ArrowLeft, Home, RefreshCw } from 'lucide-react';
import type { User } from '../api/contracts';
import { SidebarTrigger } from '../ui/sidebar';
import { DropdownMenuItem } from '../ui/dropdown-menu';
import { AdminAccountMenu, AdminTooltip } from '../admin/Presentation';
import { ActionButton } from '../admin/primitives';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';

/** Original agent header, using the trusted PC identity and current account-switch flow. */
export function AgentTopbar({ user, title, refreshing, onRefresh, onLogout, loggingOut }: {
  user: User; title: string;
  refreshing: boolean; onRefresh: () => void; onLogout: () => void; loggingOut: boolean;
}) {
  const p = useDisplayPreferences();
  const switchAccountHref = '/login?switchAccount=local&redirect=%2Fapp';
  return <header className="lp-admin-header lp-agent-header"><div className="lp-admin-header-leading lp-agent-header-leading">
    <AdminTooltip label={p.t('展开 / 收起导航')} side="bottom"><SidebarTrigger className="lp-admin-button lp-admin-sidebar-trigger" aria-label={p.t('展开 / 收起导航')} /></AdminTooltip>
    <nav className="lp-admin-breadcrumb lp-agent-breadcrumb" aria-label={p.t('面包屑')}><span>{p.t('LINEPOOL 代理中心')}</span><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
  </div><div className="lp-admin-header-actions lp-agent-header-actions">
    <span className="lp-agent-identity" title={user.displayName}><strong>{p.t('PinClode 代理')}</strong><small>{user.displayName}</small></span>
    <a className="lp-agent-back" href="/"><Home size={15} aria-hidden="true" />{p.t('返回首页')}</a>
    <AdminTooltip label={p.t('刷新数据')}><span><ActionButton variant="ghost" aria-label={p.t('刷新数据')} aria-busy={refreshing} disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'lp-admin-spin' : ''} /><span className="lp-admin-refresh-label">{p.t(refreshing ? '正在刷新…' : '刷新数据')}</span></ActionButton></span></AdminTooltip>
    <AdminAccountMenu user={user} roleLabel="PinClode 代理" logout={onLogout} busy={loggingOut}>
      <DropdownMenuItem asChild><a href="/"><Home size={16} />{p.t('返回首页')}</a></DropdownMenuItem>
      <DropdownMenuItem asChild><a href={switchAccountHref}><ArrowLeft size={16} />{p.t('切换本站账号进入工作台')}</a></DropdownMenuItem>
    </AdminAccountMenu>
  </div></header>;
}
