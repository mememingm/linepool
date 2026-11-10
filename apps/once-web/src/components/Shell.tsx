import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { useApp } from "../app/AppProvider";
import { useWorkspace, useWorkspaceRefreshing } from "../app/WorkspaceProvider";
import { useUIStore } from "../stores/ui-store";
import { leasePath, localDemo } from "../lib/models";
import { usePointAccount, formatPoints } from "../lib/points";
import { Brand, Icon } from "./ui";
import { WorkspaceDialogs } from "./WorkspaceDialogs";
import { Button } from "./ui/button";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
const items = [
  ["overview", "总览工作台", "smartphone"], ["numbers", "我的号码", "smartphone"],
  ["messages", "短信", "message-square-text"],
  ["voice", "语音通话", "phone"], ["subscription", "套餐与续费", "refresh-cw"],
  ["points", "积分账户", "receipt-text"], ["billing", "订单与账单", "receipt-text"], ["settings", "账户设置", "shield-question"],
];
function ThemeButton() {
  const theme = useUIStore(state => state.theme), toggleTheme = useUIStore(state => state.toggleTheme);
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="icon-btn" onClick={toggleTheme} aria-label="切换主题"><Icon name={theme === "light" ? "moon" : "sun"} /></Button></TooltipTrigger><TooltipContent>切换主题</TooltipContent></Tooltip>;
}
export function PublicHeader({ active = "" }: { active?: string }) {
  const { account } = useApp();
  return <header className="topbar"><div className="container topbar-inner">
    <Brand /><nav className="topnav" aria-label="主导航">
      {[["home", "首页", "/"], ["new", "选择号码", "/numbers/new"], ["help", "帮助中心", "/help"]].map(([key, title, to]) =>
        <Button asChild variant="ghost" key={key}><Link className={`nav-link ${active === key ? "active" : ""}`} to={to} aria-current={active === key ? "page" : undefined} data-active={active === key || undefined}>{title}</Link></Button>)}
    </nav><div className="top-actions"><ThemeButton />
      <Button asChild variant={account ? "outline" : "ghost"}><Link className={account ? "account-chip" : "ghost-btn"} to={account ? account.role === "ADMIN" ? "/admin/overview" : account.authKind === "PINCLODE" ? "/agent" : "/app/overview" : "/login"}>
        {account ? <><span className="workspace-avatar">{account.email.slice(0, 1).toUpperCase()}</span><span>{account.email}</span></> : "登录"}
      </Link></Button>
    </div>
  </div></header>;
}
function WorkspaceNav({ active, selectedId }: { active: string; selectedId: string }) {
  const { account } = useApp();
  const { pathname } = useLocation();
  const { setOpenMobile, openMobile, isMobile } = useSidebar();
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  const content = <>
    <SidebarHeader><Brand to="/app/overview" /><span className="sidebar-label">号码工作台</span></SidebarHeader>
    <SidebarContent><nav aria-label="工作台导航"><SidebarMenu>
      {items.map(([key, title, symbol]) => <SidebarMenuItem key={key}>
        <SidebarMenuButton asChild isActive={active === key} className="sidebar-link"><Link aria-label={title} aria-current={active === key ? "page" : undefined} to={leasePath(key, ["messages", "subscription"].includes(key) ? selectedId : "")}><Icon name={symbol} /><span>{title}</span></Link></SidebarMenuButton>
      </SidebarMenuItem>)}
    </SidebarMenu></nav></SidebarContent>
    <SidebarFooter><div className="workspace-chip"><span className="workspace-avatar">{account!.email.slice(0, 1).toUpperCase()}</span><span title={account!.email}>{account!.email}</span></div>
      <Button asChild variant="ghost"><Link className="sidebar-help" to="/help"><Icon name="circle-help" />帮助中心</Link></Button>
    </SidebarFooter>
  </>;
  return isMobile ? <Sheet open={openMobile} onOpenChange={setOpenMobile}>
    <SheetContent side="left" className="once-mobile-navigation" data-mobile="true" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".mobile-sidebar-trigger")?.focus(); }}>
      <SheetHeader className="sr-only"><SheetTitle>工作台导航</SheetTitle><SheetDescription>选择页面，管理你的号码、套餐与账户。</SheetDescription></SheetHeader>
      {content}
    </SheetContent>
  </Sheet> : <Sidebar className="once-sidebar" collapsible="offcanvas">{content}</Sidebar>;
}
export function Shell() {
  const { account, logout } = useApp();
  const points = usePointAccount();
  const { selectedId, busy, refresh } = useWorkspace();
  const refreshing = useWorkspaceRefreshing();
  const location = useLocation();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => { viewport.current?.scrollTo({ top: 0, left: 0 }); }, [location.pathname]);
  const active = location.pathname.split("/")[2] || "overview";
  return <div className="app product-ui once-ui workspace-v3" data-workspace-page={active} data-workspace-owner={account!.id}>
    <SidebarProvider className="app-shell" style={{ "--sidebar-width": "208px" } as React.CSSProperties}>
      <WorkspaceNav active={active} selectedId={selectedId} />
      <div className="app-main"><header className="app-topbar">
        <div className="breadcrumb"><SidebarTrigger className="mobile-sidebar-trigger" aria-label="打开工作台导航" /><Link to="/app/overview">ONCE</Link><span>/</span><strong>{active === "new" ? "租用新号码" : items.find(item => item[0] === active)?.[1]}</strong></div>
        <div className="app-toolbar">
          {!localDemo() && <Button asChild variant="outline"><Link to="/app/points">{points.data ? formatPoints(points.data.availablePoints) : "积分账户"}</Link></Button>}
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="icon-btn" data-action="refresh-data" disabled={busy || refreshing} aria-busy={refreshing} onClick={() => { void refresh(); }} aria-label="刷新账户数据"><span className={refreshing ? "refreshing-icon" : ""}><Icon name="refresh-cw" /></span></Button></TooltipTrigger><TooltipContent>{refreshing ? "正在刷新" : "刷新账户数据"}</TooltipContent></Tooltip>
          <ThemeButton />
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="account-menu" aria-label="账户菜单"><span className="workspace-avatar">{account!.email.slice(0, 1).toUpperCase()}</span><ChevronsUpDown size={14} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="account-dropdown"><DropdownMenuLabel>{account!.email}</DropdownMenuLabel><DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link to="/app/settings">账户设置</Link></DropdownMenuItem>
              {account!.role === "ADMIN" && <DropdownMenuItem asChild><Link to="/admin/overview">管理后台</Link></DropdownMenuItem>}
              {localDemo() ? <DropdownMenuItem asChild><a href="/#/app/numbers">返回账户</a></DropdownMenuItem> : <DropdownMenuItem disabled={busy} onSelect={() => { void logout(); }}><LogOut size={16} />退出账户</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header><div className="workspace-viewport" ref={viewport} tabIndex={0} role="region" aria-label="工作台内容"><Outlet /></div></div>
      <WorkspaceDialogs />
    </SidebarProvider>
  </div>;
}
