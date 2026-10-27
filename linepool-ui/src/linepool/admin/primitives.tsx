import { useId, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import { AlertCircle, MoreHorizontal, RefreshCw, Smartphone, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { Badge as StatusBadge } from '../ui/badge';
import { Table as DataTable, TableHeader, TableBody, TableHead, TableRow } from '../ui/table';
import { Skeleton } from '../ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from '../ui/alert-dialog';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { AdminTooltip } from './Presentation';

/** Shared back-office building blocks used by both the platform admin and the agent center. */
export const statusLabels: Record<string, string> = {
  ACTIVE: '正常', DISABLED: '已禁用', USER: '普通用户', ADMIN: '平台管理员',
  AVAILABLE: '可售', ASSIGNED: '已分配', UNSELLABLE: '不可售', LOCAL: '本地资源', ONLINE: '在线', OFFLINE: '离线', ERROR: '异常',
  COMPLETED: '已完成', PROCESSING: '处理中', FAILED: '失败', CANCELLED: '已取消', UNVERIFIED: '待核对',
  POINTS_DEBITED: '积分已扣除', NOT_CONFIGURED: '未接入支付', PENDING: '待支付', CONFIRMED: '已确认', PENDING_REVIEW: '待处理', UNKNOWN: '待核对',
  SUCCEEDED: '已到账', EXPIRED: '已超时',
  PC: 'PC', DEMO: '演示', NOT_CONNECTED: '未接入', PROJECT_ACTIVE: '已启用', PROJECT_INACTIVE: '已停用',
  IMPORTED: '已分发', UNMATCHED: '未匹配用户', RECEIPT_PENDING: '待处理',
  PRODUCT_ON: '销售中', PRODUCT_OFF: '已下架', PRODUCT_NEW: '待生成', ALLOCATED: '已分配给代理', RESERVED: '已预留', RELEASED: '已释放', RETIRED: '已退出库存', SUSPENDED: '已暂停', TERMINATED: '已终止',
};
const regionNames: Record<string, string> = { us: '美国', gb: '英国', ca: '加拿大', sg: '新加坡', de: '德国', nl: '荷兰' };
/** Lower-case region IDs such as `sg` read as Chinese country names for operators. */
export function regionName(code: string | null | undefined) {
  return code ? regionNames[code.toLowerCase()] ?? code.toUpperCase() : '—';
}
/** Plan IDs and names read as durations. `t` translates the Chinese labels in English mode. */
export function planLabel(plan: string | null | undefined, t: (text: string) => string = text => text) {
  if (plan === 'week') return t('7 天');
  if (plan === 'month') return t('30 天');
  const match = plan ? /^(\d+)\s*天(.*)$/.exec(plan.trim()) : null;
  if (!match) return plan || t('全部');
  const suffix = t(match[2]);
  return `${t(`${match[1]} 天`)}${suffix === match[2] ? '' : ' '}${suffix}`;
}
/** Order-number prefixes tell what a ledger entry really was; a zero-amount "adjustment" is usually a number hand-over. */
export function txKindLabel(orderNumber: string, kind: string) {
  const byPrefix: Record<string, string> = { C: '号码分配', I: '号码录入', R: '号码转给其他代理', A: '余额充值 / 扣减', T: '余额转账' };
  const prefix = /^LP-([A-Z])-/.exec(orderNumber)?.[1];
  // Assigning a number to a customer shares the "A" prefix with balance adjustments but is recorded as a TRANSFER.
  if (prefix === 'A' && kind === 'TRANSFER') return '号码分配给客户';
  return (prefix && byPrefix[prefix]) ?? ({ PURCHASE: '购买', RENEW: '续费', TRANSFER: '转账', ADJUSTMENT: '余额调整' } as Record<string, string>)[kind] ?? kind;
}
/** Long generated identifiers are shortened for display; the full value stays in a tooltip. */
export function ShortId({ value, prefix = '' }: { value: string; prefix?: string }) {
  const short = value.replace(/^((?:[A-Z]+-)*)([0-9A-Za-z]{8})[-0-9A-Za-z]*$/, (_, head = '', body) => `${head}${body}`);
  return <AdminTooltip label={value}><span tabIndex={0} className="lp-admin-short-id lp-admin-mono">{prefix}{short}</span></AdminTooltip>;
}
/** True only for a plain click on the row itself, not on its controls or on portal content (menus, dialogs) rendered from it. */
export function isRowClick(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  return event.currentTarget.contains(target) && !target.closest('button, a, input, label, [role="menuitem"], [role="checkbox"]');
}
export type RowMenuItem ={ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };
/** Secondary row actions collapse into one "more" menu so tables stay one line tall. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const p = useDisplayPreferences();
  if (!items.length) return null;
  return <DropdownMenu><AdminTooltip label={label}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="lp-admin-button lp-admin-icon-button" aria-label={label}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger></AdminTooltip>
    {/* React bubbles portal events to the owning row; stop them so a menu pick never also opens the row's detail. */}
    <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12} className="lp-admin-dropdown lp-admin-theme lp-admin-row-menu" data-theme={p.theme} onClick={event => event.stopPropagation()}>
      {items.map(item => <DropdownMenuItem key={item.label} disabled={item.disabled} data-danger={item.danger || undefined} onSelect={item.onSelect}>{item.label}</DropdownMenuItem>)}
    </DropdownMenuContent></DropdownMenu>;
}
export function State({ loading, error, retry, empty = false, data, columns = 3 }: { loading: boolean; error: string; retry: () => void; empty?: boolean; data?: unknown; columns?: number }) {
  const p = useDisplayPreferences();
  if (loading && !data) return <div className="lp-admin-loading" role="status" aria-label={p.t("正在加载数据")}><span className="sr-only">{p.t("正在加载数据…")}</span><Skeleton className="lp-admin-skeleton-heading" />{[0, 1, 2, 3, 4].map(row => <div className="lp-admin-skeleton-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} key={row}>{Array.from({ length: columns }, (_, column) => <Skeleton key={column} />)}</div>)}</div>;
  if (error) return <div className={data ? 'lp-admin-refresh-error' : 'lp-admin-state'} role="alert"><AlertCircle size={data ? 16 : 24} /><p>{data ? p.t("刷新失败，当前显示上次成功加载的数据。{value1}", { value1: error }) : error}</p><ActionButton onClick={retry} disabled={loading}><RefreshCw size={15} />{p.t("重新加载")}</ActionButton></div>;
  return empty && !loading ? <div className="lp-admin-state"><Smartphone size={24} /><p>{p.t("暂无数据")}</p></div> : null;
}
export type ActionButtonProps = Omit<ComponentProps<typeof Button>, 'variant'> & { variant?: 'accent' | 'ghost' | 'outline'; busy?: boolean };
export function ActionButton({ className = '', variant = 'outline', busy = false, disabled, type = 'button', children, ...props }: ActionButtonProps) {
  return <Button {...props} type={type} variant={variant === 'accent' ? 'default' : variant} disabled={disabled || busy} aria-busy={busy || props['aria-busy']} className={`lp-admin-button ${className}`}>{busy && <RefreshCw size={15} className="lp-admin-spin" />}{children}</Button>;
}
export function Badge({ value }: { value: string }) {
  const p = useDisplayPreferences();
  const tone = ['ACTIVE', 'COMPLETED', 'SUCCEEDED', 'POINTS_DEBITED', 'ONLINE', 'AVAILABLE', 'CONFIRMED', 'IMPORTED', 'PROJECT_ACTIVE', 'PRODUCT_ON'].includes(value) ? 'success' : ['FAILED', 'DISABLED', 'ERROR'].includes(value) ? 'danger' : ['PROCESSING', 'ALLOCATED', 'ASSIGNED'].includes(value) ? 'info' : ['PENDING', 'PENDING_REVIEW', 'UNKNOWN', 'UNVERIFIED', 'UNMATCHED', 'RECEIPT_PENDING'].includes(value) ? 'warning' : 'neutral';
  return <StatusBadge variant="outline" className="lp-admin-status" data-tone={tone}>{p.t(statusLabels[value] ?? value)}</StatusBadge>;
}
export function DateText({ value }: { value: string | null }) {
  const p = useDisplayPreferences();
  return <>{value ? <time dateTime={value}>{p.date(value, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time> : '—'}</>;
}
export function Table({ columns, children, label }: { columns: Array<string | ReactNode>; children: ReactNode; label: string }) {
  return <div className="lp-admin-table-scroll" role="region" aria-label={label} tabIndex={0}><DataTable><TableHeader><TableRow>{columns.map((name, index) => <TableHead key={index} scope="col">{name}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></DataTable></div>;
}
export function IconAction({ label, onClick, children, disabled = false }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <AdminTooltip label={label}><span className="lp-admin-icon-wrap"><ActionButton variant="ghost" size="icon" className="lp-admin-icon-button" aria-label={label} onClick={onClick} disabled={disabled}>{children}</ActionButton></span></AdminTooltip>;
}
export function Modal({ title, onClose, children, busy = false, variant = 'dialog' }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; variant?: 'dialog' | 'drawer' | 'confirmation' }) {
  const titleId = useId();
  const p = useDisplayPreferences();
  const Title = variant === 'confirmation' ? AlertDialogTitle : DialogTitle;
  const contents = <><header><Title id={titleId}>{title}</Title><IconAction label={p.t("关闭")} onClick={onClose} disabled={busy}><X size={18} /></IconAction></header>{children}</>;
  const className = `lp-admin-dialog lp-admin-theme${variant === 'drawer' ? ' lp-admin-drawer' : ''}`;
  const changeOpen = (open: boolean) => { if (!open && !busy) onClose(); };
  if (variant === 'confirmation') return <AlertDialog open onOpenChange={changeOpen}><AlertDialogContent className={className} data-theme={p.theme} aria-labelledby={titleId} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}><AlertDialogDescription className="sr-only">{p.t("请核对操作对象并填写操作原因，确认后将执行此操作。")}</AlertDialogDescription>{contents}</AlertDialogContent></AlertDialog>;
  return <Dialog open onOpenChange={changeOpen}><DialogContent className={className} data-theme={p.theme} showCloseButton={false} aria-labelledby={titleId} aria-describedby={undefined}
    onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>{contents}</DialogContent></Dialog>;
}
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="lp-admin-facts">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}
