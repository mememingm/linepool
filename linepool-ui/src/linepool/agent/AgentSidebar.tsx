import { BarChart3, Boxes, LayoutDashboard, Network, ReceiptText, Settings2, ShoppingBag, Users, WalletCards, type LucideIcon } from 'lucide-react';
import type { AgentContext } from '../api/contracts';
import { Sidebar, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../ui/sidebar';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { AdminTooltip } from '../admin/Presentation';
import { agentHref, agentMenu, agentPageTitle, type AgentPage, type AgentTier } from './navigation';

const icons: Record<AgentPage, LucideIcon> = {
  dashboard: LayoutDashboard, agents: Network, customers: Users, inventory: Boxes, products: ShoppingBag,
  orders: ReceiptText, finance: WalletCards, reports: BarChart3, settings: Settings2,
};

/** Same sidebar component and classes as AdminSidebar; only the menu source differs. */
export function AgentSidebar({ context, tier, page }: { context: AgentContext; tier: AgentTier; page: AgentPage }) {
  const p = useDisplayPreferences();
  const { open, isMobile, setOpenMobile } = useSidebar();
  return <Sidebar theme={p.theme} className="lp-admin-sidebar lp-admin-theme">
    <a className="lp-admin-brand" href={agentHref()} aria-label="LINEPOOL 代理中心"><span className="lp-admin-brand-mark" aria-hidden="true">L</span><span className="lp-admin-brand-text">LINEPOOL<small>AGENT</small></span></a>
    {agentMenu(context).map(group => <div key={group.label}>
      <div className="lp-admin-sidebar-label">{group.label}</div>
      <nav aria-label={`${group.label}导航`}><SidebarMenu>{group.pages.map(item => {
        const Icon = icons[item];
        const title = agentPageTitle(item, tier);
        const link = <SidebarMenuButton asChild isActive={page === item}><a href={agentHref(item)} aria-current={page === item ? 'page' : undefined} aria-label={title} onClick={() => setOpenMobile(false)}><Icon size={18} aria-hidden="true" /><span>{title}</span></a></SidebarMenuButton>;
        return <SidebarMenuItem key={item}>{!open && !isMobile ? <AdminTooltip label={title} side="right">{link}</AdminTooltip> : link}</SidebarMenuItem>;
      })}</SidebarMenu></nav>
    </div>)}
  </Sidebar>;
}
