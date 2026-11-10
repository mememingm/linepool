import { Cable, LayoutDashboard, MessageSquare, Settings2, SlidersHorizontal, Smartphone, type LucideIcon } from 'lucide-react';
import { Sidebar, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../ui/sidebar';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { AdminTooltip } from '../admin/Presentation';
import { pcAgentMenu, type PcAgentPage } from './navigation';

const icons: Record<PcAgentPage, LucideIcon> = {
  overview: LayoutDashboard, inventory: Smartphone, pricing: Settings2, messages: MessageSquare, connection: Cable, settings: SlidersHorizontal,
};

/** Same sidebar component and classes as AdminSidebar; only the menu source differs. */
export function AgentSidebar({ page }: { page: PcAgentPage }) {
  const p = useDisplayPreferences();
  const { open, isMobile, setOpenMobile } = useSidebar();
  const iconOnly = !open && !isMobile;
  return <Sidebar theme={p.theme} className="lp-admin-sidebar lp-admin-theme">
    <a className="lp-admin-brand" href="/agent" aria-label={p.t('LINEPOOL 代理中心')}><span className="lp-admin-brand-mark" aria-hidden="true">L</span><span className="lp-admin-brand-text">LINEPOOL<small>AGENT</small></span></a>
    <nav aria-label={p.t('代理导航')}>{pcAgentMenu.map(group => <div className="lp-admin-nav-group" key={group.label}>
      <div className="lp-admin-sidebar-label">{p.t(group.label)}</div>
      <SidebarMenu>{group.pages.map(item => {
        const Icon = icons[item.id];
        const title = p.t(item.title);
        const link = <SidebarMenuButton asChild isActive={page === item.id}><a href={item.path} aria-current={page === item.id ? 'page' : undefined} aria-label={title} onClick={() => setOpenMobile(false)}><Icon size={18} aria-hidden="true" /><span>{title}</span></a></SidebarMenuButton>;
        return <SidebarMenuItem key={item.id}>{iconOnly ? <AdminTooltip label={title} side="right">{link}</AdminTooltip> : link}</SidebarMenuItem>;
      })}</SidebarMenu>
    </div>)}</nav>
  </Sidebar>;
}
