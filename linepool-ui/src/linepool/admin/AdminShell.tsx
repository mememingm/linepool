import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { z } from 'zod';
import { AlertCircle, ArrowUpRight, Check, Clock3, Eye, FolderSync, MessageSquare, PackageCheck, Pencil, Plus, RefreshCw, Search, ShieldCheck, Smartphone, Users, WalletCards, X } from 'lucide-react';
import { adminUserSchema, adminNumberSchema, adminProductSchema, adminOrderSchema, adminProjectSchema, adminReceiptSchema, auditSchema,
  type AdminUser, type AdminNumber, type AdminProduct, type AdminOrder, type AdminReceipt, type Allocation, type ProductInput, type AdminQuery } from '@linepool/contracts/admin';
import { serviceSchema, adminRechargeRecordSchema, rechargeRulesSchema, parseRechargeAmount, formatRechargeAmount, rechargeAmountInput,
  type User, type RechargeRules, type RechargeSettings } from '../api/contracts';
import { createLinepoolApi, LinepoolApiError } from '../api/client';
import { Button } from '../ui/button';
import { Badge as StatusBadge } from '../ui/badge';
import { Card } from '../ui/card';
import { Table as DataTable, TableHeader, TableBody, TableHead, TableRow } from '../ui/table';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from '../ui/alert-dialog';
import { SidebarProvider, SidebarTrigger } from '../ui/sidebar';
import { TooltipProvider } from '../ui/tooltip';
import { Toaster, toast } from 'sonner';
import { AdminAccountMenu, AdminActivityProvider, AdminSidebar, AdminTooltip, Identifier, useAdminActivity } from './Presentation';
import SelectField from '../SelectField';
import AppSearchInput from '../AppSearchInput';
import AppCombobox from '../AppCombobox';
import RecordPagination from '../workspace-reference/RecordPagination';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { navigate } from '../../app/router';
import { adminHref, adminTitles, type AdminPage } from './navigation';
import './admin.css';

const api = createLinepoolApi();
const regions = [{ value: 'us', label: '美国' }, { value: 'gb', label: '英国' }, { value: 'ca', label: '加拿大' }, { value: 'sg', label: '新加坡' }, { value: 'de', label: '德国' }, { value: 'nl', label: '荷兰' }];
const statusLabels: Record<string, string> = {
  ACTIVE: '正常', DISABLED: '已禁用', USER: '普通用户', ADMIN: '平台管理员',
  AVAILABLE: '可售', ASSIGNED: '已分配', UNSELLABLE: '不可售', LOCAL: '本地资源', ONLINE: '在线', OFFLINE: '离线', ERROR: '异常',
  COMPLETED: '已完成', PROCESSING: '处理中', FAILED: '失败', CANCELLED: '已取消', UNVERIFIED: '待核对',
  POINTS_DEBITED: '积分已扣除', NOT_CONFIGURED: '未接入支付', PENDING: '待支付', CONFIRMED: '已确认', PENDING_REVIEW: '待处理', UNKNOWN: '待核对',
  SUCCEEDED: '已到账', EXPIRED: '已超时',
  PC: 'PC', DEMO: '演示', NOT_CONNECTED: '未接入', PROJECT_ACTIVE: '已启用', PROJECT_INACTIVE: '已停用',
  IMPORTED: '已分发', UNMATCHED: '未匹配用户', RECEIPT_PENDING: '待处理',
};
function errorMessage(cause: unknown) {
  if (cause instanceof z.ZodError) return '请检查必填内容、数值范围和操作原因。';
  if (!(cause instanceof LinepoolApiError)) return '操作失败，请重试。';
  if (cause.status === 401) navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`, true);
  if (cause.status === 403 && cause.code === 'ADMIN_REQUIRED') window.dispatchEvent(new Event('linepool-admin-access-denied'));
  const labels: Record<string, string> = { ADMIN_REQUIRED: '当前账号没有平台管理员权限。', ACCOUNT_DISABLED: '账号已被禁用。',
    NUMBER_ASSIGNED: '号码已被分配，不能重复分配或上架。', OWNERSHIP_CHANGED: '号码归属已变化，请刷新后重试。',
    RESOURCE_UNAVAILABLE: '号码资源当前不可用。', USER_UNAVAILABLE: '目标用户不存在或已禁用。',
    RESOURCE_EXPIRES_TOO_SOON: 'PC 号码资源到期时间不足以覆盖所选服务天数。', INVALID_DURATION: '服务天数请选择 7 天或 30 天。',
    NUMBER_RESERVED: '该号码的平台服务有待完成订单，请先处理订单。',
    ADMIN_PROTECTED: '不能在此禁用管理员账号。', PRODUCT_EXISTS: '相同地区、服务与套餐标识的商品已存在。',
    VALIDATION_ERROR: '提交内容不符合要求。', REQUEST_TIMEOUT: '请求超时，请刷新核对操作结果后再试。',
    RECHARGE_SETTINGS_CHANGED: '充值配置已被其他管理员修改，请关闭弹窗、刷新后重新填写。',
    NETWORK_ERROR: '无法连接服务，请重试。', NOT_FOUND: '记录不存在或已变化。', ORIGIN_REJECTED: '当前访问地址未获服务授权。' };
  return labels[cause.code] ?? (cause.status === 429 ? '请求过于频繁，请稍后重试。' : cause.status >= 500 ? '服务暂时不可用，请重试。' : cause.message);
}
function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>, refreshKey: string | number = 0) {
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string; errorCode: string }>({ key, data: null, loading: true, error: '', errorCode: '' });
  const [version, setVersion] = useState(0);
  const loader = useRef(load); loader.current = load;
  const { begin } = useAdminActivity();
  useEffect(() => {
    const controller = new AbortController();
    const finish = begin();
    // Only retain data for this exact resource/query, never another record or filter.
    setState(current => ({ key, data: current.key === key ? current.data : null, loading: true, error: '', errorCode: '' }));
    void loader.current(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data, loading: false, error: '', errorCode: '' });
    }).catch(cause => {
      if (controller.signal.aborted) return;
      const accessDenied = cause instanceof LinepoolApiError && (cause.status === 401 || cause.status === 403);
      const error = errorMessage(cause);
      setState(current => ({ key, data: !accessDenied && current.key === key ? current.data : null, loading: false, error, errorCode: cause instanceof LinepoolApiError ? cause.code : '' }));
    }).finally(finish);
    return () => { controller.abort(); finish(); };
  }, [key, refreshKey, version, begin]);
  // A changed query must not expose the preceding query's rows before its effect runs.
  const { data, loading, error, errorCode } = state.key === key ? state : { data: null, loading: true, error: '', errorCode: '' };
  return { data, loading, error, errorCode, retry: () => setVersion(value => value + 1) };
}
function State({ loading, error, retry, empty = false, data, columns = 3 }: { loading: boolean; error: string; retry: () => void; empty?: boolean; data?: unknown; columns?: number }) {
  if (loading && !data) return <div className="lp-admin-loading" role="status" aria-label="正在加载数据"><span className="sr-only">正在加载数据…</span><Skeleton className="lp-admin-skeleton-heading" />{[0, 1, 2, 3, 4].map(row => <div className="lp-admin-skeleton-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} key={row}>{Array.from({ length: columns }, (_, column) => <Skeleton key={column} />)}</div>)}</div>;
  if (error) return <div className={data ? 'lp-admin-refresh-error' : 'lp-admin-state'} role="alert"><AlertCircle size={data ? 16 : 24} /><p>{data ? `刷新失败，当前显示上次成功加载的数据。${error}` : error}</p><ActionButton onClick={retry} disabled={loading}><RefreshCw size={15} />重新加载</ActionButton></div>;
  return empty && !loading ? <div className="lp-admin-state"><Smartphone size={24} /><p>暂无数据</p></div> : null;
}
type ActionButtonProps = Omit<ComponentProps<typeof Button>, 'variant'> & { variant?: 'accent' | 'ghost' | 'outline'; busy?: boolean };
function ActionButton({ className = '', variant = 'outline', busy = false, disabled, type = 'button', children, ...props }: ActionButtonProps) {
  return <Button {...props} type={type} variant={variant === 'accent' ? 'default' : variant} disabled={disabled || busy} aria-busy={busy || props['aria-busy']} className={`lp-admin-button ${className}`}>{busy && <RefreshCw size={15} className="lp-admin-spin" />}{children}</Button>;
}
function Badge({ value }: { value: string }) {
  const tone = ['ACTIVE', 'COMPLETED', 'SUCCEEDED', 'POINTS_DEBITED', 'ONLINE', 'AVAILABLE', 'CONFIRMED', 'IMPORTED', 'PROJECT_ACTIVE'].includes(value) ? 'success' : ['FAILED', 'DISABLED', 'ERROR'].includes(value) ? 'danger' : value === 'PROCESSING' ? 'info' : ['PENDING', 'PENDING_REVIEW', 'UNKNOWN', 'UNVERIFIED', 'UNMATCHED', 'RECEIPT_PENDING'].includes(value) ? 'warning' : 'neutral';
  return <StatusBadge variant="outline" className="lp-admin-status" data-tone={tone}>{statusLabels[value] ?? value}</StatusBadge>;
}
function DateText({ value }: { value: string | null }) {
  const p = useDisplayPreferences();
  return <>{value ? <time dateTime={value}>{p.date(value, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time> : '—'}</>;
}
function Table({ columns, children, label }: { columns: Array<string | ReactNode>; children: ReactNode; label: string }) {
  return <div className="lp-admin-table-scroll" role="region" aria-label={label} tabIndex={0}><DataTable><TableHeader><TableRow>{columns.map((name, index) => <TableHead key={index} scope="col">{name}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></DataTable></div>;
}
function IconAction({ label, onClick, children, disabled = false }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <AdminTooltip label={label}><span className="lp-admin-icon-wrap"><ActionButton variant="ghost" size="icon" className="lp-admin-icon-button" aria-label={label} onClick={onClick} disabled={disabled}>{children}</ActionButton></span></AdminTooltip>;
}
function Modal({ title, onClose, children, busy = false, variant = 'dialog' }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; variant?: 'dialog' | 'drawer' | 'confirmation' }) {
  const titleId = useId();
  const p = useDisplayPreferences();
  const Title = variant === 'confirmation' ? AlertDialogTitle : DialogTitle;
  const contents = <><header><Title id={titleId}>{title}</Title><IconAction label="关闭" onClick={onClose} disabled={busy}><X size={18} /></IconAction></header>{children}</>;
  const className = `lp-admin-dialog lp-admin-theme${variant === 'drawer' ? ' lp-admin-drawer' : ''}`;
  const changeOpen = (open: boolean) => { if (!open && !busy) onClose(); };
  if (variant === 'confirmation') return <AlertDialog open onOpenChange={changeOpen}><AlertDialogContent className={className} data-theme={p.theme} aria-labelledby={titleId} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}><AlertDialogDescription className="sr-only">请核对操作对象并填写操作原因，确认后将执行此操作。</AlertDialogDescription>{contents}</AlertDialogContent></AlertDialog>;
  return <Dialog open onOpenChange={changeOpen}><DialogContent className={className} data-theme={p.theme} showCloseButton={false} aria-labelledby={titleId} aria-describedby={undefined}
    onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>{contents}</DialogContent></Dialog>;
}
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="lp-admin-facts">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}
function AllocationTable({ items }: { items: Allocation[] }) {
  return <Table columns={['号码 / 平台', '用户', '分配时间', '原服务到期', '归属状态']} label="归属历史"><>{items.map(item => <tr key={item.id}><td>{item.phone_number}<small>{item.platform_id}</small></td><td>{item.owner_name}</td><td><DateText value={item.assigned_at} /></td><td><DateText value={item.expires_at} /></td><td>{item.released_at ? <><Badge value="CANCELLED" /><small>回收于 <DateText value={item.released_at} /></small></> : '当前归属'}</td></tr>)}{!items.length && <tr><td colSpan={5}>暂无归属记录</td></tr>}</></Table>;
}
type DetailTarget = { section: 'users' | 'numbers' | 'orders'; id: string };
function UserDetail({ id }: { id: string }) {
  const result = useResource(id, signal => api.adminUser(id, { signal }));
  if (!result.data) return <State {...result} />;
  const { user, numbers, orders } = result.data.data;
  return <><Facts rows={[
    ['用户 ID', <span className="lp-admin-mono">{user.id}</span>], ['用户名', user.display_name], ['邮箱', user.email],
    ['角色', <Badge value={user.role} />], ['账号状态', <Badge value={user.account_status} />], ['积分余额', user.points_balance],
    ['注册时间', <DateText value={user.created_at} />],
  ]} /><h3>持有号码 · 最近 50 条</h3><Table columns={['号码', '服务', '有效期']} label="用户号码">{numbers.map(n => <tr key={n.id}><td>{n.phone_number}</td><td>{n.service}</td><td><DateText value={n.expires_at} /></td></tr>)}</Table>
    <h3>历史订单 · 最近 50 条</h3><OrderTable orders={orders} /><a href={adminHref('orders', { userId: id })}>查看全部订单 <ArrowUpRight size={14} /></a></>;
}
function NumberDetail({ id }: { id: string }) {
  const result = useResource(id, signal => api.adminNumber(id, { signal }));
  if (!result.data) return <State {...result} />;
  const { number: n, allocations } = result.data.data;
  return <><Facts rows={[
    ['手机号码', n.phone_number], ['国家 / 区号', `${n.country} / ${n.prefix}`], ['平台', n.service], ['来源', <Badge value={n.provider === 'pingcode' ? 'PC' : 'DEMO'} />],
    ['服务资源 ID', <Identifier value={n.id} />], ['号码 ID', <Identifier value={n.number_id} />],
    ['PC 号码 ID', n.provider === 'pingcode' ? n.external_number_id ?? '未绑定' : '—'], ['PC 项目', n.provider === 'pingcode' ? `${n.project_name} · ${n.external_project_id}` : '—'],
    ['号码能力', '仅接收'], ['资源状态', <Badge value={n.resource_status} />], ['销售状态', <Badge value={n.sale_status} />],
    ['所属用户', n.owner_name ?? '未分配'], ['用户服务到期', <DateText value={n.expires_at} />], ['PC 号码资源到期', <DateText value={n.resource_expires_at} />],
  ]} /><h3>分配历史 · 最近 50 条</h3><AllocationTable items={allocations} /></>;
}
function OrderDetail({ id }: { id: string }) {
  const result = useResource(id, signal => api.adminOrder(id, { signal }));
  if (!result.data) return <State {...result} />;
  const { order: o, allocations } = result.data.data;
  return <><Facts rows={[
    ['订单编号', <span className="lp-admin-mono">{o.order_number}</span>], ['用户', o.owner_name], ['商品', o.plan_name], ['数量', o.quantity], ['订单积分', `${o.total_points} 积分`],
    ['结算状态', <Badge value={o.payment_status} />], ['开通状态', <Badge value={o.fulfillment_status} />],
    ['创建时间', <DateText value={o.created_at} />], ['完成时间', <DateText value={o.completed_at} />],
  ]} /><h3>交付与历史归属</h3><AllocationTable items={allocations} /><h3>购买时商品快照</h3><pre className="lp-admin-json">{JSON.stringify(o.product_snapshot, null, 2)}</pre></>;
}
function Detail({ target, onClose }: { target: DetailTarget; onClose: () => void }) {
  const content = target.section === 'users' ? <UserDetail id={target.id} /> : target.section === 'numbers' ? <NumberDetail id={target.id} /> : <OrderDetail id={target.id} />;
  return <Modal title={`${adminTitles[target.section]}详情`} variant="drawer" onClose={onClose}><div className="lp-admin-dialog-body">{content}</div></Modal>;
}
function OrderTable({ orders, onDetail }: { orders: AdminOrder[]; onDetail?: (id: string) => void }) {
  return <Table columns={['订单 / 用户', '商品', '积分', '结算状态', '开通状态', '创建时间', ...(onDetail ? ['操作'] : [])]} label="订单列表">{orders.map(o => <tr key={o.id}><td><Identifier value={o.order_number} /><small>{o.owner_name}</small></td><td>{o.plan_name}<small>{o.quantity} 个号码 · 已分配 {o.assigned_count}</small></td><td className="lp-admin-numeric">{o.total_points}</td><td><Badge value={o.payment_status} /></td><td><Badge value={o.fulfillment_status} /></td><td><DateText value={o.created_at} /></td>{onDetail && <td><IconAction label="查看订单" onClick={() => onDetail(o.id)}><Eye size={16} /></IconAction></td>}</tr>)}</Table>;
}

type ActionTarget = { kind: 'user'; user: AdminUser } | { kind: 'assign' | 'reclaim' | 'sale'; number: AdminNumber };
function ConfirmAction({ target, onClose, onSuccess }: { target: ActionTarget; onClose: () => void; onSuccess: () => void }) {
  const [reason, setReason] = useState('');
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState('30');
  const [userSearch, setUserSearch] = useState('');
  const [userTerm, setUserTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const users = useResource(`assign-users:${target.kind}:${userTerm}`, signal => target.kind === 'assign' ? api.adminList('users', adminUserSchema, { pageSize: 20, status: 'ACTIVE', search: userTerm }, { signal }) : Promise.resolve(null));
  const title = target.kind === 'user' ? target.user.account_status === 'ACTIVE' ? '禁用用户' : '启用用户' : target.kind === 'assign' ? '手动分配号码' : target.kind === 'reclaim' ? '回收号码' : target.number.sale_enabled ? '设为不可售' : '设为可售';
  async function submit() {
    setBusy(true); setError('');
    try {
      if (target.kind === 'user') await api.adminUserStatus(target.user.id, { status: target.user.account_status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', reason });
      else if (target.kind === 'assign') await api.adminNumberAction(target.number.id, { action: 'assign', userId, durationDays: days === '7' ? 7 : 30, reason });
      else if (target.kind === 'reclaim') await api.adminNumberAction(target.number.id, { action: 'reclaim', expectedUserId: target.number.assigned_user_id!, expectedAllocationId: target.number.allocation_id!, reason });
      else await api.adminNumberAction(target.number.id, { action: 'sale', saleEnabled: !target.number.sale_enabled, reason });
      onSuccess();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title={title} onClose={onClose} busy={busy} variant="confirmation"><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-confirm-target">{target.kind === 'user' ? `${target.user.display_name} · ${target.user.email}` : `${target.number.phone_number} · ${target.number.service}`}</p>
    {target.kind === 'reclaim' && <p className="lp-admin-warning">仅结束该号码在 {target.number.service} 平台的当前服务，保留历史订单与短信，其他平台不受影响。回收后该平台服务不会自动上架。</p>}
    {target.kind === 'user' && target.user.account_status === 'ACTIVE' && <p className="lp-admin-warning">禁用后，该用户的登录会话立即失效，号码和订单记录会保留。</p>}
    {target.kind === 'assign' && <><p>人工分配，不创建支付记录、不扣积分。</p><AppSearchInput className="lp-admin-search" aria-label="搜索分配用户" placeholder="用户名、邮箱或用户 ID" value={userSearch} onValueChange={setUserSearch} disabled={busy} loading={users.loading}><IconAction label="查找用户" onClick={() => setUserTerm(userSearch)} disabled={busy}><Search size={16} /></IconAction></AppSearchInput>
      <State loading={users.loading} error={users.error} retry={users.retry} />
      <label>目标用户<AppCombobox aria-label="目标用户" value={userId} disabled={busy || users.loading} onValueChange={setUserId} options={[{ value: '', label: '请选择用户' }, ...(users.data?.data ?? []).map(user => ({ value: user.id, label: `${user.display_name} · ${user.email}` }))]} /></label>
      <label>服务天数<AppCombobox aria-label="分配服务天数" value={days} onValueChange={setDays} options={[{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }]} disabled={busy} /></label></>}
    <label>操作原因<Textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></label>{error && <p role="alert" className="lp-admin-error">{error}</p>}
    </div><footer><ActionButton disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton variant="accent" type="submit" busy={busy} disabled={target.kind === 'assign' && !userId}><Check size={15} />确认{title}</ActionButton></footer></form></Modal>;
}
function ProductEditor({ product, onClose, onSuccess }: { product: AdminProduct | null; onClose: () => void; onSuccess: () => void }) {
  const [value, setValue] = useState<ProductInput>(() => product ? { region: product.region_id, service: product.service, plan: product.plan, name: product.name, durationDays: product.duration_days === 7 ? 7 : 30, unitPoints: product.unit_points, isActive: product.is_active, areaPrefix: product.area_prefix, capability: 'RECEIVE', allowRenewal: false, reason: '' }
    : { region: 'us', service: 'Telegram', plan: '', name: '', durationDays: 30, unitPoints: 15, isActive: false, areaPrefix: '', capability: 'RECEIVE', allowRenewal: false, reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mappings = useResource('product-platform-mappings', signal => api.adminList('projects', adminProjectSchema, { pageSize: 100, provider: 'pingcode', status: 'ACTIVE' }, { signal }));
  const pcProject = mappings.data?.data.find(item => item.platform_id === value.service);
  function set<K extends keyof ProductInput>(key: K, next: ProductInput[K]) { setValue(current => ({ ...current, [key]: next })); }
  async function submit() { setBusy(true); setError(''); try { await api.adminSaveProduct(value, !product); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title={product ? '编辑商品' : '创建商品'} busy={busy} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><fieldset disabled={busy} className="lp-admin-form-grid">
    <label className="lp-admin-span">商品名称<Input required maxLength={100} value={value.name} onChange={e => set('name', e.target.value)} /></label>
    <label>国家 / 地区<AppCombobox aria-label="商品国家" disabled={busy || Boolean(product)} value={value.region} onValueChange={v => set('region', v as ProductInput['region'])} options={regions} /></label>
    <label>适用平台<AppCombobox aria-label="商品平台" disabled={busy || Boolean(product)} value={value.service} onValueChange={v => set('service', v as ProductInput['service'])} options={serviceSchema.options.map(v => ({ value: v, label: v }))} /></label>
    <div className="lp-admin-span lp-admin-field-note"><span>PC 对应项目</span><small>{mappings.loading ? '正在读取本地配置…' : mappings.error ? '配置读取失败，请重新打开商品。' : pcProject ? `${pcProject.project_name} · ${pcProject.external_project_id}` : '未绑定 · PC 同步尚未接入'}</small></div>
    <label>套餐标识<Input required pattern="[a-z][a-z0-9_-]{0,31}" maxLength={32} disabled={busy || Boolean(product)} value={value.plan} onChange={e => set('plan', e.target.value)} /></label>
    <label>号段前缀<Input maxLength={20} pattern="\+?[0-9]*" placeholder="全部号段" value={value.areaPrefix} onChange={e => set('areaPrefix', e.target.value)} /></label>
    <label>服务天数<AppCombobox aria-label="商品服务天数" disabled={busy} value={String(value.durationDays)} onValueChange={v => set('durationDays', v === '7' ? 7 : 30)} options={[{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }]} /></label>
    {product && product.duration_days !== 7 && product.duration_days !== 30 && <p className="lp-admin-context lp-admin-span">原商品为 {product.duration_days} 天，保存时使用本次所选的 7/30 天。</p>}
    <label>价格（积分 / 个）<Input type="number" required min={1} max={1000000} value={value.unitPoints} onChange={e => set('unitPoints', Number(e.target.value))} /></label>
    <div>号码能力<small>仅接收</small></div>
    <label className="lp-admin-checkbox lp-admin-span"><Checkbox checked={value.isActive} onCheckedChange={checked => set('isActive', checked === true)} />上架商品</label>
    <label className="lp-admin-span">操作原因<Textarea required minLength={3} maxLength={500} value={value.reason} onChange={e => set('reason', e.target.value)} /></label>
    {error && <p role="alert" className="lp-admin-error lp-admin-span">{error}</p>}
    </fieldset></div><footer><ActionButton disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={16} />保存商品</ActionButton></footer></form></Modal>;
}

function RechargeSettingsEditor({ settings, onClose, onSuccess }: { settings: RechargeSettings; onClose: () => void; onSuccess: () => void }) {
  const original = settings.rules;
  const toText = (minor: number | null | undefined) => minor == null || !original ? '' : rechargeAmountInput(minor, original.fractionDigits);
  const [enabled, setEnabled] = useState(true);
  const [currency, setCurrency] = useState(original?.currency ?? '');
  const [minimum, setMinimum] = useState(toText(original?.minimumMinor));
  const [maximum, setMaximum] = useState(toText(original?.maximumMinor));
  const [presets, setPresets] = useState(original?.presetsMinor.map(toText).join(', ') ?? '');
  const [exchangeAmount, setExchangeAmount] = useState(toText(original?.exchangeAmountMinor));
  const [exchangePoints, setExchangePoints] = useState(original?.exchangePoints == null ? '' : String(original.exchangePoints));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const names = new Intl.DisplayNames(['zh-CN'], { type: 'currency' });
  const currencyOptions = [{ value: '', label: '请选择币种' }, ...Intl.supportedValuesOf('currency').map(value => ({ value, label: `${value} · ${names.of(value)}` }))];
  async function submit() {
    setBusy(true); setError('');
    try {
      let rules: RechargeRules | null = null;
      if (enabled) {
        if (!currency) throw new Error('请选择充值币种。');
        const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
        const base = { currency, fractionDigits, minimumMinor: 1, maximumMinor: Number.MAX_SAFE_INTEGER, presetsMinor: [], exchangeAmountMinor: null, exchangePoints: null };
        const amount = (value: string, label: string) => {
          const parsed = parseRechargeAmount(value.trim(), base);
          if (parsed.error) throw new Error(`${label}请输入正数，最多保留 ${fractionDigits} 位小数。`);
          return parsed.amountMinor;
        };
        const minimumMinor = amount(minimum, '最低充值金额');
        const maximumMinor = amount(maximum, '最高充值金额');
        if (minimumMinor > maximumMinor) throw new Error('最高充值金额不能小于最低充值金额。');
        const presetsMinor = presets.trim() ? presets.trim().split(/[,，、\s]+/).filter(Boolean).map(value => amount(value, '快捷金额')).sort((a, b) => a - b) : [];
        if (presetsMinor.length > 12) throw new Error('快捷充值金额最多配置 12 个。');
        if (new Set(presetsMinor).size !== presetsMinor.length) throw new Error('快捷充值金额不能重复。');
        if (presetsMinor.some(value => value < minimumMinor || value > maximumMinor)) throw new Error('每个快捷金额都必须在充值范围内。');
        if (!/^[0-9]+$/.test(exchangePoints) || !Number.isInteger(Number(exchangePoints)) || Number(exchangePoints) < 1) throw new Error('对应积分请输入正整数。');
        const parsed = rechargeRulesSchema.safeParse({ currency, fractionDigits, minimumMinor, maximumMinor, presetsMinor,
          exchangeAmountMinor: amount(exchangeAmount, '兑换金额'), exchangePoints: Number(exchangePoints) });
        if (!parsed.success) throw new Error('请调整兑换比例或最高金额；快捷金额须能兑换为整数积分，单次积分不能超过 2,147,483,647。');
        rules = parsed.data;
      }
      await api.adminSaveRechargeSettings({ rules, expectedVersion: settings.version, reason });
      onSuccess();
    } catch (cause) { setError(cause instanceof LinepoolApiError || cause instanceof z.ZodError ? errorMessage(cause) : cause instanceof Error ? cause.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <Modal title="充值金额与积分规则" onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <p className="lp-admin-context">配置金额与积分预览。支付渠道尚未开通。</p>
    <label className="lp-admin-checkbox"><Checkbox checked={enabled} disabled={busy} onCheckedChange={checked => setEnabled(checked === true)} />显示充值金额和兑换规则</label>
    <fieldset className="lp-admin-form-grid lp-admin-recharge-form" disabled={busy || !enabled}>
      <label className="lp-admin-span">充值币种<AppCombobox aria-label="充值币种" disabled={busy || !enabled} value={currency} onValueChange={setCurrency} options={currencyOptions} /></label>
      <label>最低充值金额<Input required={enabled} inputMode="decimal" maxLength={32} value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
      <label>最高充值金额<Input required={enabled} inputMode="decimal" maxLength={32} value={maximum} onChange={event => setMaximum(event.target.value)} /></label>
      <label className="lp-admin-span">快捷充值金额<Input placeholder="多个金额用逗号分隔，可留空" maxLength={420} value={presets} onChange={event => setPresets(event.target.value)} /></label>
      <label>兑换金额<Input required={enabled} inputMode="decimal" maxLength={32} placeholder="例如 1" value={exchangeAmount} onChange={event => setExchangeAmount(event.target.value)} /></label>
      <label>对应积分<Input required={enabled} inputMode="numeric" pattern="[0-9]+" maxLength={10} placeholder="填写对应的积分数" value={exchangePoints} onChange={event => setExchangePoints(event.target.value)} /></label>
    </fieldset>
    <label className="lp-admin-recharge-reason">操作原因<Textarea required minLength={3} maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>
    {error && <p className="lp-admin-error" role="alert">{error}</p>}
    </div><footer><ActionButton disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={16} />保存充值规则</ActionButton></footer></form></Modal>;
}
function RechargesList({ input, revision, update }: Pick<ListProps, 'input' | 'revision' | 'update'>) {
  const p = useDisplayPreferences();
  const settings = useResource('recharge-settings', signal => api.adminRechargeSettings({ signal }), revision);
  const result = useList('recharges', adminRechargeRecordSchema, input, revision);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<z.infer<typeof adminRechargeRecordSchema> | null>(null);
  const config = settings.data?.data;
  const rules = config?.rules;
  const amount = (value: number) => rules ? formatRechargeAmount(value, rules, p.locale) : '未配置';
  useEffect(() => setSelected(null), [JSON.stringify(input), revision]);
  return <><section className="lp-admin-recharge-settings" aria-label="充值规则"><div className="lp-admin-section-heading"><h2>充值规则</h2><ActionButton onClick={() => setEditing(true)} disabled={!config || settings.loading || !!settings.error}><Pencil size={15} />配置充值</ActionButton></div><State {...settings} />
    {config && <><Facts rows={[
      ['充值币种', rules?.currency ?? '未配置'], ['充值范围', rules ? `${amount(rules.minimumMinor)} – ${amount(rules.maximumMinor)}` : '未配置'],
      ['兑换比例', rules?.exchangeAmountMinor && rules.exchangePoints ? `${amount(rules.exchangeAmountMinor)} = ${p.n(rules.exchangePoints)} 积分` : '未配置'],
      ['快捷金额', rules?.presetsMinor.length ? rules.presetsMinor.map(amount).join('、') : '未配置'],
      ['支付状态', '尚未开通'], ['最近修改', config.updatedAt ? <><DateText value={config.updatedAt} /> · {config.updatedBy}</> : '—'],
    ]} /><p className="lp-admin-context">配置只影响金额选择和积分预览，充值成功记录由支付到账结果产生。</p></>}
    </section><div className="lp-admin-section-heading"><h2>充值记录</h2></div><State {...result} columns={7} empty={result.data?.data.length === 0} />
    {result.data && <Table columns={['充值单号 / 用户', '金额', '积分', '支付方式', '状态', '创建时间 / 到账时间', '操作']} label="充值记录">{result.data.data.map(record => <tr key={record.id}>
      <td><Identifier value={record.orderNumber} /><small>{record.ownerName} · {record.email}</small></td><td className="lp-admin-numeric">{formatRechargeAmount(record.amountMinor, record, p.locale)}</td><td className="lp-admin-numeric">{p.n(record.points)}</td>
      <td>{record.paymentMethod ?? '—'}</td><td><Badge value={record.status} /></td><td><DateText value={record.createdAt} /><small><DateText value={record.creditedAt} /></small></td><td><IconAction label="查看充值记录" onClick={() => setSelected(record)}><Eye size={16} /></IconAction></td>
    </tr>)}</Table>}<Pager result={result} input={input} update={update} />
    {editing && config && <RechargeSettingsEditor settings={config} onClose={() => setEditing(false)} onSuccess={() => { setEditing(false); settings.retry(); toast.success('充值规则已保存。'); }} />}
    {selected && <Modal title="充值记录详情" variant="drawer" onClose={() => setSelected(null)}><div className="lp-admin-dialog-body"><Facts rows={[
      ['充值单号', selected.orderNumber], ['用户', `${selected.ownerName} · ${selected.email}`], ['充值金额', formatRechargeAmount(selected.amountMinor, selected, p.locale)],
      ['兑换积分', p.n(selected.points)], ['状态', <Badge value={selected.status} />], ['支付方式', selected.paymentMethod ?? '—'], ['支付流水号', selected.providerTransactionId ?? '—'],
      ['创建时间', <DateText value={selected.createdAt} />], ['付款时间', <DateText value={selected.paidAt} />], ['积分到账时间', <DateText value={selected.creditedAt} />],
    ]} /></div></Modal>}</>;
}

const filters: Record<AdminPage, { value: string; label: string }[]> = {
  dashboard: [], users: [{ value: 'ACTIVE', label: '正常' }, { value: 'DISABLED', label: '已禁用' }],
  numbers: [{ value: 'AVAILABLE', label: '可售' }, { value: 'ASSIGNED', label: '已分配' }, { value: 'UNSELLABLE', label: '不可售' }, { value: 'expiring', label: '3 天内到期' }, { value: 'ACTIVE', label: '服务有效' }, { value: 'LOCAL', label: '本地资源' }, { value: 'ONLINE', label: '在线' }, { value: 'OFFLINE', label: '离线' }, { value: 'ERROR', label: '异常' }],
  products: [{ value: 'ACTIVE', label: '已上架' }, { value: 'INACTIVE', label: '已下架' }],
  projects: [{ value: 'ACTIVE', label: '已启用' }, { value: 'INACTIVE', label: '已停用' }],
  receipts: [{ value: 'IMPORTED', label: '已分发' }, { value: 'UNMATCHED', label: '未匹配用户' }, { value: 'PENDING', label: '待处理' }],
  agents: [{ value: 'ACTIVE', label: '正常' }, { value: 'SUSPENDED', label: '已暂停' }, { value: 'TERMINATED', label: '已终止' }],
  inventory: [{ value: 'ACTIVE', label: '持有中' }, { value: 'SUSPENDED', label: '已暂停' }, { value: 'RETIRED', label: '已退出库存' }],
  recharges: [{ value: 'PENDING', label: '待支付' }, { value: 'SUCCEEDED', label: '已到账' }, { value: 'FAILED', label: '失败' }, { value: 'EXPIRED', label: '已超时' }, { value: 'CANCELLED', label: '已取消' }],
  orders: [{ value: 'COMPLETED', label: '已完成' }, { value: 'PROCESSING', label: '开通处理中' }, { value: 'FAILED', label: '开通失败' }, { value: 'CANCELLED', label: '已取消' }, { value: 'UNVERIFIED', label: '结算待核对' }, { value: 'EXCEPTION', label: '异常订单' }, { value: 'today', label: '今日订单' }],
};
function useList<T extends z.ZodType>(section: string, schema: T, input: Partial<AdminQuery>, revision: number) {
  return useResource(`${section}:${JSON.stringify(input)}`, signal => api.adminList(section, schema, input, { signal }), revision);
}
function Pager({ result, input, update }: { result: { loading: boolean; data: { pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } } | null }; input: Partial<AdminQuery>; update: (key: string, value: string) => void }) {
  const size = input.pageSize === 5 || input.pageSize === 10 ? input.pageSize : 20;
  return <RecordPagination busy={result.loading} page={input.page ?? 1} pageSize={size} totalPages={result.data?.pagination.totalPages ?? 0} totalItems={result.data?.pagination.totalItems ?? 0} controls="lp-admin-records" onPageChange={page => update('page', String(page))} onPageSizeChange={size => update('pageSize', String(size))} />;
}
function UsersList({ input, revision, detail, action, update }: ListProps) {
  const result = useList('users', adminUserSchema, input, revision);
  return <><State {...result} columns={7} empty={result.data?.data.length === 0} />{result.data && <Table columns={['用户', '用户 ID', '角色', '账号状态', '号码 / 订单', '注册时间', '操作']} label="用户管理">{result.data.data.map(u => <tr key={u.id}><td><strong>{u.display_name}</strong><small>{u.email}</small></td><td><Identifier value={u.id} /></td><td><Badge value={u.role} /></td><td><Badge value={u.account_status} /></td><td>{u.number_count} / {u.order_count}</td><td><DateText value={u.created_at} /></td><td><div className="lp-admin-actions"><IconAction label="查看用户" onClick={() => detail({ section: 'users', id: u.id })}><Eye size={16} /></IconAction><ActionButton size="sm" disabled={u.role === 'ADMIN'} onClick={() => action({ kind: 'user', user: u })}>{u.account_status === 'ACTIVE' ? '禁用' : '启用'}</ActionButton></div></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
type ListProps = { input: Partial<AdminQuery>; revision: number; detail: (value: DetailTarget) => void; action: (value: ActionTarget) => void; update: (key: string, value: string) => void };
function NumbersList({ input, revision, detail, action, update }: ListProps) {
  const result = useList('numbers', adminNumberSchema, input, revision);
  return <><p className="lp-admin-context">同一号码按平台分别分配、回收和上下架。</p><State {...result} columns={8} empty={result.data?.data.length === 0} />{result.data && <Table columns={['号码 / 来源', '国家 / 区号', '平台', '资源状态', '销售状态', '所属用户', '用户服务到期 / 资源到期', '操作']} label="号码管理">{result.data.data.map(n => <tr key={n.id}><td><strong className="lp-admin-mono">{n.phone_number}</strong><small><Badge value={n.provider === 'pingcode' ? 'PC' : 'DEMO'} /></small></td><td>{n.country}<small>{n.prefix}</small></td><td>{n.service}<small>{n.provider === 'pingcode' ? n.project_name : '演示项目'}</small></td><td><Badge value={n.resource_status} /></td><td><Badge value={n.sale_status} /></td><td>{n.owner_name ?? '未分配'}</td><td><DateText value={n.expires_at} /><small>资源：<DateText value={n.resource_expires_at} /></small></td><td><div className="lp-admin-actions"><IconAction label="查看号码" onClick={() => detail({ section: 'numbers', id: n.id })}><Eye size={16} /></IconAction>{n.assigned_user_id ? <ActionButton size="sm" onClick={() => action({ kind: 'reclaim', number: n })}>回收</ActionButton> : <><ActionButton size="sm" disabled={n.sale_status !== 'AVAILABLE'} onClick={() => action({ kind: 'assign', number: n })}>分配</ActionButton><ActionButton size="sm" onClick={() => action({ kind: 'sale', number: n })}>{n.sale_enabled ? '下架' : '上架'}</ActionButton></>}</div></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function ProductsList({ input, revision, update, edit }: Pick<ListProps, 'input' | 'revision' | 'update'> & { edit: (product: AdminProduct) => void }) {
  const result = useList('products', adminProductSchema, input, revision);
  return <><p className="lp-admin-context">演示库存与 PC 库存分别统计；PC 同步尚未接入。</p><State {...result} columns={8} empty={result.data?.data.length === 0} />{result.data && <Table columns={['商品 / 套餐标识', '国家 / 平台', '号段 / 能力', '服务天数', '价格', '演示可售 / PC 可用', '状态', '操作']} label="商品管理">{result.data.data.map(o => <tr key={`${o.region_id}/${o.service}/${o.plan}`}><td><strong>{o.name}</strong><small>{o.plan}</small></td><td>{o.country}<small>{o.service}</small><small>{o.pc_project_name ? `PC：${o.pc_project_name}` : 'PC 未绑定'}</small></td><td>{o.area_prefix || '全部号段'}<small>仅接收</small></td><td>{o.duration_days} 天</td><td>{o.unit_points} 积分</td><td><strong>{o.available_count}</strong><small>PC {o.pc_available_count}</small></td><td><Badge value={o.is_active ? 'AVAILABLE' : 'UNSELLABLE'} /></td><td><IconAction label="编辑商品" onClick={() => edit(o)}><Pencil size={16} /></IconAction></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function OrdersList({ input, revision, update, detail }: Pick<ListProps, 'input' | 'revision' | 'update' | 'detail'>) {
  const result = useList('orders', adminOrderSchema, input, revision);
  return <><p className="lp-admin-context">订单通过积分结算，结算与号码交付分别展示。</p><State {...result} columns={7} empty={result.data?.data.length === 0} />{result.data && <OrderTable orders={result.data.data} onDetail={id => detail({ section: 'orders', id })} />}<Pager result={result} input={input} update={update} /></>;
}
function ProjectsList({ input, revision, update }: Pick<ListProps, 'input' | 'revision' | 'update'>) {
  const result = useList('projects', adminProjectSchema, input, revision);
  return <><p className="lp-admin-context">PC 同步未接入。以下为本地已保存的平台配置。</p><State {...result} columns={6} empty={result.data?.data.length === 0} />{result.data && <Table columns={['平台名称', '来源', '项目 ID', '配置状态', '已入库号码', '保存时间']} label="平台项目">{result.data.data.map(item => <tr key={`${item.provider}/${item.external_project_id}`}><td><strong>{item.platform_name}</strong><small>{item.project_name}</small></td><td><Badge value={item.provider === 'pingcode' ? 'PC' : 'DEMO'} /></td><td><Identifier value={item.external_project_id} /></td><td><Badge value={item.is_active ? 'PROJECT_ACTIVE' : 'PROJECT_INACTIVE'} /></td><td>{item.number_count}</td><td><DateText value={item.synced_at} /></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function ReceiptsList({ input, revision, update }: Pick<ListProps, 'input' | 'revision' | 'update'>) {
  const result = useList('receipts', adminReceiptSchema, input, revision);
  const [selected, setSelected] = useState<AdminReceipt | null>(null);
  const queryKey = JSON.stringify(input);
  useEffect(() => setSelected(null), [queryKey, revision]);
  const receiptStatus = (status: string) => status === 'PENDING' ? 'RECEIPT_PENDING' : status;
  const failureReason = (reason: string | null) => reason === 'No unique number/platform service at original reception time' ? '未找到短信接收时对应的号码、平台和用户服务。' : reason ?? '—';
  return <><p className="lp-admin-context">正式 PC 短信回调未接入。以下仅展示已入库的接收记录。</p><State {...result} columns={7} empty={result.data?.data.length === 0} />{result.data && <Table columns={['LP 收到时间', '号码 / 平台', '来源', '短信 ID', '处理结果', '推送次数', '操作']} label="收信记录">{result.data.data.map(item => <tr key={`${item.provider}/${item.external_message_id}`}><td><DateText value={item.recorded_at} /></td><td><strong>{item.phone_number ?? '号码待绑定'}</strong><small>{item.platform ?? '平台待匹配'} · {item.owner_name ?? '未匹配用户'}</small></td><td><Badge value={item.provider === 'pingcode' ? 'PC' : 'DEMO'} /></td><td><Identifier value={item.external_message_id} /></td><td><Badge value={receiptStatus(item.processing_status)} /></td><td>{item.delivery_count > 0 ? `${item.delivery_count} 次` : '未记录'}</td><td><IconAction label="查看收信记录" onClick={() => setSelected(item)}><Eye size={16} /></IconAction></td></tr>)}</Table>}<Pager result={result} input={input} update={update} />{selected && <Modal title="收信记录详情" variant="drawer" onClose={() => setSelected(null)}><div className="lp-admin-dialog-body"><Facts rows={[
    ['来源', <Badge value={selected.provider === 'pingcode' ? 'PC' : 'DEMO'} />], ['处理结果', <Badge value={receiptStatus(selected.processing_status)} />],
    ['短信 ID', <Identifier value={selected.external_message_id} />], ['最近事件 ID', selected.event_id ? <Identifier value={selected.event_id} /> : '未记录'],
    ['号码', selected.phone_number ?? '待绑定'], ['平台', selected.platform ?? '待匹配'], ['用户', selected.owner_name ?? '未匹配用户'], ['发信方', selected.sender ?? '—'],
    ['PC 项目 ID', selected.external_project_id ?? '—'], ['上游号码 ID', selected.external_number_id ?? '—'],
    ['短信接收时间', <DateText value={selected.sms_received_at} />], ['LP 收到时间', <DateText value={selected.recorded_at} />],
    ['处理时间', <DateText value={selected.processed_at} />], ['推送次数', selected.delivery_count], ['异常原因', failureReason(selected.failure_reason)],
  ]} /><h3>短信正文 · 最多 1000 字</h3><p className="lp-admin-message-body">{selected.body ?? '无正文记录'}</p></div></Modal>}</>;
}
type AgentListProps = { revision: number };
function AgentsList({ revision }: AgentListProps) {
  const result = useResource(`agents:${revision}`, signal => api.agentAgents({ signal }), revision);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<'agent' | 'customer' | null>(null);
  return <><div className="lp-admin-section-heading"><p className="lp-admin-context">代理层级与状态；余额、号码库存与流水在「代理库存」页按主体查看。</p><div className="lp-admin-actions"><ActionButton variant="accent" onClick={() => setEditor('agent')}><Plus size={16} />创建代理</ActionButton><ActionButton onClick={() => setEditor('customer')}><Plus size={16} />创建客户</ActionButton></div></div><State {...result} columns={6} empty={result.data?.data.length === 0} />
    {result.data && <Table columns={['代理名称', '层级', '上级代理', '状态', '创建时间', '操作']} label="代理管理">{result.data.data.map(a => <tr key={a.id}>
      <td><strong>{a.name}</strong></td><td>L{a.level}</td><td>{a.parentAgentId ? <button className="lp-admin-text-button lp-admin-mono" onClick={() => setSelected(a.parentAgentId!)}>{result.data!.data.find(x => x.id === a.parentAgentId)?.name ?? a.parentAgentId}</button> : '顶层'}</td>
      <td><Badge value={a.status} /></td><td><DateText value={a.createdAt} /></td>
      <td><IconAction label="查看余额流水" onClick={() => setSelected(a.id)}><Eye size={16} /></IconAction></td>
    </tr>)}</Table>}
    {selected && <LedgerDrawer ownerType="AGENT" ownerId={selected} title="代理余额流水" onClose={() => setSelected(null)} />}
    {editor && <AgentEditor kind={editor} onClose={() => setEditor(null)} onSuccess={() => { setEditor(null); result.retry(); toast.success(editor === 'agent' ? '代理已创建。' : '客户已创建。'); }} />}</>;
}
function AgentEditor({ kind, onClose, onSuccess }: { kind: 'agent' | 'customer'; onClose: () => void; onSuccess: () => void }) {
  const users = useResource('admin-action-users', signal => api.adminList('users', adminUserSchema, { page: 1, pageSize: 20, status: 'ACTIVE' }, { signal }));
  const agents = useResource('admin-action-agents', signal => api.agentAgents({ signal }));
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [parentAgentId, setParentAgentId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligibleUsers = users.data?.data.filter(user => user.role === 'USER') ?? [];
  async function submit() {
    setBusy(true); setError('');
    try {
      if (kind === 'agent') await api.agentCreateAgent({ userId, parentAgentId: parentAgentId || null, name, level: parentAgentId ? 2 : 1 });
      else await api.agentCreateCustomer({ userId, agentId: agentId || null, name });
      onSuccess();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title={kind === 'agent' ? '创建代理' : '创建客户'} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><fieldset disabled={busy} className="lp-admin-form-grid">
    <label className="lp-admin-span">绑定用户<AppCombobox aria-label="绑定用户" value={userId} onValueChange={setUserId} options={[{ value: '', label: users.loading ? '正在加载用户…' : '请选择普通用户' }, ...eligibleUsers.map(user => ({ value: user.id, label: `${user.display_name} · ${user.email}` }))]} /></label>
    <label className="lp-admin-span">主体名称<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'agent' ? '例如：华东代理' : '例如：测试客户'} /></label>
    {kind === 'agent' && <label className="lp-admin-span">上级代理（可选）<AppCombobox aria-label="上级代理" value={parentAgentId} onValueChange={setParentAgentId} options={[{ value: '', label: '顶层代理' }, ...(agents.data?.data ?? []).filter(agent => agent.level === 1 && agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }))]} /></label>}
    {kind === 'customer' && <label className="lp-admin-span">所属代理（可选）<AppCombobox aria-label="所属代理" value={agentId} onValueChange={setAgentId} options={[{ value: '', label: '平台客户' }, ...(agents.data?.data ?? []).filter(agent => agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }))]} /></label>}
    {users.error && <p className="lp-admin-error lp-admin-span">{users.error}</p>}{agents.error && <p className="lp-admin-error lp-admin-span">{agents.error}</p>}{error && <p role="alert" className="lp-admin-error lp-admin-span">{error}</p>}
  </fieldset></div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!userId || !name.trim()}><Check size={16} />确认创建</ActionButton></footer></form></Modal>;
}
function LedgerDrawer({ ownerType, ownerId, title, onClose }: { ownerType: 'AGENT' | 'CUSTOMER'; ownerId: string; title: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const result = useResource(`ledger:${ownerType}:${ownerId}:${page}`, signal => api.agentLedger(ownerType === 'AGENT' ? { ownerType, agentId: ownerId } : { ownerType, customerId: ownerId }, page, 20, { signal }), 0);
  const d = result.data?.data;
  return <Modal title={title} variant="drawer" onClose={onClose}><div className="lp-admin-dialog-body">
    {d && <Facts rows={[['当前余额', `${(d.balanceMinor / 100).toLocaleString()} ${d.currency}`], ['主体', <span className="lp-admin-mono">{ownerId}</span>]]} />}
    <State {...result} columns={5} empty={Boolean(d) && d!.entries.length === 0} />
    {d && d.entries.length > 0 && <Table columns={['时间', '类型', '变动', '变动后余额', '说明']} label="余额流水">{d.entries.map(e => <tr key={e.id}>
      <td><DateText value={e.createdAt} /></td><td>{e.type}</td>
      <td className="lp-admin-numeric" style={{ color: e.delta < 0 ? 'var(--lp-danger, #c0392b)' : undefined }}>{e.delta > 0 ? '+' : ''}{(e.delta / 100).toFixed(2)}</td>
      <td className="lp-admin-numeric">{(e.balanceAfter / 100).toFixed(2)}</td><td>{e.description}</td>
    </tr>)}</Table>}
    <RecordPagination busy={result.loading} page={page} pageSize={20} totalPages={result.data?.pagination.totalPages ?? 0} totalItems={result.data?.pagination.totalItems ?? 0} controls="lp-admin-ledger" onPageChange={setPage} onPageSizeChange={() => {}} />
  </div></Modal>;
}
function StockImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [text, setText] = useState('platformId,externalProjectId,externalNumberId,phoneNumber,regionId,resourceStatus,resourceExpiresAt\\nTelegram,Telegram,local-001,+15551234567,us,LOCAL,');
  const [reason, setReason] = useState('管理员导入本地测试库存');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  function rows() {
    const lines = text.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
    const data = lines[0]?.toLowerCase().startsWith('platformid') ? lines.slice(1) : lines;
    return data.map((line, index) => {
      const parts = line.split(/[,\\t]/).map(value => value.trim());
      return { provider: 'pingcode-mock' as const, platformId: (parts[0] ?? '') as 'Telegram' | 'WhatsApp' | 'Google', externalProjectId: parts[1] ?? '', externalNumberId: parts[2] ?? '', phoneNumber: parts[3] ?? '', regionId: parts[4] ?? '', resourceStatus: (parts[5] || 'LOCAL') as 'LOCAL' | 'ONLINE' | 'OFFLINE' | 'ERROR', resourceExpiresAt: parts[6] ? new Date(parts[6]).toISOString() : null, line: index + 1 };
    });
  }
  async function submit() {
    setBusy(true); setError('');
    try {
      const parsed = rows();
      if (parsed.some(row => !row.platformId || !row.externalProjectId || !row.phoneNumber || !row.regionId)) throw new Error('每行必须填写平台、项目、号码和地区。');
      await api.agentImportStock({ rows: parsed.map(({ line: _line, ...row }) => row), idempotencyKey: globalThis.crypto.randomUUID(), reason });
      onSuccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title="批量导入号码库存（本地 / Mock）" onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <p className="lp-admin-context">每行一条：平台、项目 ID、外部号码 ID、E.164 号码、地区、资源状态、资源到期时间。当前不会调用真实 PC。</p>
    <label>CSV / TSV 数据<Textarea required rows={10} value={text} onChange={event => setText(event.target.value)} disabled={busy} /></label>
    <label>导入原因<Textarea required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
    {error && <p role="alert" className="lp-admin-error">{error}</p>}
  </div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={16} />导入库存</ActionButton></footer></form></Modal>;
}
function StockClaimModal({ stock, onClose, onSuccess }: { stock: { id: string; platformId: 'Telegram' | 'WhatsApp' | 'Google'; phoneNumber: string; resourceExpiresAt: string | null }; onClose: () => void; onSuccess: () => void }) {
  const agents = useResource('stock-claim-agents', signal => api.agentAgents({ signal }));
  const [agentId, setAgentId] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() { setBusy(true); setError(''); try { await api.agentClaimStock({ stockId: stock.id, agentId, startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), service: stock.platformId, idempotencyKey: globalThis.crypto.randomUUID() }); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title="分配号码给代理" onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-confirm-target">{stock.phoneNumber} · {stock.platformId}</p><label>目标代理<AppCombobox aria-label="目标代理" value={agentId} onValueChange={setAgentId} options={[{ value: '', label: agents.loading ? '正在加载代理…' : '请选择代理' }, ...(agents.data?.data ?? []).filter(agent => agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }))]} /></label><label>开始时间<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>到期时间<Input type="datetime-local" required value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>{stock.resourceExpiresAt && <p className="lp-admin-context">资源到期：<DateText value={stock.resourceExpiresAt} /></p>}{error && <p role="alert" className="lp-admin-error">{error}</p>}</div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!agentId}><Check size={15} />确认分配</ActionButton></footer></form></Modal>;
}
function BatchStockClaimModal({ stockIds, onClose, onSuccess }: { stockIds: string[]; onClose: () => void; onSuccess: () => void }) {
  const agents = useResource('stock-claim-agents', signal => api.agentAgents({ signal }));
  const [agentId, setAgentId] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try { await api.agentClaimStockBatch({ stockIds, agentId, startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), idempotencyKey: globalThis.crypto.randomUUID() }); onSuccess(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title="批量分配号码给代理" onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <p className="lp-admin-confirm-target">已选择 {stockIds.length} 个号码</p><p className="lp-admin-context">批量分配采用整批事务：任意号码不可用时，整批不会提交。</p>
    <label>目标代理<AppCombobox aria-label="批量分配目标代理" value={agentId} onValueChange={setAgentId} options={[{ value: '', label: agents.loading ? '正在加载代理…' : '请选择代理' }, ...(agents.data?.data ?? []).filter(agent => agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }))]} /></label>
    <label>开始时间<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>到期时间<Input type="datetime-local" required value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>
    {error && <p role="alert" className="lp-admin-error">{error}</p>}
  </div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!agentId}><Check size={15} />确认批量分配</ActionButton></footer></form></Modal>;
}
function ReleaseHoldingModal({ holdingId, onClose, onSuccess }: { holdingId: string; onClose: () => void; onSuccess: () => void }) {
  const [reason, setReason] = useState('号码回收到本地库存'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() { setBusy(true); setError(''); try { await api.agentReleaseHolding(holdingId, { reason, idempotencyKey: globalThis.crypto.randomUUID() }); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title="释放号码回到库存" onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-warning">释放会结束代理持有记录，并将本地 / Mock 号码重新标记为可分配；不会调用真实 PC。</p><label>操作原因<Textarea required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} /></label>{error && <p role="alert" className="lp-admin-error">{error}</p>}</div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={15} />确认释放</ActionButton></footer></form></Modal>;
}
function ResellHoldingModal({ holding, onClose, onSuccess }: { holding: { id: string; agentId: string | null; phoneNumber: string; startsAt: string; expiresAt: string | null }; onClose: () => void; onSuccess: () => void }) {
  const agents = useResource('stock-resell-agents', signal => api.agentAgents({ signal }));
  const [toAgentId, setToAgentId] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date(holding.startsAt).toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState(() => holding.expiresAt ? new Date(holding.expiresAt).toISOString().slice(0, 16) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() { setBusy(true); setError(''); try { await api.agentResellHolding({ holdingId: holding.id, toAgentId, startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), idempotencyKey: globalThis.crypto.randomUUID() }); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title="转售号码给代理" onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-confirm-target">{holding.phoneNumber}</p><label>目标代理<AppCombobox aria-label="转售目标代理" value={toAgentId} onValueChange={setToAgentId} options={[{ value: '', label: agents.loading ? '正在加载代理…' : '请选择代理' }, ...(agents.data?.data ?? []).filter(agent => agent.status === 'ACTIVE' && agent.id !== holding.agentId).map(agent => ({ value: agent.id, label: agent.name }))]} /></label><label>开始时间<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>到期时间<Input type="datetime-local" required value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label><p className="lp-admin-context">转售不产生支付扣款；当前为本地 / Mock 库存流转。</p>{error && <p role="alert" className="lp-admin-error">{error}</p>}</div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!toAgentId}><Check size={15} />确认转售</ActionButton></footer></form></Modal>;
}
function InventoryPage() {
  const [tab, setTab] = useState<'stock' | 'holdings' | 'balances' | 'prices' | 'transactions'>('stock');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<'holding' | 'adjust' | 'transfer' | null>(null);
  const [stockImport, setStockImport] = useState(false);
  const [selectedStockIds, setSelectedStockIds] = useState<string[]>([]);
  const [batchClaimStock, setBatchClaimStock] = useState(false);
  const [claimStock, setClaimStock] = useState<{ id: string; platformId: 'Telegram' | 'WhatsApp' | 'Google'; phoneNumber: string; resourceExpiresAt: string | null } | null>(null);
  const [releaseHolding, setReleaseHolding] = useState<string | null>(null);
  const [resellHolding, setResellHolding] = useState<{ id: string; agentId: string | null; phoneNumber: string; startsAt: string; expiresAt: string | null } | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const refresh = () => { setSelectedStockIds([]); setRevision(x => x + 1); };
  const stock = useResource(`stock:${revision}:${query}`, signal => api.agentStock(query ? { search: query } : {}, { signal }), revision);
  const holdings = useResource(`holdings:${revision}:${query}`, signal => api.agentHoldings(query ? { search: query } : {}, { signal }), revision);
  const balances = useResource(`balances:${revision}`, signal => api.agentBalances({ signal }), revision);
  const prices = useResource(`prices:${revision}`, signal => api.agentPrices({ signal }), revision);
  const transactions = useResource(`tx:${revision}:${page}`, signal => api.agentTransactions(page, 20, { signal }), revision);
  return <>
    <div className="lp-admin-section-heading"><p className="lp-admin-context">先导入本地 / Mock 号码，再分配给代理；真实充值和 PC 采购尚未接入。</p><div className="lp-admin-actions"><ActionButton variant="accent" onClick={() => setStockImport(true)}><Plus size={16} />批量导入号码</ActionButton><ActionButton variant="accent" disabled={!selectedStockIds.length} onClick={() => setBatchClaimStock(true)}><Users size={16} />批量分配{selectedStockIds.length ? `（${selectedStockIds.length}）` : ''}</ActionButton><ActionButton onClick={() => setAction('holding')}><Plus size={16} />直接录入持有</ActionButton><ActionButton onClick={() => setAction('adjust')}><WalletCards size={16} />调整余额</ActionButton><ActionButton onClick={() => setAction('transfer')}><ArrowUpRight size={16} />转移余额</ActionButton><ActionButton disabled title="供应商采购尚未接入">代理下单（待接入）</ActionButton></div></div>
    <div className="lp-admin-actions" role="tablist" aria-label="代理库存视图">
      {([['stock', '待分配库存'], ['holdings', '代理持有'], ['balances', '余额'], ['prices', '价格'], ['transactions', '交易流水']] as const).map(([key, label]) =>
        <ActionButton key={key} variant={tab === key ? 'accent' : 'outline'} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</ActionButton>)}
      <ActionButton variant="ghost" aria-label="刷新数据" onClick={refresh}><RefreshCw size={16} /></ActionButton>
    </div>
    {(tab === 'stock' || tab === 'holdings') && <form className="lp-admin-toolbar" onSubmit={e => { e.preventDefault(); setPage(1); setSelectedStockIds([]); setQuery(search); }}>
      <AppSearchInput className="lp-admin-search" aria-label="搜索号码" placeholder="搜索号码或主体" maxLength={64} value={search} onValueChange={setSearch}><ActionButton size="sm" type="submit">搜索</ActionButton></AppSearchInput>
    </form>}
    {tab === 'stock' && <><State {...stock} columns={9} empty={stock.data?.data.length === 0} />{stock.data && <Table columns={[<Checkbox aria-label="全选可分配号码" checked={stock.data.data.length > 0 && stock.data.data.filter(item => item.status === 'AVAILABLE').every(item => selectedStockIds.includes(item.id))} onCheckedChange={checked => setSelectedStockIds(checked === true ? stock.data!.data.filter(item => item.status === 'AVAILABLE').map(item => item.id) : [])} />, '号码', '平台 / 项目', '地区', '资源状态', '库存状态', '资源到期', '导入时间', '操作']} label="待分配号码库存">{stock.data.data.map(item => <tr key={item.id}><td><Checkbox aria-label={`选择 ${item.phoneNumber}`} checked={selectedStockIds.includes(item.id)} disabled={item.status !== 'AVAILABLE'} onCheckedChange={checked => setSelectedStockIds(current => checked === true ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))} /></td><td><strong className="lp-admin-mono">{item.phoneNumber}</strong><small>{item.externalNumberId ?? '无外部 ID'}</small></td><td>{item.platformId}<small>{item.externalProjectId}</small></td><td>{item.regionId}</td><td><Badge value={item.resourceStatus} /></td><td><Badge value={item.status} /></td><td><DateText value={item.resourceExpiresAt} /></td><td><DateText value={item.importedAt} /></td><td><ActionButton size="sm" disabled={item.status !== 'AVAILABLE'} onClick={() => setClaimStock(item)}>分配给代理</ActionButton></td></tr>)}</Table>}</>}
    {tab === 'holdings' && <><State {...holdings} columns={7} empty={holdings.data?.data.length === 0} />
      {holdings.data && <Table columns={['号码', '归属类型', '地区', '状态', '取得时间', '来源订单', '操作']} label="号码库存">{holdings.data.data.map(h => <tr key={h.id}>
        <td><strong className="lp-admin-mono">{h.phoneNumber}</strong></td><td>{h.ownerType === 'AGENT' ? '代理' : '客户'}</td><td>{h.regionId}</td>
        <td><Badge value={h.status} /></td><td><DateText value={h.acquiredAt} /></td><td>{h.sourceTxOrderId ? <Identifier value={h.sourceTxOrderId} /> : '—'}</td><td>{h.status === 'ACTIVE' && <div className="lp-admin-actions"><ActionButton size="sm" onClick={() => setResellHolding(h)}>转售</ActionButton><ActionButton size="sm" onClick={() => setReleaseHolding(h.id)}>释放</ActionButton></div>}</td>
      </tr>)}</Table>}</>}
    {tab === 'balances' && <><State {...balances} columns={5} empty={balances.data?.data.length === 0} />
      {balances.data && <Table columns={['主体', '类型', '币种', '余额', '版本']} label="余额">{balances.data.data.map(b => <tr key={b.id}>
        <td><span className="lp-admin-mono">{b.agentId ?? b.customerId}</span></td><td>{b.ownerType === 'AGENT' ? '代理' : '客户'}</td>
        <td>{b.currency}</td><td className="lp-admin-numeric"><strong>{(b.balanceMinor / 100).toLocaleString()}</strong></td><td>{b.version}</td>
      </tr>)}</Table>}</>}
    {tab === 'prices' && <><State {...prices} columns={7} empty={prices.data?.data.length === 0} />
      {prices.data && <Table columns={['定价类型', '地区', '服务', '套餐', '单价', '优先级', '状态']} label="价格">{prices.data.data.map(r => <tr key={r.id}>
        <td>{r.pricingKind === 'WHOLESALE' ? '批发' : '零售'}</td><td>{r.regionId ?? '全部'}</td><td>{r.service}</td><td>{r.plan}</td>
        <td className="lp-admin-numeric">{(r.unitAmountMinor / 100).toFixed(2)} {r.currency}</td><td>{r.priority}</td><td>{r.isActive ? '启用' : '停用'}</td>
      </tr>)}</Table>}</>}
    {tab === 'transactions' && <><State {...transactions} columns={6} empty={transactions.data?.data.length === 0} />
      {transactions.data && <Table columns={['单号', '类型', '买方', '金额', '状态', '创建时间']} label="交易流水">{transactions.data.data.map(t => <tr key={t.id}>
        <td><span className="lp-admin-mono">{t.orderNumber}</span></td><td>{t.kind}</td>
        <td>{t.buyerType === 'AGENT' ? '代理' : '客户'}</td><td className="lp-admin-numeric">{(t.amountMinor / 100).toFixed(2)} {t.currency}</td>
        <td><Badge value={t.status} /></td><td><DateText value={t.createdAt} /></td>
      </tr>)}</Table>}
      <RecordPagination busy={transactions.loading} page={page} pageSize={20} totalPages={transactions.data?.pagination.totalPages ?? 0} totalItems={transactions.data?.pagination.totalItems ?? 0} controls="lp-admin-tx" onPageChange={setPage} onPageSizeChange={() => {}} /></>}
    <p className="lp-admin-context">真实供应商采购尚未接入，因此“代理下单”入口暂时保持禁用，不会伪造成功订单。</p>
    {action && <InventoryAction kind={action} onClose={() => setAction(null)} onSuccess={() => { setAction(null); refresh(); toast.success('操作成功，已刷新代理库存。'); }} />}
    {stockImport && <StockImportModal onClose={() => setStockImport(false)} onSuccess={() => { setStockImport(false); refresh(); toast.success('号码库存已导入。'); }} />}
    {batchClaimStock && <BatchStockClaimModal stockIds={selectedStockIds} onClose={() => setBatchClaimStock(false)} onSuccess={() => { setBatchClaimStock(false); refresh(); toast.success(`已批量分配 ${selectedStockIds.length} 个号码。`); }} />}
    {claimStock && <StockClaimModal stock={claimStock} onClose={() => setClaimStock(null)} onSuccess={() => { setClaimStock(null); refresh(); toast.success('号码已分配给代理。'); }} />}
    {releaseHolding && <ReleaseHoldingModal holdingId={releaseHolding} onClose={() => setReleaseHolding(null)} onSuccess={() => { setReleaseHolding(null); refresh(); toast.success('号码已释放回库存。'); }} />}
    {resellHolding && <ResellHoldingModal holding={resellHolding} onClose={() => setResellHolding(null)} onSuccess={() => { setResellHolding(null); refresh(); toast.success('号码已转售给代理。'); }} />}
  </>;
}
function InventoryAction({ kind, onClose, onSuccess }: { kind: 'holding' | 'adjust' | 'transfer'; onClose: () => void; onSuccess: () => void }) {
  const agents = useResource('admin-inventory-agents', signal => api.agentAgents({ signal }));
  const customers = useResource('admin-inventory-customers', signal => api.agentCustomers({ signal }));
  const [agentId, setAgentId] = useState('');
  const [ownerType, setOwnerType] = useState<'AGENT' | 'CUSTOMER'>('AGENT');
  const [ownerId, setOwnerId] = useState('');
  const [fromType, setFromType] = useState<'AGENT' | 'CUSTOMER'>('AGENT');
  const [fromId, setFromId] = useState('');
  const [toType, setToType] = useState<'AGENT' | 'CUSTOMER'>('CUSTOMER');
  const [toId, setToId] = useState('');
  const [regionId, setRegionId] = useState('us');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [service, setService] = useState('Telegram');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('管理员后台操作');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const agentOptions = (agents.data?.data ?? []).filter(agent => agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }));
  const customerOptions = (customers.data?.data ?? []).filter(customer => customer.status === 'ACTIVE').map(customer => ({ value: customer.id, label: customer.name }));
  const ownerOptions = ownerType === 'AGENT' ? agentOptions : customerOptions;
  const fromOptions = fromType === 'AGENT' ? agentOptions : customerOptions;
  const toOptions = toType === 'AGENT' ? agentOptions : customerOptions;
  const title = kind === 'holding' ? '录入代理库存' : kind === 'adjust' ? '调整主体余额' : '转移主体余额';
  async function submit() {
    setBusy(true); setError('');
    try {
      if (kind === 'holding') await api.agentCreateHolding({ ownerType: 'AGENT', agentId, regionId, phoneNumber, service, startsAt: new Date(startsAt).toISOString(), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, idempotencyKey: globalThis.crypto.randomUUID() });
      else if (kind === 'adjust') {
        const common = { currency: 'USD' as const, direction, amountMinor: Math.round(Number(amount) * 100), reason, idempotencyKey: globalThis.crypto.randomUUID() };
        if (ownerType === 'AGENT') await api.adminAdjustBalance({ ownerType: 'AGENT', agentId: ownerId, ...common });
        else await api.adminAdjustBalance({ ownerType: 'CUSTOMER', customerId: ownerId, ...common });
      } else await api.agentTransfer({ fromOwner: fromType === 'AGENT' ? { ownerType: 'AGENT', agentId: fromId } : { ownerType: 'CUSTOMER', customerId: fromId }, toOwner: toType === 'AGENT' ? { ownerType: 'AGENT', agentId: toId } : { ownerType: 'CUSTOMER', customerId: toId }, currency: 'USD', amountMinor: Math.round(Number(amount) * 100), description: reason, idempotencyKey: globalThis.crypto.randomUUID() });
      onSuccess();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  const valid = kind === 'holding' ? Boolean(agentId && regionId.trim() && phoneNumber.trim() && service.trim()) : kind === 'adjust' ? Boolean(ownerId && Number(amount) > 0 && reason.trim()) : Boolean(fromId && toId && fromId !== toId && Number(amount) > 0 && reason.trim());
  return <Modal title={title} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><fieldset disabled={busy} className="lp-admin-form-grid">
    {kind === 'holding' && <><label className="lp-admin-span">归属代理<AppCombobox aria-label="归属代理" value={agentId} onValueChange={setAgentId} options={[{ value: '', label: agents.loading ? '正在加载代理…' : '请选择代理' }, ...agentOptions]} /></label><label>地区 ID<Input required value={regionId} onChange={event => setRegionId(event.target.value)} /></label><label>平台服务<Input required value={service} onChange={event => setService(event.target.value)} /></label><label className="lp-admin-span">号码<Input required value={phoneNumber} onChange={event => setPhoneNumber(event.target.value)} placeholder="+15551234567" /></label><label>开始时间<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>到期时间<Input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label></>}
    {kind === 'adjust' && <><label>主体类型<AppCombobox aria-label="主体类型" value={ownerType} onValueChange={value => { setOwnerType(value as 'AGENT' | 'CUSTOMER'); setOwnerId(''); }} options={[{ value: 'AGENT', label: '代理' }, { value: 'CUSTOMER', label: '客户' }]} /></label><label>目标主体<AppCombobox aria-label="目标主体" value={ownerId} onValueChange={setOwnerId} options={[{ value: '', label: '请选择主体' }, ...ownerOptions]} /></label><label>方向<AppCombobox aria-label="余额调整方向" value={direction} onValueChange={value => setDirection(value as 'CREDIT' | 'DEBIT')} options={[{ value: 'CREDIT', label: '增加' }, { value: 'DEBIT', label: '扣减' }]} /></label><label>金额（USD）<Input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label><label className="lp-admin-span">操作原因<Textarea required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} /></label></>}
    {kind === 'transfer' && <><label>来源类型<AppCombobox aria-label="来源类型" value={fromType} onValueChange={value => { setFromType(value as 'AGENT' | 'CUSTOMER'); setFromId(''); }} options={[{ value: 'AGENT', label: '代理' }, { value: 'CUSTOMER', label: '客户' }]} /></label><label>来源主体<AppCombobox aria-label="来源主体" value={fromId} onValueChange={setFromId} options={[{ value: '', label: '请选择来源' }, ...fromOptions]} /></label><label>目标类型<AppCombobox aria-label="目标类型" value={toType} onValueChange={value => { setToType(value as 'AGENT' | 'CUSTOMER'); setToId(''); }} options={[{ value: 'AGENT', label: '代理' }, { value: 'CUSTOMER', label: '客户' }]} /></label><label>目标主体<AppCombobox aria-label="目标主体" value={toId} onValueChange={setToId} options={[{ value: '', label: '请选择目标' }, ...toOptions]} /></label><label>金额（USD）<Input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label><label className="lp-admin-span">转移说明<Textarea required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} /></label></>}
    {error && <p role="alert" className="lp-admin-error lp-admin-span">{error}</p>}
  </fieldset></div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!valid}><Check size={16} />确认提交</ActionButton></footer></form></Modal>;
}
function Dashboard({ revision, detail }: { revision: number; detail: (value: DetailTarget) => void }) {
  const result = useResource('summary', signal => api.adminSummary({ signal }), revision);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState<5 | 10 | 20>(5);
  const audit = useList('audit', auditSchema, { page: auditPage, pageSize: auditPageSize }, revision);
  if (!result.data) return result.loading ? <><div className="lp-admin-metrics" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(key => <Card className="lp-admin-metric-skeleton" key={key}><Skeleton /><Skeleton /></Card>)}</div><Card className="lp-admin-section"><State {...result} columns={7} /></Card></> : <State {...result} />;
  const s = result.data.data;
  const metricIcons = [Users, Smartphone, PackageCheck, Clock3, WalletCards, AlertCircle];
  const metrics: { label: string; value: number; page: AdminPage; status?: string; detail?: string }[] = [
    { label: '用户总数', value: s.users, page: 'users' }, { label: '有效号码服务', value: s.activeNumbers, page: 'numbers', status: 'ACTIVE' },
    { label: '可售号码服务', value: s.saleNumbers, page: 'numbers', status: 'AVAILABLE', detail: `PC ${s.pcSaleNumbers} · 演示 ${s.demoSaleNumbers}` }, { label: '3 天内到期', value: s.expiringNumbers, page: 'numbers', status: 'expiring' },
    { label: '今日订单', value: s.todayOrders, page: 'orders', status: 'today' }, { label: '异常或待核对订单', value: s.exceptionOrders, page: 'orders', status: 'EXCEPTION' },
  ];
  return <><State {...result} /><div className="lp-admin-metrics">{metrics.map((m, index) => { const Icon = metricIcons[index]; return <Card className="lp-admin-metric" key={m.label}><a href={adminHref(m.page, m.status ? { status: m.status } : {})}><span>{m.label}</span><Icon size={18} className="lp-admin-metric-icon" aria-hidden="true" /><strong>{m.value.toLocaleString()}</strong>{m.detail && <small>{m.detail}</small>}</a></Card>; })}</div>
    <Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>最近订单</h2><a href={adminHref('orders')}>全部订单 <ArrowUpRight size={14} /></a></div><OrderTable orders={s.recentOrders} onDetail={id => detail({ section: 'orders', id })} />{!s.recentOrders.length && <p className="lp-admin-context">暂无订单</p>}</Card>
    <div className="lp-admin-two-column"><Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>即将到期的服务</h2><a href={adminHref('numbers', { status: 'expiring' })}>查看全部 <ArrowUpRight size={14} /></a></div><Table columns={['号码 / 用户', '客户服务到期']} label="即将到期">{s.expiring.map(n => <tr key={n.id}><td><button className="lp-admin-text-button lp-admin-mono" onClick={() => detail({ section: 'numbers', id: n.id })}>{n.phone_number}</button><small>{n.owner_name} · {n.service}</small></td><td><DateText value={n.expires_at} /></td></tr>)}</Table>{!s.expiring.length && <p className="lp-admin-context">暂无 3 天内到期的服务</p>}</Card>
    <Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>待处理事项</h2></div><a className="lp-admin-task" data-attention={s.exceptionOrders > 0} href={adminHref('orders', { status: 'EXCEPTION' })}><AlertCircle size={18} /><span>异常或待核对订单</span><strong>{s.exceptionOrders}</strong><ArrowUpRight size={15} /></a><a className="lp-admin-task" href={adminHref('projects')}><FolderSync size={18} /><span>PC 号码同步</span><Badge value="NOT_CONNECTED" /><ArrowUpRight size={15} /></a><a className="lp-admin-task" href={adminHref('receipts')}><MessageSquare size={18} /><span>PC 短信回调</span><Badge value="NOT_CONNECTED" /><ArrowUpRight size={15} /></a><p className="lp-admin-context lp-admin-payment-note"><ShieldCheck size={15} />支付及退款：未接入</p></Card></div>
    <Card id="lp-admin-audit" className="lp-admin-section"><div className="lp-admin-section-heading"><h2>管理操作日志</h2><span>审计记录</span></div><State {...audit} columns={5} />{audit.data && <Table columns={['时间', '管理员', '操作', '目标', '原因']} label="管理审计">{audit.data.data.map(a => <tr key={a.id}><td><DateText value={a.created_at} /></td><td>{a.actor_name}</td><td>{({ ADMIN_BOOTSTRAP: '初始化管理员', USER_STATUS: '用户状态', NUMBER_ASSIGN: '分配号码', NUMBER_RECLAIM: '回收号码', NUMBER_SALE: '号码上架状态', PRODUCT_CREATE: '创建商品', PRODUCT_UPDATE: '编辑商品', RECHARGE_SETTINGS: '充值规则' } as Record<string, string>)[a.action] ?? a.action}</td><td><Identifier value={a.target_id} /></td><td className="lp-admin-reason">{a.reason}</td></tr>)}</Table>}<RecordPagination busy={audit.loading} page={auditPage} pageSize={auditPageSize} totalPages={audit.data?.pagination.totalPages ?? 0} totalItems={audit.data?.pagination.totalItems ?? 0} controls="lp-admin-audit" onPageChange={setAuditPage} onPageSizeChange={size => { setAuditPageSize(size); setAuditPage(1); }} /></Card>
  </>;
}
function AdminMain({ user, address, sessionError, retrySession }: { user: User; address: string; sessionError: string; retrySession: () => void }) {
  const p = useDisplayPreferences();
  const path = address.split('?')[0];
  const page: AdminPage = path === '/admin' ? 'dashboard' : path.slice('/admin/'.length) as AdminPage;
  const params = new URLSearchParams(address.split('?')[1] ?? '');
  const parsed = Number(params.get('page'));
  const provider = params.get('provider');
  const pageNumber = Number.isInteger(parsed) && parsed > 0 && parsed <= 100000 ? parsed : 1;
  const input: Partial<AdminQuery> = { page: pageNumber, pageSize: [5, 10, 20].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20, search: params.get('search') ?? '', status: params.get('status') ?? '', ...(regions.some(r => r.value === params.get('region')) ? { region: params.get('region') as AdminQuery['region'] } : {}), ...(params.get('userId') && z.string().uuid().safeParse(params.get('userId')).success ? { userId: params.get('userId')! } : {}), ...(provider === 'pingcode' || provider === 'pingcode-mock' ? { provider } : {}) };
  const [search, setSearch] = useState(input.search ?? '');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [product, setProduct] = useState<AdminProduct | null | undefined>(undefined);
  const { pending } = useAdminActivity();
  const refreshLock = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => { if (pending > 0) refreshLock.current = false; }, [pending]);
  useEffect(() => { setSearch(new URLSearchParams(address.split('?')[1]).get('search') ?? ''); setDetail(null); setAction(null); setProduct(undefined); document.title = `${adminTitles[page]} · LINEPOOL Admin`; }, [address, page]);
  function update(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); navigate(`${path}${next.size ? `?${next}` : ''}`); }
  function success() { setAction(null); setProduct(undefined); setRevision(x => x + 1); toast.success('操作成功，已记录审计日志。'); }
  async function logout() { setLoggingOut(true); try { await api.logout(); navigate('/login'); } catch (cause) { toast.error(errorMessage(cause)); } finally { setLoggingOut(false); } }
  function refresh() { if (pending || refreshLock.current) return; refreshLock.current = true; setRevision(x => x + 1); }
  const listProps = { input, revision, detail: setDetail, action: setAction, update };
  return <TooltipProvider delayDuration={300}><SidebarProvider className="lp-admin lp-admin-theme" data-theme={p.theme}>
    <AdminSidebar page={page} />
    <div className="lp-admin-main"><header className="lp-admin-header"><div className="lp-admin-header-leading"><AdminTooltip label="展开 / 收起导航" side="bottom"><SidebarTrigger className="lp-admin-button lp-admin-sidebar-trigger" aria-label="展开 / 收起导航" /></AdminTooltip><nav className="lp-admin-breadcrumb" aria-label="面包屑"><span>平台管理</span><span aria-hidden="true">/</span><span aria-current="page">{adminTitles[page]}</span></nav></div><div className="lp-admin-header-actions"><AdminTooltip label="刷新数据"><span><ActionButton variant="ghost" aria-label="刷新数据" aria-busy={pending > 0} disabled={pending > 0} onClick={refresh}><RefreshCw size={16} className={pending > 0 ? 'lp-admin-spin' : ''} /><span className="lp-admin-refresh-label">{pending > 0 ? '正在刷新…' : '刷新数据'}</span></ActionButton></span></AdminTooltip><AdminAccountMenu user={user} logout={() => void logout()} busy={loggingOut} /></div></header>
    <main className="lp-admin-content" aria-busy={pending > 0}>{sessionError && <div className="lp-admin-refresh-error" role="alert"><AlertCircle size={16} /><p>权限复核失败：{sessionError}</p><ActionButton onClick={retrySession}>重试</ActionButton></div>}<div key={page} className="lp-admin-page"><div className="lp-admin-page-heading"><h1>{adminTitles[page]}</h1><div className="lp-admin-actions">{page === 'products' && <ActionButton variant="accent" onClick={() => setProduct(null)}><Plus size={16} />创建商品</ActionButton>}</div></div>
      {page !== 'dashboard' && !['agents', 'inventory'].includes(page) && <form className="lp-admin-toolbar" onSubmit={e => { e.preventDefault(); update('search', search); }}><AppSearchInput className="lp-admin-search" aria-label="搜索管理记录" placeholder={page === 'users' ? '搜索用户名、邮箱或用户 ID' : page === 'numbers' ? '搜索号码、平台或用户' : page === 'products' ? '搜索商品名称、平台或套餐标识' : page === 'projects' ? '搜索平台名称或项目 ID' : page === 'receipts' ? '搜索短信 ID、号码、平台或用户' : '搜索订单或用户'} maxLength={200} value={search} onValueChange={setSearch}><ActionButton size="sm" type="submit">搜索</ActionButton></AppSearchInput><SelectField aria-label="状态筛选" value={input.status ?? ''} onValueChange={v => update('status', v)} options={[{ value: '', label: '全部状态' }, ...filters[page]]} />{['numbers', 'projects', 'receipts'].includes(page) && <SelectField aria-label="来源筛选" value={input.provider ?? ''} onValueChange={v => update('provider', v)} options={[{ value: '', label: '全部来源' }, { value: 'pingcode', label: 'PC' }, { value: 'pingcode-mock', label: '演示' }]} />}{['numbers', 'products'].includes(page) && <AppCombobox aria-label="国家筛选" value={input.region ?? ''} onValueChange={v => update('region', v)} options={[{ value: '', label: '全部国家' }, ...regions]} />}{input.userId && <ActionButton size="sm" onClick={() => update('userId', '')}><X size={14} />清除用户筛选</ActionButton>}</form>}
      <Card className={page === 'dashboard' ? 'lp-admin-records-dashboard' : 'lp-admin-records-card'} id="lp-admin-records">{page === 'dashboard' ? <Dashboard revision={revision} detail={setDetail} /> : page === 'users' ? <UsersList {...listProps} /> : page === 'numbers' ? <NumbersList {...listProps} /> : page === 'products' ? <ProductsList {...listProps} edit={setProduct} /> : page === 'projects' ? <ProjectsList {...listProps} /> : page === 'receipts' ? <ReceiptsList {...listProps} /> : page === 'recharges' ? <RechargesList {...listProps} /> : page === 'agents' ? <AgentsList revision={revision} /> : page === 'inventory' ? <InventoryPage /> : <OrdersList {...listProps} />}</Card>
    </div></main></div>{detail && <Detail target={detail} onClose={() => setDetail(null)} />}{action && <ConfirmAction target={action} onClose={() => setAction(null)} onSuccess={success} />}{product !== undefined && <ProductEditor product={product} onClose={() => setProduct(undefined)} onSuccess={success} />}
    <Toaster theme={p.theme === 'dark' ? 'dark' : 'light'} closeButton position="bottom-right" className="lp-admin-toaster" toastOptions={{ className: 'lp-admin-toast' }} />
  </SidebarProvider></TooltipProvider>;
}
function AdminAccess({ address }: { address: string }) {
  const p = useDisplayPreferences();
  const result = useResource('admin-session', signal => api.adminSession({ signal }), address);
  useEffect(() => {
    if (!result.data) return;
    // Recheck database permissions on return to the tab and after a rejected admin request.
    const recheck = () => result.retry();
    window.addEventListener('focus', recheck);
    window.addEventListener('linepool-admin-access-denied', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      window.removeEventListener('linepool-admin-access-denied', recheck);
    };
  }, [Boolean(result.data)]);
  if (result.errorCode === 'ADMIN_REQUIRED' || (result.data && result.data.data.role !== 'ADMIN')) return <main className="lp-admin-access" data-theme={p.theme}><ShieldCheck size={32} /><h1>403 · 无管理后台访问权限</h1><p>当前账号无法访问管理后台。</p><a href="/app">返回工作台</a></main>;
  if (!result.data) return <main className="lp-admin-access" data-theme={p.theme}><a href="/">LINEPOOL</a><State {...result} /></main>;
  return <AdminActivityProvider><AdminMain user={result.data.data} address={address} sessionError={result.error} retrySession={result.retry} /></AdminActivityProvider>;
}
export default function AdminShell({ address }: { address: string }) {
  // Revalidate on navigation without unmounting the authenticated layout.
  return <AdminAccess address={address} />;
}
