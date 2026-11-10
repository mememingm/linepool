import { Button } from "@/components/ui/button";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Copy, Plus, RefreshCw, Smartphone, MessageSquareText, Phone, ReceiptText, ShieldQuestion, CircleHelp, Clock3, Image, Moon, Sun, TriangleAlert, Search, MapPin, type LucideIcon } from "lucide-react";
import { Badge } from "./ui/badge";
import { Empty } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { Combobox } from "./ui/combobox";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { motion, useReducedMotion } from "motion/react";
import { useApp } from "../app/AppProvider";
import { useWorkspace } from "../app/WorkspaceProvider";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  leaseModel,
  leasePath,
  sortedLeases,
  type Lease,
  type Message,
  type Order,
} from "../lib/models";
import { usePlans } from "../lib/queries";
const icons: Record<string, LucideIcon> = { "arrow-right": ArrowRight, copy: Copy, plus: Plus, "refresh-cw": RefreshCw, smartphone: Smartphone, "message-square-text": MessageSquareText, phone: Phone, "receipt-text": ReceiptText, "shield-question": ShieldQuestion, "circle-help": CircleHelp, i: CircleHelp, "clock-3": Clock3, image: Image, moon: Moon, sun: Sun, "triangle-alert": TriangleAlert, search: Search, "map-pin": MapPin };
export function Icon({ name }: { name: string }) {
  const Symbol = icons[name] || CircleHelp;
  return <Symbol className="ui-icon" size={18} strokeWidth={1.75} aria-hidden="true" />;
}
export function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link className="brand" to={to}>
      <span className="brand-mark">O</span>
      <span>ONCE</span>
    </Link>
  );
}
/** Signed-in rentals stay inside the workspace shell; /numbers/new remains the public entry. */
export const RENT_PATH = "/app/new";
export function RentNumberAction() {
  return <Button asChild variant="default"><Link className="primary-btn" to={RENT_PATH}><Icon name="plus" />租用新号码</Link></Button>;
}
export function Heading({
  title,
  action = false,
}: {
  title: string;
  action?: boolean;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
      </div>
      {action && <RentNumberAction />}
    </div>
  );
}
export function LeaseBadge({ lease }: { lease: Lease }) {
  const model = leaseModel(lease);
  return <Badge variant="outline" className={`status-tag ${model.status}`}>{model.label}</Badge>;
}
export function EmptyNumbers() {
  const terms = usePlans();
  const cheapest = terms.length ? Math.min(...terms.map(term => term.pointsPrice)) : null;
  return (
    <Empty className="empty-state asset-empty">
      <div className="empty-mark">
        <Icon name="smartphone" />
      </div>
      <h2>还没有号码</h2>
      <p className="empty-lede">租一个独享号码，用来接收短信与验证码。{terms.map(term => `${term.days} 天 ${(term.pointsPrice ?? Math.round(term.price * 100)).toLocaleString("zh-CN")} 积分`).join(" · ")}，到期不自动续费。</p>
      <ol className="empty-steps" aria-label="租用步骤">
        {[
          ["map-pin", "选择地区", "按州或区号挑选"],
          ["clock-3", "选择租期", cheapest === null ? "以当前上架套餐为准" : `${terms.map(term => term.days).join(" / ")} 天，最低 ${cheapest.toLocaleString("zh-CN")} 积分`],
          ["message-square-text", "接收短信", "在短信页查看与复制验证码"],
        ].map(([symbol, title, text], index) => (
          <li key={title}>
            <span className="empty-step-icon"><Icon name={symbol} /></span>
            <span><b>{index + 1}. {title}</b><small>{text}</small></span>
          </li>
        ))}
      </ol>
      <Button asChild variant="default"><Link className="primary-btn" to={RENT_PATH}>
        <Icon name="plus" />
        租用第一个号码
      </Link></Button>
    </Empty>
  );
}
export function DataState({
  title,
  description,
  retry,
}: {
  title: string;
  description: string;
  retry?: () => void;
}) {
  return (
    <div className="data-state">
      <div className="data-state-mark">
        <Icon name="refresh-cw" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {retry && (
        <Button variant="outline" className="secondary-btn" onClick={retry}>
          <Icon name="refresh-cw" />
          重试
        </Button>
      )}
    </div>
  );
}
export function WorkspaceBoundary({ children }: { children: ReactNode }) {
  const { data, error, refresh } = useWorkspace();
  if (!data)
    return (
      <main className="content">
        {error ? (
          <DataState
            title="暂时无法读取数据"
            description={error}
            retry={() => {
              void refresh();
            }}
          />
        ) : (
          <>
            <Skeleton className="skeleton skeleton-title" />
            <Skeleton
              className="skeleton skeleton-panel"
              role="status"
              aria-label="正在加载账户数据"
            />
          </>
        )}
      </main>
    );
  return <>{children}</>;
}
export function SelectionGuard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { switching, error, requestedId, data, refresh } = useWorkspace();
  const reduce = useReducedMotion();
  return (
    <div
      className={`react-selection ${className}`}
      aria-busy={switching}
      style={{ position: "relative", minWidth: 0 }}
    >
      <motion.div
        inert={switching}
        animate={{ opacity: switching ? 0.3 : 1 }}
        transition={{ duration: reduce ? 0 : 0.16 }}
      >
        {children}
      </motion.div>
      {switching && (
        <section className="context-state" role={error ? "alert" : "status"}>
          <span className="context-number">
            {data?.leases.find((lease) => lease.id === requestedId)?.number ||
              "所选号码"}
          </span>
          <h2>{error ? "号码详情读取失败" : "正在读取号码详情"}</h2>
          <p>{error || "正在同步该号码的租期和消息…"}</p>
          {error ? (
            <Button variant="outline"
              className="secondary-btn"
              onClick={() => {
                void refresh();
              }}
            >
              重新读取
            </Button>
          ) : (
            <div className="context-skeleton" aria-hidden="true">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
export function CopyButton({
  value,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const { notify } = useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement("textarea");
        input.value = value;
        input.readOnly = true;
        input.style.cssText = "position:fixed;opacity:0";
        document.body.append(input);
        input.select();
        try {
          if (!document.execCommand("copy")) throw new Error("Copy failed");
        } finally {
          input.remove();
        }
      }
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 380);
      notify("已复制选中内容。");
    } catch {
      setCopied(false);
      notify("浏览器未允许复制，请手动选择。", "error");
    }
  };
  return (
    <Button variant="ghost"
      {...props}
      data-action="copy"
      className={`${props.className || "icon-btn"}${copied ? " copy-confirmed" : ""}`}
      aria-label={copied ? "已复制" : props["aria-label"]}
      onClick={() => {
        void copy();
      }}
    >
      <Icon name="copy" />
      {children}
    </Button>
  );
}
export function LeaseSwitcher() {
  const { data, selectLease, busy, requestedId } = useWorkspace();
  if (!data?.lease) return null;
  if (data.leases.length <= 1) return <strong>{data.lease.number}</strong>;
  return <Combobox label="号码" value={requestedId || data.lease.id} disabled={busy}
    onValueChange={selectLease} options={sortedLeases(data.leases).map(lease => ({
      value: lease.id, label: lease.number, description: `${lease.countryName} · ${lease.regionName} · ${leaseModel(lease).label}`,
    }))} />;
}
export function FilterTabs({ value, onValueChange, options, label, className = "" }: {
  value: string; onValueChange: (value: string) => void; options: { value: string; label: ReactNode }[]; label: string; className?: string;
}) {
  return <Tabs value={value} onValueChange={onValueChange} className={className}>
    <TabsList aria-label={label}>{options.map(option => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}</TabsList>
  </Tabs>;
}
export function LeaseCountdown({ lease }: { lease: Lease }) {
  const model = leaseModel(lease),
    remaining = model.progress === null ? null : 100 - model.progress,
    reduce = useReducedMotion();
  return (
    <div className="overview-countdown">
      <div
        className={`overview-ring ${model.status}`}
        data-lease-ring={lease.id}
        data-ring-value={remaining ?? undefined}
      >
        {remaining !== null && (
          <svg viewBox="0 0 180 180" aria-hidden="true">
            <circle className="ring-track" cx="90" cy="90" r="78" />
            {remaining > 0 && (
              <motion.circle
                className="ring-value"
                cx="90"
                cy="90"
                r="78"
                pathLength="100"
                initial={false}
                animate={{ strokeDasharray: `${remaining} 100` }}
                transition={{ duration: reduce ? 0 : 0.45 }}
              />
            )}
          </svg>
        )}
        <div>
          <span>剩余租期</span>
          <strong>{model.remaining ?? "未知"}</strong>
          <small>
            {model.remaining === null
              ? "租期待确认"
              : model.status === "expired"
                ? "已到期"
                : "天"}
          </small>
        </div>
      </div>
      <p>
        到期日期{" "}
        <time dateTime={lease.expiresAt}>{formatDate(lease.expiresAt)}</time>
      </p>
    </div>
  );
}
/** Account totals from the loaded workspace; carrier usage meters wait for the upstream API. */
export function AccountStats({ leases, messageCount, unread, billsCount }: { leases: Lease[]; messageCount: number; unread: number; billsCount: number }) {
  const active = leases.filter(lease => ["active", "warning"].includes(leaseModel(lease).status)).length;
  const next = leases.map(lease => leaseModel(lease)).filter(model => model.remaining !== null && model.status !== "expired").sort((a, b) => a.remaining! - b.remaining!)[0];
  const stats: [string, string, ReactNode, string?][] = [
    ["smartphone", "有效号码", <>{active}<small> / {leases.length}</small></>, "/app/numbers"],
    ["message-square-text", "当前号码短信", <>{messageCount}{unread > 0 && <small className="stat-unread"> · {unread} 未读</small>}</>, "/app/messages"],
    ["clock-3", "最近到期", next ? <>{next.remaining}<small> 天后</small></> : "—", "/app/subscription"],
    ["receipt-text", "订单记录", <>{billsCount}<small> 笔</small></>, "/app/billing"],
  ];
  return (
    <section className="overview-stats" aria-label="账户概况">
      {stats.map(([symbol, label, value, to]) => (
        <Link key={label} className="overview-stat" to={to!}>
          <span className="overview-feature-icon"><Icon name={symbol} /></span>
          <span><small>{label}</small><strong>{value}</strong></span>
        </Link>
      ))}
    </section>
  );
}
export function MessageRow({ message }: { message: Message }) {
  const { selectedId } = useWorkspace();
  return (
    <Link
      className="message-card"
      to={leasePath("inbox", message.leaseId || selectedId, {
        messageId: message.id,
      })}
    >
      <div className="message-card-main">
        <div className="message-card-meta">
          <span>{message.sender}</span>
          <time>{formatDateTime(message.receivedAt)}</time>
          {message.isRead === false && <b className="unread-label">未读</b>}
        </div>
        <strong>{message.title}</strong>
        <p>{message.body}</p>
      </div>
      <Icon name="arrow-right" />
    </Link>
  );
}
export function OrderSummary({ order }: { order: Order }) {
  return (
    <Link className="order-summary" to={leasePath("billing", order.leaseId)}>
      <span>
        <strong>
          {order.kind} · {order.term} 天
        </strong>
        <small>
          {order.number} · {formatDate(order.createdAt)}
        </small>
      </span>
      <span>
        {order.settlementType === "POINTS" ? `${(order.points ?? 0).toLocaleString("zh-CN")} 积分` : order.settlementType === "COMPENSATION" ? "免费补偿" : formatMoney(order.amount, order.currency)}
        <small>
          {order.status === "COMPLETED" ? "已完成" : order.status === "演示已确认" ? "已确认" : order.status}
        </small>
      </span>
    </Link>
  );
}
export function CommunicationNav({ value, leaseId }: { value: "inbox" | "sms" | "mms" | "voice"; leaseId?: string }) {
  const navigate = useNavigate();
  return <FilterTabs className="communication-nav" label="通信功能" value={value === "inbox" ? "sms" : value} onValueChange={next => navigate(leasePath(next === "sms" ? "messages" : next === "mms" ? "send" : next, leaseId, next === "mms" ? { compose: "mms" } : undefined))} options={[{value: "sms", label: "短信"}, {value: "mms", label: "彩信"}, {value: "voice", label: "语音"}]} />;
}
export function Footer() {
  return (
    <footer className="section ux-footer">
      <div className="container">
        <span>ONCE</span>
        <span>彩信与语音暂未开放。</span>
      </div>
    </footer>
  );
}
