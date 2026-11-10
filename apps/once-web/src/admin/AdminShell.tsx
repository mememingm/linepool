import { useEffect, useState } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronsUpDown, LogOut, Moon, RefreshCw, Search, ShieldAlert, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "../app/AppProvider";
import { ApiError } from "../lib/api";
import { useUIStore } from "../stores/ui-store";
import { adminError, adminKeys, adminMock, sessionOptions } from "./api";
import { adminDescriptions, adminHref, adminIcons, adminNavGroups, adminPages, adminTitles, type AdminPage } from "./navigation";
import { Hint, State } from "./primitives";
import { ActionDialog, type ActionTarget } from "./actions";
import { DetailDrawer, type DetailTarget } from "./details";
import type { AdminPageContext, FormTarget } from "./context";
import { ImportDialog, NumberDialog, PlanDialog, SettingsDialog } from "./forms";
import type { AdminQuery, AdminSession } from "./types";
import { OverviewPage } from "./pages/OverviewPage";
import { UsersPage } from "./pages/UsersPage";
import { NumbersPage } from "./pages/NumbersPage";
import { LeasesPage } from "./pages/LeasesPage";
import { OrdersPage } from "./pages/OrdersPage";
import { MessagesPage } from "./pages/MessagesPage";
import { IntegrationsPage } from './pages/IntegrationsPage';
import { WebhooksPage } from "./pages/WebhooksPage";
import { AuditPage } from "./pages/AuditPage";
import { PlansPage } from "./pages/PlansPage";
import { PointsPage } from "./pages/PointsPage";
import "./admin.css";

type Option = { value: string; label: string };
const statusFilters: Partial<Record<AdminPage, Option[]>> = {
  users: [{ value: "ACTIVE", label: "正常" }, { value: "DISABLED", label: "已禁用" }, { value: "ADMIN", label: "管理员" }],
  numbers: [{ value: "AVAILABLE", label: "可售" }, { value: "OCCUPIED", label: "使用中" }, { value: "EXPIRED_HELD", label: "到期保留" }, { value: "HELD", label: "已暂停" }, { value: "RESERVED", label: "已预占" }, { value: "UNAVAILABLE", label: "不可用 / 历史" }],
  leases: [{ value: "ACTIVE", label: "使用中" }, { value: "EXPIRING", label: "3 天内到期" }, { value: "EXPIRED_HELD", label: "已到期保留" }, { value: "ENDED", label: "已结束" }, { value: "RELEASED", label: "已释放" }],
  orders: [{ value: "TODAY", label: "今日订单" }, { value: "ATTENTION", label: "需要核对" }, { value: "COMPLETED", label: "已完成" }, { value: "FAILED", label: "失败" }],
  messages: [{ value: "DELIVERED", label: "已送达" }, { value: "FAILED", label: "发送失败" }, { value: "UNCERTAIN", label: "结果待核对" }],
  webhooks: [{ value: "PENDING", label: "待处理" }, { value: "UNMATCHED", label: "未匹配" }, { value: "FAILED", label: "处理失败" }, { value: "QUARANTINED", label: "已隔离" }, { value: "IMPORTED", label: "已入库" }, { value: "IGNORED", label: "已忽略" }],
  audit: [{ value: "USER_STATUS", label: "修改用户状态" }, { value: "USER_PASSWORD_RESET", label: "重置密码" }, { value: "NUMBER_ASSIGN", label: "手动分配号码" }, { value: "NUMBER_HOLD", label: "暂停 / 恢复号码" }, { value: "LEASE_END", label: "回收租约" }, { value: "LEASE_EXTEND", label: "租约延期" }, { value: "NUMBER_CREATE", label: "新增号码" }, { value: "NUMBER_UPDATE", label: "编辑号码" }, { value: "NUMBER_DELETE", label: "删除号码" }, { value: "NUMBER_RELEASE", label: "释放号码" }, { value: "ONCE_PLAN_SAVE", label: "保存套餐" }, { value: "PLAN_CREATE", label: "新建套餐" }, { value: "PLAN_UPDATE", label: "编辑套餐" }, { value: "SETTINGS_UPDATE", label: "修改到期规则" }, { value: "WEBHOOK_RETRY", label: "重新处理事件" }],
};
const extraFilters: Partial<Record<AdminPage, { key: string; label: string; options: Option[] }>> = {
  messages: { key: "direction", label: "收发方向", options: [{ value: "INBOUND", label: "收到" }, { value: "OUTBOUND", label: "发出" }] },
};
const placeholders: Partial<Record<AdminPage, string>> = {
  users: "搜索邮箱或用户 ID", numbers: "搜索号码、州名、备注或用户邮箱", leases: "搜索号码、用户邮箱或租约 ID",
  orders: "搜索订单号、用户邮箱或号码", messages: "搜索号码、对方号码、用户或内容", webhooks: "搜索事件 ID、短信 ID 或上游号码 ID",
  audit: "搜索管理员、对象 ID 或原因",
};


function ThemeToggle() {
  const theme = useUIStore(state => state.theme), toggle = useUIStore(state => state.toggleTheme);
  return <Hint label="切换主题" side="bottom"><Button variant="ghost" size="icon" aria-label="切换主题" onClick={toggle}>{theme === "light" ? <Moon /> : <Sun />}</Button></Hint>;
}
function AdminNav({ page }: { page: AdminPage }) {
  const { account } = useApp();
  const pcAccount = account?.authKind === "PINCLODE";
  const { setOpenMobile } = useSidebar();
  return <Sidebar className="oa-sidebar" collapsible="icon">
    <SidebarHeader><Link className="oa-brand" to={adminHref("overview")} aria-label="ONCE 管理后台"><span className="oa-brand-mark" aria-hidden="true">O</span>
      <span className="oa-brand-text">ONCE<small>ADMIN</small></span></Link></SidebarHeader>
    <SidebarContent>{adminNavGroups.map(group => <SidebarGroup key={group.label}><SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarMenu>{group.pages.map(item => { const Icon = adminIcons[item]; return <SidebarMenuItem key={item}>
        <SidebarMenuButton asChild isActive={page === item} tooltip={adminTitles[item]}>
          <Link to={adminHref(item)} aria-current={page === item ? "page" : undefined} onClick={() => setOpenMobile(false)}><Icon /><span>{adminTitles[item]}</span></Link>
        </SidebarMenuButton></SidebarMenuItem>; })}</SidebarMenu></SidebarGroup>)}</SidebarContent>
    <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild tooltip={pcAccount ? "我的 PC 连接" : "返回用户工作台"}>
      <Link to={pcAccount ? "/agent?view=connection" : "/app/overview"}><ArrowLeft /><span>{pcAccount ? "我的 PC 连接" : "返回用户工作台"}</span></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </Sidebar>;
}
function AccountMenu({ session }: { session: AdminSession }) {
  const { account, logout } = useApp();
  const pcAccount = account?.authKind === "PINCLODE";
  const name = pcAccount ? account.displayName || "PinClode 管理员" : session.email;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="oa-account" aria-label="管理员账户菜单">
    <span className="oa-avatar">{name.slice(0, 1).toUpperCase()}</span><span className="oa-account-text"><strong>{name}</strong><small>管理员</small></span><ChevronsUpDown />
  </Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="oa-menu once-admin-portal">
    <DropdownMenuLabel>{name}</DropdownMenuLabel><DropdownMenuSeparator />
    <DropdownMenuItem asChild><Link to={pcAccount ? "/agent?view=connection" : "/app/overview"}>{pcAccount ? "我的 PC 连接" : "返回用户工作台"}</Link></DropdownMenuItem>
    {!adminMock && <DropdownMenuItem variant="destructive" onSelect={() => { void logout(); }}><LogOut />退出登录</DropdownMenuItem>}
  </DropdownMenuContent></DropdownMenu>;
}
function Toolbar({ page, input, update }: { page: AdminPage; input: AdminQuery; update: AdminPageContext["update"] }) {
  const [search, setSearch] = useState(input.search ?? "");
  useEffect(() => setSearch(input.search ?? ""), [input.search]);
  const statuses = statusFilters[page], extra = extraFilters[page];
  if (!placeholders[page]) return null;
  return <form className="oa-toolbar" role="search" onSubmit={event => { event.preventDefault(); update("search", search.trim()); }}>
    <div className="oa-search"><Search aria-hidden="true" /><Input aria-label="搜索" placeholder={placeholders[page]} maxLength={200} value={search} onChange={event => setSearch(event.target.value)} />
      <Button type="submit" size="sm" variant="outline">搜索</Button></div>
    {statuses && <Select value={input.status || "all"} onValueChange={value => update("status", value === "all" ? "" : value)}>
      <SelectTrigger className="oa-select" aria-label="状态筛选"><SelectValue /></SelectTrigger>
      <SelectContent className="once-admin-portal"><SelectItem value="all">{page === "audit" ? "全部操作" : "全部状态"}</SelectItem>
        {statuses.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>}
    {extra && <Select value={(input[extra.key as keyof AdminQuery] as string) || "all"} onValueChange={value => update(extra.key, value === "all" ? "" : value)}>
      <SelectTrigger className="oa-select" aria-label={extra.label}><SelectValue /></SelectTrigger>
      <SelectContent className="once-admin-portal"><SelectItem value="all">{extra.label}</SelectItem>
        {extra.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>}
    {input.userId && <Button type="button" variant="outline" size="sm" onClick={() => update("userId", "")}><X />只看某个用户 · 清除</Button>}
    {input.leaseId && <Button type="button" variant="outline" size="sm" onClick={() => update("leaseId", "")}><X />只看某条租约 · 清除</Button>}
  </form>;
}
function AdminLayout({ session }: { session: AdminSession }) {
  const client = useQueryClient();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const page = (adminPages.find(item => pathname === `/admin/${item}`) ?? "overview") as AdminPage;
  const fetching = useIsFetching({ queryKey: adminKeys.all }) > 0;
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [form, setForm] = useState<FormTarget | null>(null);
  const number = Number(params.get("page"));
  const input: AdminQuery = {
    page: Number.isInteger(number) && number > 0 ? number : 1,
    pageSize: [10, 20, 50].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 20,
    ...Object.fromEntries(["search", "status", "userId", "leaseId", "provider", "direction", "eventType", "from", "to"].map(key => [key, params.get(key) ?? ""]).filter(([, value]) => value)),
  };
  useEffect(() => { setDetail(null); setAction(null); setForm(null); document.title = `${adminTitles[page]} · ONCE 管理后台`; }, [page]);
  function update(key: string, value: string) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    });
  }
  const context: AdminPageContext = { input, update, openDetail: setDetail, openAction: target => { setDetail(null); setAction(target); },
    openForm: target => { setDetail(null); setForm(target); } };
  return <div className="once-admin">
    <SidebarProvider className="oa-shell" style={{ "--sidebar-width": "232px" } as React.CSSProperties}>
      <AdminNav page={page} />
      <div className="oa-main">
        <header className="oa-header"><div className="oa-header-leading"><SidebarTrigger aria-label="展开 / 收起导航" />
          <nav className="oa-breadcrumb" aria-label="面包屑"><span>ONCE 管理后台</span><span aria-hidden="true">/</span><span aria-current="page">{adminTitles[page]}</span></nav></div>
          <div className="oa-header-actions">{adminMock && <span className="oa-mock-tag">演示数据</span>}
            <Button variant="ghost" aria-busy={fetching} disabled={fetching} onClick={() => void client.invalidateQueries({ queryKey: adminKeys.all })}>
              <RefreshCw className={fetching ? "oa-spin" : ""} /><span className="oa-hide-mobile">{fetching ? "正在刷新…" : "刷新数据"}</span></Button>
            <ThemeToggle /><AccountMenu session={session} /></div></header>
        <main className="oa-content"><div className="oa-page" key={page}>
          <div className="oa-page-heading"><h1>{adminTitles[page]}</h1><p>{adminDescriptions[page]}</p></div>
          <Toolbar page={page} input={input} update={update} />
          <Outlet context={context} />
        </div></main>
      </div>
      {detail && <DetailDrawer target={detail} onClose={() => setDetail(null)} openAction={context.openAction} openDetail={setDetail} openForm={context.openForm} />}
      {action && <ActionDialog target={action} onClose={() => setAction(null)} />}
      {form?.kind === "plan" && <PlanDialog plan={form.plan} onClose={() => setForm(null)} />}
      {form?.kind === "number" && <NumberDialog number={form.number} onClose={() => setForm(null)} />}
      {form?.kind === "import" && <ImportDialog onClose={() => setForm(null)} />}
      {form?.kind === "settings" && <SettingsDialog settings={form.settings} onClose={() => setForm(null)} />}
    </SidebarProvider>
  </div>;
}
function AdminAccess() {
  const session = useQuery(sessionOptions());
  const { logout } = useApp();
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();
  const status = session.error instanceof ApiError ? session.error.status : 0;
  if (status === 401) return <Navigate to="/login" replace state={{ returnTo: location.pathname + location.search }} />;
  if (status === 403 || (session.data && session.data.role !== "ADMIN"))
    return <main className="once-admin oa-access"><ShieldAlert size={32} /><h1>403 · 无管理后台访问权限</h1><p>当前账号不是管理员。如权限已更新，请重新检查或登录。</p>
      <Button variant="outline" disabled={session.isFetching} onClick={() => void session.refetch()}>重新检查权限</Button>
      <Button disabled={signingOut} onClick={() => {
        setSigningOut(true);
        void logout({ to: "/login", returnTo: location.pathname + location.search }).finally(() => setSigningOut(false));
      }}>{signingOut ? "正在退出…" : "切换账号 / 重新登录"}</Button>
      <Link to="/app/overview">返回用户工作台</Link></main>;
  if (!session.data) return <main className="once-admin oa-access">{session.isError
    ? <><p>{adminError(session.error)}</p><Button variant="outline" onClick={() => void session.refetch()}>重新检查权限</Button></>
    : <State query={session} columns={3} />}</main>;
  return <AdminLayout session={session.data} />;
}
export default function AdminApp() {
  return <Routes><Route element={<AdminAccess />}>
    <Route index element={<Navigate to="overview" replace />} />
    <Route path="overview" element={<OverviewPage />} />
    <Route path="users" element={<UsersPage />} />
    <Route path="numbers" element={<NumbersPage />} />
    <Route path="plans" element={<PlansPage />} />
    <Route path="points" element={<PointsPage />} />
    <Route path="leases" element={<LeasesPage />} />
    <Route path="orders" element={<OrdersPage />} />
    <Route path="messages" element={<MessagesPage />} />
    <Route path="integrations" element={<IntegrationsPage />} />
    <Route path="webhooks" element={<WebhooksPage />} />
    <Route path="audit" element={<AuditPage />} />
    <Route path="*" element={<Navigate to="overview" replace />} />
  </Route></Routes>;
}
