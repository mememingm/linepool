import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/ui/field";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useApp } from "../app/AppProvider";
import { useWorkspace } from "../app/WorkspaceProvider";
import { useUIStore } from "../stores/ui-store";
import {
  formatDate,
  formatMoney,
  leasePath,
  localDemo,
  errorMessage,
  type Order,
} from "../lib/models";
import {
  CommunicationNav,
  CopyButton,
  Heading,
  Icon,
  RENT_PATH,
} from "../components/ui";
import { PasswordSettings } from "../components/PasswordSettings";
import { AccountProfile } from "../components/AccountProfile";
import { formatPoints } from "../lib/points";
export { SubscriptionPage } from "./SubscriptionPage";
export function BillingPage() {
  const { data, busy, reconcile } = useWorkspace();
  const { account } = useApp();
  const [params] = useSearchParams();
  const scope = params.get("leaseId");
  const lease = data!.leases.find((item) => item.id === scope);
  const history = useInfiniteQuery({ queryKey: ["once-orders", account!.id, scope], initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => request<{ items: Order[]; nextCursor: string | null }>(`/orders/history?limit=50${scope ? `&leaseId=${encodeURIComponent(scope)}` : ""}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { signal }),
    getNextPageParam: value => value.nextCursor,
    refetchInterval: query => query.state.data?.pages.some(page => page.items.some(order => ["PENDING", "PROCESSING", "UNCERTAIN"].includes(order.status))) ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const bills = Array.from(new Map(history.data?.pages.flatMap(page => page.items).map(bill => [bill.id, bill]) ?? []).values());
  const recordsViewport = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(6);
  const [pagination, setPagination] = useState({ scope, index: 0 });
  const pageCount = Math.max(1, Math.ceil(bills.length / pageSize));
  const pageIndex = pagination.scope === scope ? Math.min(pagination.index, pageCount - 1) : 0;
  const pageStart = pageIndex * pageSize;
  useLayoutEffect(() => {
    const node = recordsViewport.current;
    if (!node) return;
    const resize = () => {
      const desktop = window.matchMedia("(min-width:768px) and (min-height:680px)").matches;
      const headerHeight = node.querySelector("thead")?.getBoundingClientRect().height || 40;
      const rowHeight = Math.max(72, ...Array.from(node.querySelectorAll("tbody tr"), row => row.getBoundingClientRect().height));
      // Use rendered row sizes so fonts and status controls cannot push the pager off screen.
      setPageSize(desktop ? Math.max(1, Math.min(12, Math.floor((node.clientHeight - headerHeight - 2) / rowHeight))) : 5);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <main className="content billing-content">
      <Heading title="订单与账单" />
      <div className="billing-toolbar">
        <strong>{lease?.number || "全部号码"}</strong>
        {scope && (
          <Button asChild variant="outline"><Link className="secondary-btn" to="/app/billing">
            查看全部订单
          </Link></Button>
        )}
        <span>
          {scope
            ? `${bills.length} 笔已载入记录`
            : `${data!.billsCount} 笔账户订单`}
        </span>
      </div>
      <div className="billing-records" ref={recordsViewport}>
      {history.isPending && <p role="status">正在读取订单…</p>}
      {history.isError && <p role="alert">{errorMessage(history.error)} <Button variant="outline" onClick={() => void history.refetch()}>重新读取</Button></p>}
      {bills.length ? (
        <div className="billing-surface"><Table aria-label="订单与账单">
          <TableHeader><TableRow><TableHead>订单与租期</TableHead><TableHead>关联号码</TableHead><TableHead>时间 / 金额</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
          <TableBody>{bills.slice(pageStart, pageStart + pageSize).map(bill => {
            const billAmount = bill.settlementType === "POINTS" ? formatPoints(bill.points ?? 0) : bill.settlementType === "COMPENSATION" ? "免费补偿" : formatMoney(bill.amount, bill.currency);
            const funds = ({ RESERVED: "积分已冻结", CAPTURED: "积分已扣除", RELEASED: "积分已解冻", PARTIALLY_REFUNDED: "积分已部分退回", REFUNDED: "积分已全部退回" } as Record<string, string>)[bill.fundsStatus ?? ""];
            const label = bill.status === "演示已确认" ? "已确认" : ({COMPLETED:"已完成",PENDING:"待交付",PROCESSING:"处理中",UNCERTAIN:"结果待核对",FAILED:"交付失败"} as Record<string,string>)[bill.status] || bill.status;
            return <TableRow key={bill.id}>
              <TableCell><Sheet><SheetTrigger asChild><Button variant="link" className="order-link" aria-label={`查看订单 ${bill.id}`}><strong>{bill.kind} · {bill.term} 天</strong></Button></SheetTrigger>
                <SheetContent className="order-sheet"><SheetHeader><SheetTitle>订单详情</SheetTitle><SheetDescription>{bill.kind} · {label}</SheetDescription></SheetHeader>
                  <dl><div><dt>订单编号</dt><dd className="order-id-full">{bill.id}<CopyButton value={bill.id} className="icon-btn" aria-label="复制订单编号" title="复制订单编号" /></dd></div><div><dt>关联号码</dt><dd>{bill.leaseId ? <Button asChild variant="link"><Link to={leasePath("numbers",bill.leaseId)}>{bill.number}</Link></Button> : bill.number || "暂未分配"}</dd></div><div><dt>租期</dt><dd>{bill.term} 天</dd></div><div><dt>创建日期</dt><dd>{formatDate(bill.createdAt)}</dd></div><div><dt>消费</dt><dd>{billAmount}</dd></div><div><dt>状态</dt><dd><Badge variant="outline">{label}</Badge></dd></div></dl>
                </SheetContent></Sheet><span className="order-id"><small title={bill.id}>订单号 {bill.id.slice(0, 8).toUpperCase()}</small><CopyButton value={bill.id} className="icon-btn order-id-copy" aria-label={`复制订单号 ${bill.id}`} title="复制完整订单号" /></span></TableCell>
              <TableCell>{bill.leaseId ? <Button asChild variant="link"><Link to={leasePath("numbers",bill.leaseId)}>{bill.number}</Link></Button> : bill.number || "暂未分配"}</TableCell>
              <TableCell><strong>{billAmount}</strong><small>{formatDate(bill.createdAt)}</small></TableCell>
              <TableCell><Badge variant="outline" className={`bill-status-badge ${bill.status === "FAILED" ? "danger" : ""}`}>{label}</Badge>{funds && <small>{funds}</small>}
                {["PENDING","PROCESSING","UNCERTAIN"].includes(bill.status) && <Button variant="link" className="link-btn" disabled={busy} onClick={() => {void reconcile(bill.id);}}>核对交付</Button>}
              </TableCell>
            </TableRow>;
          })}</TableBody>
        </Table></div>
      ) : !history.isPending && !history.isError && (
        <Empty className="empty-state compact"><h2>暂无订单记录</h2><p>租用号码后，可在这里查看订购与续费记录。</p><Button asChild><Link to={RENT_PATH}>去租用号码</Link></Button></Empty>
      )}
      </div>
      {bills.length > 0 && <nav className="billing-pagination" aria-label="订单分页">
        <span role="status" aria-live="polite">第 {bills.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, bills.length)} 条，共 {bills.length} 条已载入订单</span>
        <div>
          <Button variant="outline" size="sm" aria-label="上一页订单" disabled={pageIndex === 0} onClick={() => setPagination({ scope, index: pageIndex - 1 })}><ChevronLeft aria-hidden="true" />上一页</Button>
          <span aria-label={`第 ${pageIndex + 1} 页，共 ${pageCount} 页`}>{pageIndex + 1} / {pageCount}</span>
          <Button variant="outline" size="sm" aria-label="下一页订单" disabled={history.isFetchingNextPage || (pageIndex >= pageCount - 1 && !history.hasNextPage)} onClick={() => { void (async () => { if (pageIndex >= pageCount - 1 && history.hasNextPage) await history.fetchNextPage(); setPagination({ scope, index: pageIndex + 1 }); })(); }}>{history.isFetchingNextPage ? "读取中…" : "下一页"}<ChevronRight aria-hidden="true" /></Button>
        </div>
      </nav>}
      {history.hasNextPage && <p className="card-muted">继续翻页可读取更早的订单。</p>}
    </main>
  );
}
export function SettingsPage() {
  const { logout } = useApp();
  const [loggingOut, setLoggingOut] = useState(false);
  const theme = useUIStore((state) => state.theme);
  const toggleTheme = useUIStore((state) => state.toggleTheme);
  const { setScenesOpen } = useWorkspace();
  return (
    <main className="content settings-content">
      <Heading title="账户设置" />
      <AccountProfile />
      <section className="settings-section">
        <h2>显示偏好</h2>
        <Button variant="outline" className="secondary-btn" onClick={toggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
          {theme === "dark" ? "切换浅色" : "切换深色"}
        </Button>
      </section>
      <section className="settings-section">
        <h2>账户安全</h2>
        <PasswordSettings />
      </section>
      <section className="settings-section">
        <h2>账户操作</h2>
        <Button variant="outline" disabled={loggingOut} onClick={() => { setLoggingOut(true); void logout().finally(() => setLoggingOut(false)); }}>{loggingOut ? "正在退出…" : "退出账户"}</Button>
      </section>
      {localDemo() && (
        <section className="settings-section">
          <h2>场景设置</h2>
          <Button variant="outline" className="secondary-btn" onClick={() => setScenesOpen(true)}>
            切换或重置场景
          </Button>
        </section>
      )}
    </main>
  );
}
export function VoicePage() {
  const { data } = useWorkspace();
  const lease = data?.lease;
  const keys = [
    ["1", ""],
    ["2", "ABC"],
    ["3", "DEF"],
    ["4", "GHI"],
    ["5", "JKL"],
    ["6", "MNO"],
    ["7", "PQRS"],
    ["8", "TUV"],
    ["9", "WXYZ"],
    ["*", ""],
    ["0", "+"],
    ["#", ""],
  ];
  return (
    <main className="content voice-content">
      <header className="voice-heading">
        <h1>语音通话</h1>
        <Badge variant="outline">功能开发中</Badge>
      </header>
      <CommunicationNav value="voice" leaseId={lease?.id} />
      <div className="voice-layout">
        <section
          className="voice-preview"
          aria-labelledby="voice-preview-title"
        >
          <div className="voice-preview-top">
            <span>
              <Icon name="phone" />
              拨号盘
            </span>
            <span>未开放</span>
          </div>
          <h2 id="voice-preview-title" className="visually-hidden">
            不可交互的语音拨号盘
          </h2>
          <div className="voice-source">
            {lease?.number || "尚未选择号码"}
          </div>
          <div className="voice-number-placeholder">输入电话号码</div>
          <div className="voice-dialpad" aria-hidden="true">
            {keys.map(([key, letters]) => (
              <span key={key}>
                <strong>{key}</strong>
                <small>{letters || "\u00a0"}</small>
              </span>
            ))}
          </div>
          <Button variant="ghost"
            className="voice-call-button"
            disabled
            aria-label="语音通话未开放，无法拨打"
          >
            <Icon name="phone" />
          </Button>
        </section>
        <section
          className="voice-roadmap"
          aria-labelledby="voice-roadmap-title"
        >
          <h2 id="voice-roadmap-title">语音功能</h2>
          <div className="voice-features">
            {[
              ["phone", "拨打与接听"],
              ["receipt-text", "通话记录"],
              ["message-square-text", "语音信箱"],
            ].map(([symbol, title]) => (
              <article key={title}>
                <span className="overview-feature-icon">
                  <Icon name={symbol} />
                </span>
                <div>
                  <h3>{title}</h3>
                </div>
                <span className="voice-feature-state">尚未开放</span>
              </article>
            ))}
          </div>
          <div className="voice-availability">
            <span className="overview-feature-icon">
              <Icon name="clock-3" />
            </span>
            <div>
              <h3>敬请期待</h3>
              <Button asChild variant="link"><Link className="link-btn" to={leasePath("inbox", lease?.id)}>
                先查看接收的短信
                <Icon name="arrow-right" />
              </Link></Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
