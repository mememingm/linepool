import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, FolderSync, Languages, LayoutDashboard, LogOut, MessageSquare, Moon, ShoppingBag, Smartphone, Sun, Users, WalletCards, Boxes, Network } from 'lucide-react';
import type { User } from '../api/contracts';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Sidebar, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../ui/sidebar';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import UserAvatar from '../UserAvatar';
import { adminHref, adminPages, adminTitles, type AdminPage } from './navigation';

const LoadActivity = createContext({ pending: 0, begin: () => () => {} });
/** Presentation only: observes existing requests without changing fetches or permissions. */
export function AdminActivityProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(0);
  const begin = useCallback(() => { setPending(count => count + 1); let done = false; return () => { if (!done) { done = true; setPending(count => Math.max(0, count - 1)); } }; }, []);
  const value = useMemo(() => ({ pending, begin }), [pending, begin]);
  return <LoadActivity.Provider value={value}>{children}</LoadActivity.Provider>;
}
export const useAdminActivity = () => useContext(LoadActivity);
export function AdminTooltip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'right' | 'top' | 'bottom' }) {
  const p = useDisplayPreferences();
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent className="lp-admin-tooltip lp-admin-theme" data-theme={p.theme} side={side} sideOffset={6} collisionPadding={12}>{label}</TooltipContent></Tooltip>;
}
export function Identifier({ value }: { value: string }) {
  return <AdminTooltip label={value}><span tabIndex={0} className="lp-admin-identifier lp-admin-mono">{value}</span></AdminTooltip>;
}
export function AdminSidebar({ page }: { page: AdminPage }) {
  const p = useDisplayPreferences();
  const { open, isMobile, setOpenMobile } = useSidebar();
  const icons = { dashboard: LayoutDashboard, users: Users, numbers: Smartphone, products: ShoppingBag, orders: WalletCards, recharges: WalletCards, projects: FolderSync, receipts: MessageSquare, agents: Network, inventory: Boxes };
  return <Sidebar theme={p.theme} className="lp-admin-sidebar lp-admin-theme">
    <a className="lp-admin-brand" href="/admin" aria-label="LINEPOOL Admin"><span className="lp-admin-brand-mark" aria-hidden="true">L</span><span className="lp-admin-brand-text">LINEPOOL<small>ADMIN</small></span></a>
    <div className="lp-admin-sidebar-label">平台管理</div>
    <nav aria-label="后台导航"><SidebarMenu>{adminPages.map(item => {
      const Icon = icons[item];
      const link = <SidebarMenuButton asChild isActive={page === item}><a href={adminHref(item)} aria-current={page === item ? 'page' : undefined} aria-label={adminTitles[item]} onClick={() => setOpenMobile(false)}><Icon size={18} aria-hidden="true" /><span>{adminTitles[item]}</span></a></SidebarMenuButton>;
      return <SidebarMenuItem key={item}>{!open && !isMobile ? <AdminTooltip label={adminTitles[item]} side="right">{link}</AdminTooltip> : link}</SidebarMenuItem>;
    })}</SidebarMenu></nav>
  </Sidebar>;
}
export function AdminAccountMenu({ user, logout, busy }: { user: User; logout: () => void; busy: boolean }) {
  const p = useDisplayPreferences();
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="lp-admin-account-trigger" aria-label="管理员账户菜单">
    <UserAvatar name={user.displayName} /><span className="lp-admin-account-summary"><strong>{user.displayName}</strong><small>平台管理员</small></span><ChevronDown size={14} />
  </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={10} collisionPadding={12} className="lp-admin-dropdown lp-admin-theme" data-theme={p.theme}>
      <DropdownMenuLabel className="lp-admin-account-label"><strong>{user.displayName}</strong><span>{user.email}</span></DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="lp-admin-menu-label"><Languages size={15} />语言 / Language</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={p.locale} onValueChange={value => p.setLocale(value === 'en-US' ? 'en-US' : 'zh-CN')}><DropdownMenuRadioItem value="zh-CN">简体中文</DropdownMenuRadioItem><DropdownMenuRadioItem value="en-US">English</DropdownMenuRadioItem></DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="lp-admin-menu-label">{p.theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}主题</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={p.selectedTheme} onValueChange={p.setTheme}><DropdownMenuRadioItem value="light">{p.t('浅色模式')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark">{p.t('深色模式')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="system">{p.t('系统')}</DropdownMenuRadioItem></DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="lp-admin-menu-logout" disabled={busy} onSelect={logout}><LogOut size={16} />{busy ? '正在退出…' : p.t('退出登录')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
