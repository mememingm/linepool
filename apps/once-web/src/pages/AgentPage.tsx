import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatRechargeAmount, rechargeAmountInput, type PcCapability, type PcPlan, type PcPlanInput, type PcSession } from "@linepool/contracts";
import { useApp } from "../app/AppProvider";
import { AgentWorkspaceShell, agentPages, type AgentSection } from "../components/AgentWorkspaceShell";
import { PublicHeader } from "../components/Shell";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { CopyButton, DataState, Icon } from "../components/ui";
import { request } from "../lib/api";
import { errorMessage, formatDateTime } from "../lib/models";
import { pcAuthError, pcCapability, pcFractionDigits, pcStatus, startPcAuth, type PcMessagePage } from "../lib/pc";
import { AuthLoading, AuthUnavailable } from "./PublicPages";

const supported: PcCapability[] = ["NUMBER_LEASE", "SEND_SMS"];
const date = (value: string | null) => value ? formatDateTime(value) : "尚无记录";
const NUMBER_PAGE_SIZE = 20;

export default function AgentPage() {
  const { account, checking, authError, logout } = useApp();
  const [params] = useSearchParams();
  const auth = useMutation({ mutationFn: () => startPcAuth(account?.authKind === "PINCLODE" ? "REAUTHORIZE" : "AGENT_LOGIN") });
  if (checking) return <AuthLoading />;
  if (authError) return <AuthUnavailable />;
  if (account?.role === "ADMIN" && params.get("view") !== "connection" && !params.has("authError")) return <Navigate to="/admin/overview" replace />;
  if (account?.authKind === "PINCLODE") return <AgentWorkspace key={account.id} owner={account.id} authorizationError={params.get("authError")} />;
  return <div className="app product-ui once-ui"><PublicHeader /><main className="auth-page">
    {params.get("authError") && <p className="agent-alert" role="alert">{pcAuthError(params.get("authError")!)}</p>}
    {!account ? <section className="agent-panel"><h1>使用 PinClode 登录代理工作台</h1><p>请使用已开通 ONCE 应用的 PinClode 账号。授权完成后可查看自己的连接、号码与消息。</p><Button disabled={auth.isPending} onClick={() => auth.mutate()}>{auth.isPending ? "正在打开授权页面…" : "使用 PinClode 登录"}</Button>{auth.isError && <p className="agent-alert" role="alert">{errorMessage(auth.error)}</p>}</section>
      : <section className="agent-panel"><h1>{account.role === "ADMIN" ? "当前登录的是本站管理员" : "当前登录的是站内账户"}</h1><p>代理工作台需要单独的 PinClode 身份。请先退出当前账户，再使用 PinClode 登录。</p><div className="agent-actions"><Button onClick={() => void logout({ to: "/agent" })}>退出并切换身份</Button><Button asChild variant="outline"><Link to={account.role === "ADMIN" ? "/admin/integrations" : "/app/overview"}>{account.role === "ADMIN" ? "查看本站连接" : "进入自营工作台"}</Link></Button></div></section>}
  </main></div>;
}

function AgentWorkspace({ owner, authorizationError }: { owner: string; authorizationError: string | null }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const section = agentPages.find(item => item.id === params.get("section"))?.id ?? (params.get("view") === "connection" ? "connection" : "overview");
  const [numberId, setNumberId] = useState("");
  const [page, setPage] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [waitingUntil, setWaitingUntil] = useState<string | null>(null);
  const [waitError, setWaitError] = useState("");
  const [editing, setEditing] = useState<PcPlan | null | undefined>(undefined);
  const [numberSearch, setNumberSearch] = useState("");
  const [numberSource, setNumberSource] = useState<"all" | "confirmed" | "missing">("all");
  const [numberPage, setNumberPage] = useState(1);
  const key = ["pc", owner];
  const session = useQuery({ queryKey: [...key, "session"], queryFn: ({ signal }) => request<PcSession>("/pc/session", { signal }), refetchInterval: 15_000, refetchIntervalInBackground: false });
  const connection = session.data?.connection;
  const capabilities = supported.filter(item => connection?.capabilities.includes(item));
  const numbers = session.data?.numbers ?? [];
  const selectedNumber = numberId && numbers.some(item => item.id === numberId) ? numberId : "";
  const messages = useQuery({ queryKey: [...key, "messages", selectedNumber, page], queryFn: ({ signal }) => request<PcMessagePage>(`/pc/messages?page=${page}&pageSize=50${selectedNumber ? `&numberId=${encodeURIComponent(selectedNumber)}` : ""}`, { signal }), enabled: Boolean(connection), refetchInterval: waiting ? 5_000 : 15_000, refetchIntervalInBackground: false });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const authorize = useMutation({ mutationFn: () => startPcAuth("REAUTHORIZE") });
  const toggle = useMutation({ mutationFn: (enabledCapabilities: PcCapability[]) => request("/pc/connection", { method: "PATCH", body: { enabledCapabilities } }), onSuccess: refresh });
  const read = useMutation({ mutationFn: (ids: string[]) => request("/pc/messages/read", { method: "POST", body: { ids } }), onSuccess: refresh });
  const archive = useMutation({ mutationFn: (id: string) => request(`/pc/plans/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: refresh });
  const stop = useMutation({ mutationFn: async () => {
    await request("/pc/wait", { method: "POST", body: { numberId: selectedNumber || null, waiting: false } });
    setWaiting(false);
    setWaitingUntil(null);
    setWaitError("");
  }, onError: error => setWaitError(errorMessage(error)) });
  useEffect(() => { setEditing(undefined); }, [section]);
  useEffect(() => {
    if (!waiting) return;
    let active = true;
    const controller = new AbortController();
    const register = async () => {
      try {
        const result = await request<{ waitingUntil: string | null }>("/pc/wait", { method: "POST", body: { numberId: selectedNumber || null, waiting: true }, signal: controller.signal });
        if (active) { setWaitingUntil(result.waitingUntil); setWaitError(""); }
      } catch (error) {
        if (active) { setWaitError(errorMessage(error)); setWaiting(false); setWaitingUntil(null); }
      }
    };
    void register();
    const timer = window.setInterval(() => void register(), 45_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      void request("/pc/wait", { method: "POST", body: { numberId: selectedNumber || null, waiting: false }, keepalive: true }).catch(() => undefined);
    };
  }, [waiting, selectedNumber]);
  function navigate(next: AgentSection) {
    setParams(previous => { const nextParams = new URLSearchParams(previous); nextParams.set("section", next); return nextParams; });
  }
  function showMessages(id = "") { setNumberId(id); setPage(1); navigate("messages"); }
  const error = toggle.error || read.error || archive.error || authorize.error;
  const unread = messages.data?.data.filter(item => !item.isRead).map(item => item.id) ?? [];
  const numberQuery = numberSearch.trim();
  const filteredNumbers = numbers.filter(number => (numberSource === "all" || number.sourceMissing === (numberSource === "missing")) && (!numberQuery || number.phoneNumber.includes(numberQuery)));
  const numberPages = Math.max(1, Math.ceil(filteredNumbers.length / NUMBER_PAGE_SIZE));
  const currentNumberPage = Math.min(numberPage, numberPages);
  const visibleNumbers = filteredNumbers.slice((currentNumberPage - 1) * NUMBER_PAGE_SIZE, currentNumberPage * NUMBER_PAGE_SIZE);
  const recentMessages = !selectedNumber && page === 1 ? messages.data?.data.slice(0, 5) ?? [] : [];
  return <AgentWorkspaceShell section={section} refreshing={session.isFetching || messages.isFetching} onRefresh={() => void refresh()}>
    {authorizationError && <p className="agent-alert" role="alert">{pcAuthError(authorizationError)}</p>}
    {session.isPending ? <div className="agent-loading" role="status" aria-label="正在读取连接"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      : !session.data ? <DataState title="连接暂时无法读取" description={errorMessage(session.error)} retry={() => void session.refetch()} />
      : <>
        {session.isError && <p className="agent-alert" role="alert">刷新失败，当前显示上次读取的数据。{errorMessage(session.error)}</p>}
        {error && <p className="agent-alert" role="alert">{errorMessage(error)}</p>}
        {connection?.problem === "SOURCE_RESOURCE_ISSUE"
          ? <p className="agent-source-note" role="status">部分号码已过期或暂不可用，历史记录已保留。用于收信的号码请以 PC 中的在线状态为准。</p>
          : connection?.problem && <p className="agent-alert" role="alert">{connection.problem}</p>}
        {section === "overview" && <>
          <div className="agent-stats">
            <div className="agent-stat"><Icon name="shield-question" /><div><span>连接状态</span><strong>{connection ? pcStatus[connection.status] : "尚无连接"}</strong></div></div>
            <div className="agent-stat"><Icon name="smartphone" /><div><span>已同步号码</span><strong>{numbers.length}</strong></div></div>
            <div className="agent-stat"><Icon name="message-square-text" /><div><span>收到的消息</span><strong>{messages.data && !selectedNumber ? messages.data.pagination.totalItems : "—"}</strong></div></div>
            <div className="agent-stat"><Icon name="receipt-text" /><div><span>启用套餐</span><strong>{session.data.plans.filter(plan => plan.enabled).length}</strong></div></div>
          </div>
          <div className="agent-overview-grid">
            <section className="agent-panel"><div className="agent-panel-head"><h2>我的号码</h2><Button variant="ghost" size="sm" onClick={() => navigate("numbers")}>查看全部<Icon name="arrow-right" /></Button></div>
              {!numbers.length ? <div className="agent-empty"><Icon name="smartphone" /><h3>尚未同步到号码</h3><p>这里将显示当前 PinClode 账号的号码。同步完成后，可按号码查看收到的短信与验证码。</p><Button variant="outline" onClick={() => navigate("connection")}>查看连接状态</Button></div>
                : <div className="agent-preview-list">{numbers.slice(0, 5).map(number => <div className="agent-preview-number" key={number.id}><div><strong>{number.phoneNumber}</strong><small>{number.regionId} · {number.sourceMissing ? "来源缺失，历史记录保留" : "来源已确认"}</small></div><Button variant="outline" size="sm" onClick={() => showMessages(number.id)}>查看消息</Button></div>)}</div>}
            </section>
            <section className="agent-panel"><div className="agent-panel-head"><h2>我的连接</h2><span className="agent-status" data-status={connection?.status}>{connection ? pcStatus[connection.status] : "尚无连接"}</span></div>
              <dl className="agent-facts"><div><dt>PinClode 账号</dt><dd>{connection?.externalAccountId || "尚无连接"}</dd></div><div><dt>最近同步</dt><dd>{connection ? date(connection.lastSyncedAt) : "尚无记录"}</dd></div><div><dt>启用能力</dt><dd>{connection?.enabledCapabilities.filter(item => supported.includes(item)).map(item => pcCapability[item]).join("、") || "尚未启用"}</dd></div></dl>
              <div className="agent-actions"><Button variant="outline" onClick={() => navigate("connection")}>管理连接</Button><Button variant="ghost" onClick={() => navigate("plans")}>配置套餐<Icon name="arrow-right" /></Button></div>
            </section>
          </div>
          {connection && <section className="agent-panel"><div className="agent-panel-head"><h2>最近收到的消息</h2><Button variant="ghost" size="sm" onClick={() => showMessages()}>查看全部<Icon name="arrow-right" /></Button></div>
            {messages.isPending ? <Skeleton className="h-32 w-full" />
              : messages.isError ? <DataState title="消息暂时无法读取" description={errorMessage(messages.error)} retry={() => void messages.refetch()} />
                : !recentMessages.length ? <div className="agent-empty"><Icon name="message-square-text" /><h3>暂无收到的消息</h3><p>同步完成后，当前账号收到的短信和验证码会显示在这里。</p></div>
                  : <div className="agent-preview-list">{recentMessages.map(message => <div className="agent-preview-number agent-preview-message" key={message.id}><div><strong>{message.phoneNumber}<span>{message.sender}</span></strong><small>{formatDateTime(message.receivedAt)}</small><p>{message.body}</p></div>{message.verificationCode && <div className="agent-message-code"><strong>{message.verificationCode}</strong><CopyButton value={message.verificationCode} aria-label="复制验证码" /></div>}</div>)}</div>}
          </section>}
        </>}
        {section === "connection" && <section className="agent-panel"><div className="agent-panel-head"><div><h2>PinClode 连接</h2><p>管理当前账号的授权和可用能力。</p></div><div className="agent-actions"><span className="agent-status" data-status={connection?.status}>{connection ? pcStatus[connection.status] : "尚无连接"}</span><Button disabled={authorize.isPending} onClick={() => authorize.mutate()}>{authorize.isPending ? "正在打开授权页面…" : "重新登录 PinClode"}</Button></div></div>
          {connection ? <><dl className="agent-facts"><div><dt>账号</dt><dd>{connection.externalAccountId}</dd></div><div><dt>最近同步</dt><dd>{date(connection.lastSyncedAt)}</dd></div><div><dt>下次轮询</dt><dd>{date(connection.nextPollAt)}</dd></div><div><dt>访问授权到期</dt><dd>{date(connection.accessExpiresAt)}</dd></div><div><dt>续期授权到期</dt><dd>{date(connection.refreshExpiresAt)}</dd></div></dl>
            <fieldset className="agent-capabilities" disabled={toggle.isPending}><legend>启用能力</legend>{capabilities.map(item => <div className="agent-capability" key={item}><Checkbox id={`agent-capability-${item}`} checked={connection.enabledCapabilities.includes(item)} onCheckedChange={checked => toggle.mutate(checked === true ? [...connection.enabledCapabilities, item] : connection.enabledCapabilities.filter(value => value !== item))} /><Label htmlFor={`agent-capability-${item}`}>{pcCapability[item]}</Label></div>)}{!capabilities.length && <p>这个连接尚无本站支持的能力。</p>}</fieldset>
          </> : <div className="agent-empty"><Icon name="refresh-cw" /><h3>尚无连接</h3><p>请使用原 PinClode 账号重新完成连接授权。</p></div>}
        </section>}
        {section === "numbers" && <section className="agent-panel"><div className="agent-panel-head"><h2>号码列表</h2><span className="agent-status">共 {numbers.length} 个号码{filteredNumbers.length !== numbers.length && ` · 筛选后 ${filteredNumbers.length} 个`}</span></div>
          {numbers.length > 0 && <div className="agent-message-filter"><Label htmlFor="agent-number-search">号码</Label><Input id="agent-number-search" className="agent-number-search" value={numberSearch} maxLength={64} placeholder="搜索号码，例如 +1" onChange={event => { setNumberSearch(event.target.value); setNumberPage(1); }} /><Label htmlFor="agent-number-source">来源</Label><Select value={numberSource} onValueChange={value => { setNumberSource(value as typeof numberSource); setNumberPage(1); }}><SelectTrigger id="agent-number-source"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem><SelectItem value="confirmed">来源已确认</SelectItem><SelectItem value="missing">来源缺失</SelectItem></SelectContent></Select></div>}
          {numbers.length > 0 && !filteredNumbers.length ? <div className="agent-empty"><Icon name="smartphone" /><h3>没有匹配的号码</h3><p>请调整搜索内容或来源筛选。</p><Button variant="outline" onClick={() => { setNumberSearch(""); setNumberSource("all"); setNumberPage(1); }}>清除筛选</Button></div>
          : !numbers.length ? <div className="agent-empty"><Icon name="smartphone" /><h3>尚未同步到号码</h3><p>完成授权后，由后台同步读取当前账号已有的号码资源。</p><Button variant="outline" onClick={() => navigate("connection")}>查看连接状态</Button></div>
            : <div className="agent-table-scroll"><table className="agent-table"><thead><tr><th>号码</th><th>地区</th><th>上游资源到期</th><th>能力 / 来源</th><th>消息</th></tr></thead><tbody>{visibleNumbers.map(number => <tr key={number.id}><td><strong>{number.phoneNumber}</strong></td><td>{number.regionId}</td><td>{date(number.resourceExpiresAt)}</td><td>{number.capabilities.filter(item => supported.includes(item)).map(item => pcCapability[item]).join("、") || "暂无能力"}<small>{number.sourceMissing ? "来源缺失，历史记录保留" : "来源已确认"}</small></td><td><Button variant="outline" size="sm" onClick={() => showMessages(number.id)}>查看消息</Button></td></tr>)}</tbody></table></div>}
          {filteredNumbers.length > NUMBER_PAGE_SIZE && <div className="agent-pagination"><Button variant="outline" disabled={currentNumberPage <= 1} onClick={() => setNumberPage(currentNumberPage - 1)}>上一页</Button><span>第 {currentNumberPage} / {numberPages} 页 · 共 {filteredNumbers.length} 个</span><Button variant="outline" disabled={currentNumberPage >= numberPages} onClick={() => setNumberPage(currentNumberPage + 1)}>下一页</Button></div>}
        </section>}
        {section === "plans" && <section className="agent-panel"><div className="agent-panel-head"><div><h2>我的套餐</h2><p>套餐价格仅供自己的业务使用。</p></div><Button disabled={!connection || !capabilities.length} onClick={() => setEditing(null)}><Icon name="plus" />添加套餐</Button></div>
          {!session.data.plans.length ? <div className="agent-empty"><Icon name="receipt-text" /><h3>尚未配置套餐</h3><p>可以按已开通的能力设置套餐时长、价格和启用状态。</p></div>
            : <div className="agent-table-scroll"><table className="agent-table"><thead><tr><th>名称</th><th>时长</th><th>价格</th><th>能力</th><th>状态</th><th>操作</th></tr></thead><tbody>{session.data.plans.map(plan => <tr key={plan.id}><td>{plan.name}</td><td>{plan.durationDays} 天</td><td>{formatRechargeAmount(plan.amountMinor, { currency: plan.currency, fractionDigits: pcFractionDigits(plan.currency) }, "zh-CN")}</td><td>{pcCapability[plan.capability]}</td><td>{plan.enabled ? "启用" : "停用"}</td><td><div className="agent-actions"><Button variant="outline" size="sm" onClick={() => setEditing(plan)}>编辑</Button><Button variant="outline" size="sm" disabled={archive.isPending || !plan.enabled} onClick={() => archive.mutate(plan.id)}>停用</Button></div></td></tr>)}</tbody></table></div>}
        </section>}
        {section === "messages" && <section className="agent-panel"><div className="agent-panel-head"><h2>消息列表</h2><Button variant="outline" disabled={!unread.length || read.isPending} onClick={() => read.mutate(unread)}>本页标为已读</Button></div>
          <div className="agent-message-filter"><Label htmlFor="agent-message-number">号码</Label><Select value={selectedNumber || "all"} onValueChange={value => { setNumberId(value === "all" ? "" : value); setPage(1); }}><SelectTrigger id="agent-message-number"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部号码</SelectItem>{numbers.map(number => <SelectItem key={number.id} value={number.id}>{number.phoneNumber}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={!connection || stop.isPending} onClick={() => waiting ? stop.mutate() : setWaiting(true)}>{waiting ? "停止等待" : "等待取码"}</Button><span role="status">{waiting ? waitingUntil ? `等待中，有效至 ${date(waitingUntil)}` : "正在登记等待…" : "按常规频率读取"}</span></div>
          {waitError && <p className="agent-alert" role="alert">{waitError}</p>}
          {!connection ? <div className="agent-empty"><Icon name="message-square-text" /><h3>尚无连接</h3><p>完成连接授权后可查看自己的消息。</p></div>
            : messages.isPending ? <Skeleton className="h-48 w-full" />
              : messages.isError ? <DataState title="消息暂时无法读取" description={errorMessage(messages.error)} retry={() => void messages.refetch()} />
                : !messages.data?.data.length ? <div className="agent-empty"><Icon name="message-square-text" /><h3>暂无收到的消息</h3><p>同步完成后，当前账号收到的短信和验证码会显示在这里。</p></div>
                  : <div className="agent-table-scroll"><table className="agent-table"><thead><tr><th>时间 / 号码</th><th>发送方</th><th>内容</th><th>验证码</th><th>已读</th></tr></thead><tbody>{messages.data.data.map(message => <tr key={message.id}><td>{formatDateTime(message.receivedAt)}<small>{message.phoneNumber}</small></td><td>{message.sender}</td><td className="agent-message-body">{message.body}</td><td>{message.verificationCode ? <div className="agent-message-code"><strong>{message.verificationCode}</strong><CopyButton value={message.verificationCode} aria-label="复制验证码" /></div> : "无"}</td><td>{message.isRead ? "已读" : <Button variant="outline" size="sm" disabled={read.isPending} onClick={() => read.mutate([message.id])}>标为已读</Button>}</td></tr>)}</tbody></table></div>}
          {messages.data && <div className="agent-pagination"><Button variant="outline" disabled={page <= 1 || messages.isFetching} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} 页 · 共 {messages.data.pagination.totalItems} 条</span><Button variant="outline" disabled={page >= messages.data.pagination.totalPages || messages.isFetching} onClick={() => setPage(value => value + 1)}>下一页</Button></div>}
        </section>}
        {section === "plans" && editing !== undefined && <PlanEditor key={editing?.id ?? "new"} plan={editing} capabilities={capabilities} owner={owner} close={() => setEditing(undefined)} />}
      </>}
  </AgentWorkspaceShell>;
}

function PlanEditor({ plan, capabilities, owner, close }: { plan: PcPlan | null; capabilities: PcCapability[]; owner: string; close: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(plan?.name ?? "");
  const [days, setDays] = useState(String(plan?.durationDays ?? 30));
  const [amount, setAmount] = useState(rechargeAmountInput(plan?.amountMinor ?? 0, pcFractionDigits(plan?.currency ?? "USD")));
  const [currency, setCurrency] = useState(plan?.currency ?? "USD");
  const [capability, setCapability] = useState<PcCapability>(plan?.capability ?? capabilities[0] ?? "NUMBER_LEASE");
  const [enabled, setEnabled] = useState(plan?.enabled ?? true);
  const save = useMutation({ mutationFn: async () => {
    if (!name.trim() || !/^\d+(\.\d+)?$/.test(amount) || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 3650 || !/^[A-Z]{3}$/.test(currency)) throw new Error("请填写有效的名称、天数、价格及三位币种代码。");
    const [whole, fraction = ""] = amount.split(".");
    const digits = pcFractionDigits(currency);
    if (fraction.length > digits) throw new Error(`该币种最多支持 ${digits} 位小数。`);
    const minor = BigInt(whole!) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("价格超出可配置范围。");
    const body: PcPlanInput = { name: name.trim(), durationDays: Number(days), amountMinor: Number(minor), currency, capability, enabled };
    await request(`/pc/plans${plan ? `/${encodeURIComponent(plan.id)}` : ""}`, { method: plan ? "PATCH" : "POST", body });
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ["pc", owner] }); close(); } });
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending) save.mutate(); }
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) close(); }}><DialogContent className="agent-plan-dialog">
    <DialogHeader><DialogTitle>{plan ? "编辑套餐" : "添加套餐"}</DialogTitle><DialogDescription>套餐价格仅供自己的业务使用。</DialogDescription></DialogHeader>
    <form className="agent-plan-form" onSubmit={submit}><fieldset disabled={save.isPending}>
      <div className="agent-form-field"><Label htmlFor="agent-plan-name">名称</Label><Input id="agent-plan-name" value={name} maxLength={120} required onChange={event => setName(event.target.value)} /></div>
      <div className="agent-form-row"><div className="agent-form-field"><Label htmlFor="agent-plan-days">天数</Label><Input id="agent-plan-days" type="number" min={1} max={3650} step={1} value={days} required onChange={event => setDays(event.target.value)} /></div><div className="agent-form-field"><Label htmlFor="agent-plan-capability">能力</Label><Select value={capability} onValueChange={value => setCapability(value as PcCapability)}><SelectTrigger id="agent-plan-capability"><SelectValue /></SelectTrigger><SelectContent>{Array.from(new Set([...capabilities, ...(plan ? [plan.capability] : [])])).map(item => <SelectItem key={item} value={item}>{pcCapability[item]}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="agent-form-row"><div className="agent-form-field"><Label htmlFor="agent-plan-amount">价格</Label><Input id="agent-plan-amount" inputMode="decimal" value={amount} required onChange={event => setAmount(event.target.value)} /></div><div className="agent-form-field"><Label htmlFor="agent-plan-currency">币种</Label><Input id="agent-plan-currency" value={currency} maxLength={3} pattern="[A-Z]{3}" required onChange={event => setCurrency(event.target.value.toUpperCase())} /></div></div>
      <div className="agent-form-checkbox"><Checkbox id="agent-plan-enabled" checked={enabled} onCheckedChange={value => setEnabled(value === true)} /><Label htmlFor="agent-plan-enabled">启用套餐</Label></div>
      {save.isError && <p className="agent-alert" role="alert">{errorMessage(save.error)}</p>}
      <div className="agent-actions"><Button type="button" variant="outline" onClick={close}>取消</Button><Button type="submit">{save.isPending ? "保存中…" : "保存套餐"}</Button></div>
    </fieldset></form>
  </DialogContent></Dialog>;
}
