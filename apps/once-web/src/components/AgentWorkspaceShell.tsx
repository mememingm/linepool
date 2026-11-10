import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { useApp } from "../app/AppProvider";
import { useUIStore } from "../stores/ui-store";
import { Brand, Icon } from "./ui";
import { Button } from "./ui/button";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import "../styles/agent.css";

export const agentPages = [
  { id: "overview", label: "总览工作台", title: "代理工作台", icon: "smartphone", description: "查看自己的号码资源、连接状态和业务配置。" },
  { id: "numbers", label: "我的号码", title: "本连接号码", icon: "smartphone", description: "查看已同步的号码、资源有效期和可用能力。" },
  { id: "messages", label: "短信与验证码", title: "收到的消息与验证码", icon: "message-square-text", description: "按号码查看自己的消息，管理已读状态和等待取码。" },
  { id: "plans", label: "套餐配置", title: "套餐配置", icon: "receipt-text", description: "配置自己的业务套餐、价格和启用状态。" },
  { id: "connection", label: "我的连接", title: "我的连接", icon: "refresh-cw", description: "查看 PinClode 授权、同步状态和启用能力。" },
] as const;
export type AgentSection = (typeof agentPages)[number]["id"];

function sectionHref(params: URLSearchParams, section: AgentSection) {
  const next = new URLSearchParams(params);
  next.set("section", section);
  return `/agent?${next}`;
}

function AgentNavigation({ section }: { section: AgentSection }) {
  const { account } = useApp();
  const [params] = useSearchParams();
  const { setOpenMobile, openMobile, isMobile } = useSidebar();
  const name = account?.displayName || "PinClode 代理";
  useEffect(() => { setOpenMobile(false); }, [section, setOpenMobile]);
  const content = <>
    <SidebarHeader><Brand to={sectionHref(params, "overview")} /><span className="sidebar-label">代理工作台</span></SidebarHeader>
    <SidebarContent><nav aria-label="代理工作台导航"><SidebarMenu>
      {agentPages.map(page => <SidebarMenuItem key={page.id}>
        <SidebarMenuButton asChild isActive={section === page.id} className="sidebar-link">
          <Link to={sectionHref(params, page.id)} aria-current={section === page.id ? "page" : undefined}><Icon name={page.icon} /><span>{page.label}</span></Link>
        </SidebarMenuButton>
      </SidebarMenuItem>)}
    </SidebarMenu></nav></SidebarContent>
    <SidebarFooter>
      <div className="workspace-chip"><span className="workspace-avatar">{name.slice(0, 1).toUpperCase()}</span><span className="agent-sidebar-account"><strong>{name}</strong><small>{account?.role === "ADMIN" ? "管理员个人连接" : "PinClode 代理"}</small></span></div>
      <Button asChild variant="ghost"><Link className="sidebar-help" to={account?.role === "ADMIN" ? "/admin/overview" : "/"}><Icon name="arrow-right" />{account?.role === "ADMIN" ? "返回管理后台" : "返回首页"}</Link></Button>
    </SidebarFooter>
  </>;
  return isMobile ? <Sheet open={openMobile} onOpenChange={setOpenMobile}>
    <SheetContent side="left" className="once-mobile-navigation" data-mobile="true" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".agent-workspace .mobile-sidebar-trigger")?.focus(); }}>
      <SheetHeader className="sr-only"><SheetTitle>代理工作台导航</SheetTitle><SheetDescription>选择号码、短信、套餐或连接页面。</SheetDescription></SheetHeader>
      {content}
    </SheetContent>
  </Sheet> : <Sidebar className="once-sidebar" collapsible="offcanvas">{content}</Sidebar>;
}

export function AgentWorkspaceShell({ section, refreshing, onRefresh, children }: {
  section: AgentSection; refreshing: boolean; onRefresh: () => void; children: ReactNode;
}) {
  const { account, logout } = useApp();
  const [params] = useSearchParams();
  const theme = useUIStore(state => state.theme);
  const toggleTheme = useUIStore(state => state.toggleTheme);
  const viewport = useRef<HTMLDivElement>(null);
  const page = agentPages.find(item => item.id === section)!;
  const name = account?.displayName || "PinClode 代理";
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0, left: 0 });
    document.title = `${page.title} · ONCE 代理工作台`;
    return () => { document.title = "ONCE · 独享号码租赁"; };
  }, [page]);
  return <div className="app product-ui once-ui workspace-v3 agent-workspace" data-workspace-page={`agent-${section}`} data-workspace-owner={account?.id}>
    <SidebarProvider className="app-shell" style={{ "--sidebar-width": "208px" } as CSSProperties}>
      <AgentNavigation section={section} />
      <div className="app-main">
        <header className="app-topbar">
          <div className="breadcrumb"><SidebarTrigger className="mobile-sidebar-trigger" aria-label="打开代理工作台导航" /><Link to={sectionHref(params, "overview")}>ONCE</Link><span>/</span><strong>{page.label}</strong></div>
          <div className="app-toolbar">
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="icon-btn" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh} aria-label="刷新本地状态"><span className={refreshing ? "refreshing-icon" : ""}><Icon name="refresh-cw" /></span></Button></TooltipTrigger><TooltipContent>刷新本地状态</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="icon-btn" onClick={toggleTheme} aria-label="切换主题"><Icon name={theme === "light" ? "moon" : "sun"} /></Button></TooltipTrigger><TooltipContent>切换主题</TooltipContent></Tooltip>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="account-menu" aria-label="代理账户菜单"><span className="workspace-avatar">{name.slice(0, 1).toUpperCase()}</span><span className="agent-toolbar-name">{name}</span><ChevronsUpDown size={14} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="account-dropdown"><DropdownMenuLabel>{name}</DropdownMenuLabel><DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to={sectionHref(params, "connection")}>我的连接</Link></DropdownMenuItem>
                {account?.role === "ADMIN" && <DropdownMenuItem asChild><Link to="/admin/overview">返回管理后台</Link></DropdownMenuItem>}
                <DropdownMenuItem asChild><Link to="/">返回首页</Link></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { void logout({ to: "/login" }); }}><LogOut size={16} />退出登录</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="workspace-viewport" ref={viewport} tabIndex={0} role="region" aria-label="代理工作台内容">
          <main className="content agent-content"><header className="agent-page-head"><h1>{page.title}</h1><p>{page.description}</p></header>{children}</main>
        </div>
      </div>
    </SidebarProvider>
  </div>;
}
