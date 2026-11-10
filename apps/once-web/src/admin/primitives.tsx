import { useState, type ReactNode } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, MoreHorizontal, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table as DataTable, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { adminError } from "./api";
import type { Page } from "./types";

export const statusLabels: Record<string, string> = {
  ACTIVE: "正常", NOT_CONNECTED: "未接入", DISABLED: "已禁用", USER: "普通用户", ADMIN: "管理员",
  AVAILABLE: "可售", OCCUPIED: "已占用", HELD: "已暂停", UNAVAILABLE: "当前不可用", RESERVED: "已预占",
  EXPIRED_HELD: "已到期保留", ENDED: "已结束", EXPIRING: "即将到期",
  RENT: "号码租赁", RENEW: "同号续费", ADMIN_ASSIGN: "管理员开通", ADMIN_EXTEND: "管理员延期",
  DEMO_CONFIRMED: "演示已确认", COMPLETED: "已完成", PENDING: "待处理", PROCESSING: "处理中", UNCERTAIN: "结果待核对", UNKNOWN: "结果未知", FAILED: "失败", IMPORTED: "已入库", IGNORED: "已忽略", CONNECTION_IMPORTED: "代理消息已入库", RELEASED: "已释放",
  INBOUND: "收到", OUTBOUND: "发出",
  SUBMITTING: "提交中", QUEUED: "排队中", SENDING: "发送中", SENT: "已发送", DELIVERED: "已送达", UNDELIVERABLE: "无法送达",
  RECEIVED: "待处理", UNMATCHED: "未匹配", PROCESSED: "已处理", QUARANTINED: "已隔离",
  demo: "演示", pingcode: "PingCode",
  PLAN_ON: "上架中", PLAN_OFF: "已下架", SEED: "演示库存", SYNC: "上游同步",
};
const tones: Record<string, string> = {
  ACTIVE: "success", AVAILABLE: "success", PLAN_ON: "success", COMPLETED: "success", DEMO_CONFIRMED: "success", DELIVERED: "success", PROCESSED: "success",
  DISABLED: "danger", FAILED: "danger", UNDELIVERABLE: "danger", QUARANTINED: "danger",
  OCCUPIED: "info", PROCESSING: "info", SENDING: "info", SENT: "info", QUEUED: "info", SUBMITTING: "info", ADMIN: "info", pingcode: "info",
  UNMATCHED: "warning", HELD: "warning", EXPIRED_HELD: "warning", UNCERTAIN: "warning", PENDING: "warning", RECEIVED: "warning", EXPIRING: "warning",
};
export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className="oa-status" data-tone={tones[value] ?? "neutral"}>{label ?? statusLabels[value] ?? value}</span>;
}
const dateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
export function DateText({ value }: { value: string | null | undefined }) {
  return value ? <time dateTime={value}>{dateFormat.format(new Date(value))}</time> : <>—</>;
}
export function money(minor: number | null, currency: string | null = "USD") {
  return minor === null || !currency ? "未提供" : new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(minor / 100);
}
export function daysLeft(value: string) {
  const days = Math.ceil((Date.parse(value) - Date.now()) / 86400000);
  return days > 0 ? `剩 ${days} 天` : days === 0 ? "今天到期" : `已过期 ${-days} 天`;
}
export function Hint({ label, children, side = "top" }: { label: string; children: ReactNode; side?: "top" | "right" | "bottom" }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent side={side} sideOffset={6}>{label}</TooltipContent></Tooltip>;
}
/** Long UUIDs are shortened in tables; the full value stays in the tooltip. */
export function ShortId({ value }: { value: string }) {
  return <Hint label={value}><span tabIndex={0} className="oa-mono oa-short-id">{value.slice(0, 8)}</span></Hint>;
}
export function IconAction({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <Hint label={label}><Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled}>{children}</Button></Hint>;
}
export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };
export function RowMenu({ items }: { items: RowMenuItem[] }) {
  if (!items.length) return null;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="更多操作"><MoreHorizontal /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="oa-menu">{items.map(item =>
      <DropdownMenuItem key={item.label} disabled={item.disabled} variant={item.danger ? "destructive" : "default"} onSelect={item.onSelect}>{item.label}</DropdownMenuItem>)}
    </DropdownMenuContent></DropdownMenu>;
}
/** Rows open their detail on click unless the click came from a control inside the row. */
export const rowClick = (open: () => void) => (event: React.MouseEvent) => {
  if (!(event.target as HTMLElement).closest("button, a, [role='menuitem']")) open();
};
export function Table({ columns, label, children }: { columns: ReactNode[]; label: string; children: ReactNode }) {
  return <div className="oa-table" role="region" aria-label={label} tabIndex={0}><DataTable><TableHeader><TableRow>
    {columns.map((column, index) => <TableHead key={index} scope="col">{column}</TableHead>)}
  </TableRow></TableHeader><TableBody>{children}</TableBody></DataTable></div>;
}
type QueryLike = { isPending: boolean; isError: boolean; error: unknown; data?: unknown; refetch: () => unknown; isFetching?: boolean };
/** Loading, error and empty states for one query. Renders nothing once data is ready. */
export function State({ query, columns = 4, empty = false }: { query: QueryLike; columns?: number; empty?: boolean }) {
  if (query.isPending) return <div className="oa-loading" role="status" aria-label="正在加载"><Skeleton className="oa-skeleton-title" />
    {[0, 1, 2, 3, 4].map(row => <div className="oa-skeleton-row" key={row} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: columns }, (_, column) => <Skeleton key={column} />)}</div>)}</div>;
  if (query.isError) return <div className={query.data ? "oa-refresh-error" : "oa-state"} role="alert"><AlertCircle size={query.data ? 16 : 24} />
    <p>{query.data ? `刷新失败，当前显示上次加载的数据。${adminError(query.error)}` : adminError(query.error)}</p>
    <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw />重新加载</Button></div>;
  return empty ? <div className="oa-state"><Inbox size={24} /><p>没有符合条件的记录</p></div> : null;
}
export function Pager({ data, onPage }: { data?: Page<unknown>; onPage: (page: number) => void }) {
  if (!data || data.totalItems === 0) return null;
  return <nav className="oa-pager" aria-label="分页"><span>共 {data.totalItems} 条 · 第 {data.page} / {data.totalPages} 页</span>
    <div><Button variant="outline" size="icon-sm" aria-label="上一页" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}><ChevronLeft /></Button>
      <Button variant="outline" size="icon-sm" aria-label="下一页" disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)}><ChevronRight /></Button></div></nav>;
}
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="oa-facts">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}
/** Start focus on the first form field (or the panel itself) rather than the close button and its tooltip. */
function focusContent(event: Event) {
  event.preventDefault();
  const panel = event.currentTarget as HTMLElement;
  (panel.querySelector<HTMLElement>(".oa-dialog-body :is(input, textarea)") ?? panel).focus();
}
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent side="right" className="oa-drawer once-admin-portal" showCloseButton={false} aria-describedby={undefined} tabIndex={-1} onOpenAutoFocus={focusContent}>
      <header><SheetTitle>{title}</SheetTitle><SheetDescription className="sr-only">记录详情</SheetDescription>
        <IconAction label="关闭" onClick={onClose}><X /></IconAction></header>
      <div className="oa-dialog-body">{children}</div>
    </SheetContent></Sheet>;
}
/** Write confirmation: closing is blocked while the request is in flight. */
export function ConfirmDialog({ title, busy, onClose, children, footer }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="oa-dialog once-admin-portal" showCloseButton={false} tabIndex={-1} onOpenAutoFocus={focusContent} onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <header><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">核对对象并填写原因后确认。</DialogDescription>
        <IconAction label="关闭" onClick={onClose} disabled={busy}><X /></IconAction></header>
      <div className="oa-dialog-body">{children}</div>
      <footer>{footer}</footer>
    </DialogContent></Dialog>;
}
/** Every write is audited, so a reason is required; quick picks save typing for routine cases. */
export function ReasonField({ value, onChange, disabled, suggestions }: { value: string; onChange: (value: string) => void; disabled?: boolean; suggestions: string[] }) {
  return <div className="oa-reason"><label>操作原因<Textarea required minLength={3} maxLength={500} rows={2} value={value} disabled={disabled}
    placeholder="简单写一句，方便以后查记录（至少 3 个字）" onChange={event => onChange(event.target.value)} /></label>
    <div className="oa-chips" aria-label="常用原因">{suggestions.map(text => <button type="button" key={text} disabled={disabled}
      data-active={value === text || undefined} onClick={() => onChange(text)}>{text}</button>)}</div></div>;
}
/** One idempotency key per dialog instance; a retry after a network error reuses it. */
export function useOperationKey() {
  const [key] = useState(() => crypto.randomUUID());
  return key;
}
