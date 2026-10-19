import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { AlertCircle, ArrowUpRight, Check, Eye, LayoutDashboard, LogOut, Menu, Moon, Sun, Pencil, Plus, RefreshCw, Search, ShieldCheck, ShoppingBag, Smartphone, Users, WalletCards, X } from 'lucide-react';
import { adminUserSchema, adminNumberSchema, adminProductSchema, adminOrderSchema, auditSchema,
  type AdminUser, type AdminNumber, type AdminProduct, type AdminOrder, type Allocation, type ProductInput, type AdminQuery } from '@linepool/contracts/admin';
import type { User } from '../api/contracts';
import { createLinepoolApi, LinepoolApiError } from '../api/client';
import { ActionButton as BaseActionButton, type ActionButtonProps } from '../components';
import { StatusPill } from '../../vendor/beautiful/src/components/atoms/StatusPill';
import SelectField from '../SelectField';
import UserAvatar from '../UserAvatar';
import RecordPagination from '../workspace-reference/RecordPagination';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { navigate } from '../../app/router';
import { adminHref, adminPages, adminTitles, type AdminPage } from './navigation';
import './admin.css';

const api = createLinepoolApi();
const regions = [{ value: 'us', label: '美国' }, { value: 'gb', label: '英国' }, { value: 'ca', label: '加拿大' }, { value: 'sg', label: '新加坡' }, { value: 'de', label: '德国' }, { value: 'nl', label: '荷兰' }];
const statusLabels: Record<string, string> = {
  ACTIVE: '正常', DISABLED: '已禁用', USER: '普通用户', ADMIN: '平台管理员',
  AVAILABLE: '可售', ASSIGNED: '已分配', UNSELLABLE: '不可售', LOCAL: '本地资源', ONLINE: '在线', OFFLINE: '离线', ERROR: '异常',
  COMPLETED: '已完成', PROCESSING: '处理中', FAILED: '失败', CANCELLED: '已取消', UNVERIFIED: '待核对',
  POINTS_DEBITED: '积分已扣除', NOT_CONFIGURED: '未接入支付', PENDING: '待支付', CONFIRMED: '已确认', PENDING_REVIEW: '待处理', UNKNOWN: '待核对',
};
function errorMessage(cause: unknown) {
  if (cause instanceof z.ZodError) return '请检查必填内容、数值范围和操作原因。';
  if (!(cause instanceof LinepoolApiError)) return '操作失败，请重试。';
  if (cause.status === 401) navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`, true);
  if (cause.status === 403 && cause.code === 'ADMIN_REQUIRED') window.dispatchEvent(new Event('linepool-admin-access-denied'));
  const labels: Record<string, string> = { ADMIN_REQUIRED: '当前账号没有平台管理员权限。', ACCOUNT_DISABLED: '账号已被禁用。',
    NUMBER_ASSIGNED: '号码已被分配，不能重复分配或上架。', OWNERSHIP_CHANGED: '号码归属已变化，请刷新后重试。',
    RESOURCE_UNAVAILABLE: '号码资源当前不可用。', USER_UNAVAILABLE: '目标用户不存在或已禁用。',
    ADMIN_PROTECTED: '不能在此禁用管理员账号。', PRODUCT_EXISTS: '相同地区、服务与套餐标识的商品已存在。',
    VALIDATION_ERROR: '提交内容不符合要求。', REQUEST_TIMEOUT: '请求超时，请刷新核对操作结果后再试。',
    NETWORK_ERROR: '无法连接服务，请重试。', NOT_FOUND: '记录不存在或已变化。', ORIGIN_REJECTED: '当前访问地址未获服务授权。' };
  return labels[cause.code] ?? (cause.status === 429 ? '请求过于频繁，请稍后重试。' : cause.status >= 500 ? '服务暂时不可用，请重试。' : cause.message);
}
function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string; errorCode: string }>({ data: null, loading: true, error: '', errorCode: '' });
  const [version, setVersion] = useState(0);
  const loader = useRef(load); loader.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: true, error: '', errorCode: '' });
    void loader.current(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: '', errorCode: '' });
    }).catch(cause => { if (!controller.signal.aborted) setState({ data: null, loading: false, error: errorMessage(cause), errorCode: cause instanceof LinepoolApiError ? cause.code : '' }); });
    return () => controller.abort();
  }, [key, version]);
  return { ...state, retry: () => setVersion(value => value + 1) };
}
function State({ loading, error, retry, empty = false }: { loading: boolean; error: string; retry: () => void; empty?: boolean }) {
  if (loading) return <div className="lp-admin-state" role="status"><span className="lp-admin-skeleton" /><span className="lp-admin-skeleton" /><span>正在加载数据…</span></div>;
  if (error) return <div className="lp-admin-state" role="alert"><AlertCircle size={24} /><p>{error}</p><ActionButton onClick={retry}><RefreshCw size={15} />重新加载</ActionButton></div>;
  return empty ? <div className="lp-admin-state"><Smartphone size={24} /><p>暂无数据</p></div> : null;
}
function ActionButton({ className = '', ...props }: ActionButtonProps) {
  return <BaseActionButton {...props} className={`lp-admin-button h-10 rounded-md text-sm font-medium ${className}`} />;
}
function Badge({ value }: { value: string }) {
  const tone = ['ACTIVE', 'COMPLETED', 'POINTS_DEBITED', 'ONLINE', 'AVAILABLE', 'CONFIRMED'].includes(value) ? 'green' : ['FAILED', 'DISABLED', 'ERROR'].includes(value) ? 'red' : ['PROCESSING', 'PENDING_REVIEW', 'UNKNOWN', 'UNVERIFIED'].includes(value) ? 'orange' : 'neutral';
  return <StatusPill tone={tone} className="max-w-full min-h-6 h-auto gap-1 px-1.5 py-0.5 text-xs leading-normal">{statusLabels[value] ?? value}</StatusPill>;
}
function DateText({ value }: { value: string | null }) {
  const p = useDisplayPreferences();
  return <>{value ? p.date(value, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</>;
}
function Table({ columns, children, label }: { columns: string[]; children: ReactNode; label: string }) {
  return <div className="lp-admin-table-scroll" role="region" aria-label={label} tabIndex={0}><table><thead><tr>{columns.map(name => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
function IconAction({ label, onClick, children, disabled = false }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <ActionButton size="sm" className="lp-admin-icon-button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</ActionButton>;
}
function Modal({ title, onClose, children, busy = false, variant = 'dialog' }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; variant?: 'dialog' | 'drawer' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const p = useDisplayPreferences();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const content = document.querySelector<HTMLElement>('.lp-admin-content');
    const bodyOverflow = document.body.style.overflow;
    const contentOverflow = content?.style.overflow ?? '';
    // Keep one scroll owner inside the overlay; the underlying records stay in place.
    document.body.style.overflow = 'hidden';
    if (content) content.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = bodyOverflow;
      if (content) content.style.overflow = contentOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={`lp-admin-dialog${variant === 'drawer' ? ' lp-admin-drawer' : ''}`} data-theme={p.theme} aria-labelledby={titleId} aria-modal="true"
    onKeyDown={event => {
      if (event.defaultPrevented || event.key !== 'Tab') return;
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    }}
    onClick={event => {
      if (busy || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><IconAction label="关闭" onClick={onClose} disabled={busy}><X size={18} /></IconAction></header>{children}
  </dialog>;
}
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="lp-admin-facts">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}
function AllocationTable({ items }: { items: Allocation[] }) {
  return <Table columns={['号码', '用户', '分配时间', '原服务到期', '归属状态']} label="归属历史"><>{items.map(item => <tr key={item.id}><td>{item.phone_number}</td><td>{item.owner_name}</td><td><DateText value={item.assigned_at} /></td><td><DateText value={item.expires_at} /></td><td>{item.released_at ? <><Badge value="CANCELLED" /><small>回收于 <DateText value={item.released_at} /></small></> : '当前归属'}</td></tr>)}{!items.length && <tr><td colSpan={5}>暂无归属记录</td></tr>}</></Table>;
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
    ['手机号码', n.phone_number], ['内部 ID', <span className="lp-admin-mono">{n.id}</span>], ['国家 / 区号', `${n.country} / ${n.prefix}`], ['服务', n.service],
    ['号码能力', '仅接收'], ['资源状态', <Badge value={n.resource_status} />], ['销售状态', <Badge value={n.sale_status} />],
    ['所属用户', n.owner_name ?? '未分配'], ['客户服务到期', <DateText value={n.expires_at} />], ['通信套餐 / 托管到期', '未接入'],
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
  return <Table columns={['订单 / 用户', '商品', '积分', '结算状态', '开通状态', '创建时间', ...(onDetail ? ['操作'] : [])]} label="订单列表">{orders.map(o => <tr key={o.id}><td><span className="lp-admin-identifier" title={o.order_number}>{o.order_number}</span><small>{o.owner_name}</small></td><td>{o.plan_name}<small>{o.quantity} 个号码 · 已分配 {o.assigned_count}</small></td><td>{o.total_points}</td><td><Badge value={o.payment_status} /></td><td><Badge value={o.fulfillment_status} /></td><td><DateText value={o.created_at} /></td>{onDetail && <td><IconAction label="查看订单" onClick={() => onDetail(o.id)}><Eye size={16} /></IconAction></td>}</tr>)}</Table>;
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
      else if (target.kind === 'assign') await api.adminNumberAction(target.number.id, { action: 'assign', userId, durationDays: Number(days), reason });
      else if (target.kind === 'reclaim') await api.adminNumberAction(target.number.id, { action: 'reclaim', expectedUserId: target.number.assigned_user_id!, expectedAllocationId: target.number.allocation_id!, reason });
      else await api.adminNumberAction(target.number.id, { action: 'sale', saleEnabled: !target.number.sale_enabled, reason });
      onSuccess();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title={title} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-confirm-target">{target.kind === 'user' ? `${target.user.display_name} · ${target.user.email}` : target.number.phone_number}</p>
    {target.kind === 'reclaim' && <p className="lp-admin-warning">将结束当前用户的号码服务。历史归属、订单和短信会保留，号码回收后不会自动上架。</p>}
    {target.kind === 'user' && target.user.account_status === 'ACTIVE' && <p className="lp-admin-warning">禁用后，该用户的登录会话立即失效，号码和订单记录会保留。</p>}
    {target.kind === 'assign' && <><p>人工分配，不创建支付记录、不扣积分。</p><div className="lp-admin-search"><input aria-label="搜索分配用户" placeholder="用户名、邮箱或用户 ID" value={userSearch} onChange={e => setUserSearch(e.target.value)} disabled={busy} /><IconAction label="查找用户" onClick={() => setUserTerm(userSearch)} disabled={busy}><Search size={16} /></IconAction></div>
      <State loading={users.loading} error={users.error} retry={users.retry} />
      <label>目标用户<SelectField aria-label="目标用户" value={userId} disabled={busy || users.loading} onValueChange={setUserId} options={[{ value: '', label: '请选择用户' }, ...(users.data?.data ?? []).map(user => ({ value: user.id, label: `${user.display_name} · ${user.email}` }))]} /></label>
      <label>服务天数<input type="number" min={1} max={365} required value={days} onChange={e => setDays(e.target.value)} disabled={busy} /></label></>}
    <label>操作原因<textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></label>{error && <p role="alert" className="lp-admin-error">{error}</p>}
    </div><footer><ActionButton disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton variant="accent" type="submit" busy={busy} disabled={target.kind === 'assign' && !userId}><Check size={15} />确认{title}</ActionButton></footer></form></Modal>;
}
function ProductEditor({ product, onClose, onSuccess }: { product: AdminProduct | null; onClose: () => void; onSuccess: () => void }) {
  const [value, setValue] = useState<ProductInput>(() => product ? { region: product.region_id, service: product.service, plan: product.plan, name: product.name, durationDays: product.duration_days, unitPoints: product.unit_points, isActive: product.is_active, areaPrefix: product.area_prefix, capability: 'RECEIVE', allowRenewal: false, reason: '' }
    : { region: 'us', service: 'Telegram', plan: '', name: '', durationDays: 30, unitPoints: 15, isActive: false, areaPrefix: '', capability: 'RECEIVE', allowRenewal: false, reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function set<K extends keyof ProductInput>(key: K, next: ProductInput[K]) { setValue(current => ({ ...current, [key]: next })); }
  async function submit() { setBusy(true); setError(''); try { await api.adminSaveProduct(value, !product); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title={product ? '编辑商品' : '创建商品'} busy={busy} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><fieldset disabled={busy} className="lp-admin-form-grid">
    <label className="lp-admin-span">商品名称<input required maxLength={100} value={value.name} onChange={e => set('name', e.target.value)} /></label>
    <label>国家 / 地区<SelectField aria-label="商品国家" disabled={busy || Boolean(product)} value={value.region} onValueChange={v => set('region', v as ProductInput['region'])} options={regions} /></label>
    <label>适用服务<SelectField aria-label="商品服务" disabled={busy || Boolean(product)} value={value.service} onValueChange={v => set('service', v as ProductInput['service'])} options={['Telegram', 'WhatsApp', 'Google'].map(v => ({ value: v, label: v }))} /></label>
    <label>套餐标识<input required pattern="[a-z][a-z0-9_-]{0,31}" maxLength={32} disabled={busy || Boolean(product)} value={value.plan} onChange={e => set('plan', e.target.value)} /></label>
    <label>号段前缀<input maxLength={20} pattern="\+?[0-9]*" placeholder="全部号段" value={value.areaPrefix} onChange={e => set('areaPrefix', e.target.value)} /></label>
    <label>租用天数<input type="number" required min={1} max={365} value={value.durationDays} onChange={e => set('durationDays', Number(e.target.value))} /></label>
    <label>价格（积分 / 个）<input type="number" required min={1} max={1000000} value={value.unitPoints} onChange={e => set('unitPoints', Number(e.target.value))} /></label>
    <div>号码能力<small>仅接收</small></div>
    <label className="lp-admin-checkbox lp-admin-span"><input type="checkbox" checked={value.isActive} onChange={e => set('isActive', e.target.checked)} />上架商品</label>
    <label className="lp-admin-span">操作原因<textarea required minLength={3} maxLength={500} value={value.reason} onChange={e => set('reason', e.target.value)} /></label>
    {error && <p role="alert" className="lp-admin-error lp-admin-span">{error}</p>}
    </fieldset></div><footer><ActionButton disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={16} />保存商品</ActionButton></footer></form></Modal>;
}

const filters: Record<AdminPage, { value: string; label: string }[]> = {
  dashboard: [], users: [{ value: 'ACTIVE', label: '正常' }, { value: 'DISABLED', label: '已禁用' }],
  numbers: [{ value: 'AVAILABLE', label: '可售' }, { value: 'ASSIGNED', label: '已分配' }, { value: 'UNSELLABLE', label: '不可售' }, { value: 'expiring', label: '3 天内到期' }, { value: 'ACTIVE', label: '服务有效' }, { value: 'LOCAL', label: '本地资源' }, { value: 'ONLINE', label: '在线' }, { value: 'OFFLINE', label: '离线' }, { value: 'ERROR', label: '异常' }],
  products: [{ value: 'ACTIVE', label: '已上架' }, { value: 'INACTIVE', label: '已下架' }],
  orders: [{ value: 'COMPLETED', label: '已完成' }, { value: 'PROCESSING', label: '开通处理中' }, { value: 'FAILED', label: '开通失败' }, { value: 'CANCELLED', label: '已取消' }, { value: 'UNVERIFIED', label: '结算待核对' }, { value: 'EXCEPTION', label: '异常订单' }, { value: 'today', label: '今日订单' }],
};
function useList<T extends z.ZodType>(section: string, schema: T, input: Partial<AdminQuery>, revision: number) {
  return useResource(`${section}:${JSON.stringify(input)}:${revision}`, signal => api.adminList(section, schema, input, { signal }));
}
function Pager({ result, input, update }: { result: { loading: boolean; data: { pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } } | null }; input: Partial<AdminQuery>; update: (key: string, value: string) => void }) {
  const size = input.pageSize === 5 || input.pageSize === 10 ? input.pageSize : 20;
  return <RecordPagination busy={result.loading} page={input.page ?? 1} pageSize={size} totalPages={result.data?.pagination.totalPages ?? 0} totalItems={result.data?.pagination.totalItems ?? 0} controls="lp-admin-records" onPageChange={page => update('page', String(page))} onPageSizeChange={size => update('pageSize', String(size))} />;
}
function UsersList({ input, revision, detail, action, update }: ListProps) {
  const result = useList('users', adminUserSchema, input, revision);
  return <><State {...result} empty={result.data?.data.length === 0} />{result.data && <Table columns={['用户', '用户 ID', '角色', '账号状态', '号码 / 订单', '注册时间', '操作']} label="用户管理">{result.data.data.map(u => <tr key={u.id}><td><strong>{u.display_name}</strong><small>{u.email}</small></td><td><span className="lp-admin-identifier" title={u.id}>{u.id}</span></td><td><Badge value={u.role} /></td><td><Badge value={u.account_status} /></td><td>{u.number_count} / {u.order_count}</td><td><DateText value={u.created_at} /></td><td><div className="lp-admin-actions"><IconAction label="查看用户" onClick={() => detail({ section: 'users', id: u.id })}><Eye size={16} /></IconAction><ActionButton size="sm" disabled={u.role === 'ADMIN'} onClick={() => action({ kind: 'user', user: u })}>{u.account_status === 'ACTIVE' ? '禁用' : '启用'}</ActionButton></div></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
type ListProps = { input: Partial<AdminQuery>; revision: number; detail: (value: DetailTarget) => void; action: (value: ActionTarget) => void; update: (key: string, value: string) => void };
function NumbersList({ input, revision, detail, action, update }: ListProps) {
  const result = useList('numbers', adminNumberSchema, input, revision);
  return <><State {...result} empty={result.data?.data.length === 0} />{result.data && <Table columns={['号码 / 标识', '国家 / 区号', '能力 / 服务', '资源状态', '销售状态', '所属用户', '服务到期', '操作']} label="号码管理">{result.data.data.map(n => <tr key={n.id}><td><strong className="lp-admin-mono">{n.phone_number}</strong><small className="lp-admin-identifier" title={n.id}>{n.id}</small></td><td>{n.country}<small>{n.prefix}</small></td><td>仅接收<small>{n.service}</small></td><td><Badge value={n.resource_status} /></td><td><Badge value={n.sale_status} /></td><td>{n.owner_name ?? '未分配'}</td><td><DateText value={n.expires_at} /></td><td><div className="lp-admin-actions"><IconAction label="查看号码" onClick={() => detail({ section: 'numbers', id: n.id })}><Eye size={16} /></IconAction>{n.assigned_user_id ? <ActionButton size="sm" onClick={() => action({ kind: 'reclaim', number: n })}>回收</ActionButton> : <><ActionButton size="sm" onClick={() => action({ kind: 'assign', number: n })}>分配</ActionButton><ActionButton size="sm" onClick={() => action({ kind: 'sale', number: n })}>{n.sale_enabled ? '下架' : '上架'}</ActionButton></>}</div></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function ProductsList({ input, revision, update, edit }: Pick<ListProps, 'input' | 'revision' | 'update'> & { edit: (product: AdminProduct) => void }) {
  const result = useList('products', adminProductSchema, input, revision);
  return <><State {...result} empty={result.data?.data.length === 0} />{result.data && <Table columns={['商品 / 套餐标识', '国家 / 服务', '号段 / 能力', '租用期限', '价格', '可售库存', '状态', '操作']} label="商品管理">{result.data.data.map(o => <tr key={`${o.region_id}/${o.service}/${o.plan}`}><td><strong>{o.name}</strong><small>{o.plan}</small></td><td>{o.country}<small>{o.service}</small></td><td>{o.area_prefix || '全部号段'}<small>仅接收</small></td><td>{o.duration_days} 天</td><td>{o.unit_points} 积分</td><td>{o.available_count}</td><td><Badge value={o.is_active ? 'AVAILABLE' : 'UNSELLABLE'} /></td><td><IconAction label="编辑商品" onClick={() => edit(o)}><Pencil size={16} /></IconAction></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function OrdersList({ input, revision, update, detail }: Pick<ListProps, 'input' | 'revision' | 'update' | 'detail'>) {
  const result = useList('orders', adminOrderSchema, input, revision);
  return <><p className="lp-admin-context">订单通过积分结算，结算与号码交付分别展示。</p><State {...result} empty={result.data?.data.length === 0} />{result.data && <OrderTable orders={result.data.data} onDetail={id => detail({ section: 'orders', id })} />}<Pager result={result} input={input} update={update} /></>;
}
function Dashboard({ revision, detail }: { revision: number; detail: (value: DetailTarget) => void }) {
  const result = useResource(`summary:${revision}`, signal => api.adminSummary({ signal }));
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState<5 | 10 | 20>(5);
  const audit = useList('audit', auditSchema, { page: auditPage, pageSize: auditPageSize }, revision);
  if (!result.data) return <State {...result} />;
  const s = result.data.data;
  const metrics: { label: string; value: number; page: AdminPage; status?: string }[] = [
    { label: '用户总数', value: s.users, page: 'users' }, { label: '有效号码', value: s.activeNumbers, page: 'numbers', status: 'ACTIVE' },
    { label: '可售号码', value: s.saleNumbers, page: 'numbers', status: 'AVAILABLE' }, { label: '3 天内到期', value: s.expiringNumbers, page: 'numbers', status: 'expiring' },
    { label: '今日订单', value: s.todayOrders, page: 'orders', status: 'today' }, { label: '异常或待核对订单', value: s.exceptionOrders, page: 'orders', status: 'EXCEPTION' },
  ];
  return <><div className="lp-admin-metrics">{metrics.map(m => <a key={m.label} href={adminHref(m.page, m.status ? { status: m.status } : {})}><span>{m.label}<ArrowUpRight size={14} /></span><strong>{m.value.toLocaleString()}</strong></a>)}</div>
    <section className="lp-admin-section"><div className="lp-admin-section-heading"><h2>最近订单</h2><a href={adminHref('orders')}>全部订单 <ArrowUpRight size={14} /></a></div><OrderTable orders={s.recentOrders} onDetail={id => detail({ section: 'orders', id })} />{!s.recentOrders.length && <p className="lp-admin-context">暂无订单</p>}</section>
    <div className="lp-admin-two-column"><section className="lp-admin-section"><div className="lp-admin-section-heading"><h2>即将到期的服务</h2><a href={adminHref('numbers', { status: 'expiring' })}>查看全部 <ArrowUpRight size={14} /></a></div><Table columns={['号码 / 用户', '客户服务到期']} label="即将到期">{s.expiring.map(n => <tr key={n.id}><td><button className="lp-admin-text-button" onClick={() => detail({ section: 'numbers', id: n.id })}>{n.phone_number}</button><small>{n.owner_name}</small></td><td><DateText value={n.expires_at} /></td></tr>)}</Table>{!s.expiring.length && <p className="lp-admin-context">暂无 3 天内到期的服务</p>}</section>
    <section className="lp-admin-section"><div className="lp-admin-section-heading"><h2>待处理事项</h2></div><a className="lp-admin-task" href={adminHref('orders', { status: 'EXCEPTION' })}><AlertCircle size={18} /><span>异常或待核对订单</span><strong>{s.exceptionOrders}</strong><ArrowUpRight size={15} /></a><p className="lp-admin-context">支付及退款：未接入</p></section></div>
    <section id="lp-admin-audit" className="lp-admin-section"><div className="lp-admin-section-heading"><h2>管理操作日志</h2><span>审计记录</span></div><State {...audit} />{audit.data && <Table columns={['时间', '管理员', '操作', '目标', '原因']} label="管理审计">{audit.data.data.map(a => <tr key={a.id}><td><DateText value={a.created_at} /></td><td>{a.actor_name}</td><td>{({ ADMIN_BOOTSTRAP: '初始化管理员', USER_STATUS: '用户状态', NUMBER_ASSIGN: '分配号码', NUMBER_RECLAIM: '回收号码', NUMBER_SALE: '号码上架状态', PRODUCT_CREATE: '创建商品', PRODUCT_UPDATE: '编辑商品' } as Record<string, string>)[a.action] ?? a.action}</td><td><span className="lp-admin-identifier" title={a.target_id}>{a.target_id}</span></td><td className="lp-admin-reason">{a.reason}</td></tr>)}</Table>}<RecordPagination busy={audit.loading} page={auditPage} pageSize={auditPageSize} totalPages={audit.data?.pagination.totalPages ?? 0} totalItems={audit.data?.pagination.totalItems ?? 0} controls="lp-admin-audit" onPageChange={setAuditPage} onPageSizeChange={size => { setAuditPageSize(size); setAuditPage(1); }} /></section>
  </>;
}
function AdminMain({ user, address }: { user: User; address: string }) {
  const p = useDisplayPreferences();
  const path = address.split('?')[0];
  const page: AdminPage = path === '/admin' ? 'dashboard' : path.slice('/admin/'.length) as AdminPage;
  const params = new URLSearchParams(address.split('?')[1] ?? '');
  const parsed = Number(params.get('page'));
  const pageNumber = Number.isInteger(parsed) && parsed > 0 && parsed <= 100000 ? parsed : 1;
  const input: Partial<AdminQuery> = { page: pageNumber, pageSize: [5, 10, 20].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20, search: params.get('search') ?? '', status: params.get('status') ?? '', ...(regions.some(r => r.value === params.get('region')) ? { region: params.get('region') as AdminQuery['region'] } : {}), ...(params.get('userId') && z.string().uuid().safeParse(params.get('userId')).success ? { userId: params.get('userId')! } : {}) };
  const [search, setSearch] = useState(input.search ?? '');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [product, setProduct] = useState<AdminProduct | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [mobile, setMobile] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => { setSearch(new URLSearchParams(address.split('?')[1]).get('search') ?? ''); setMobile(false); setDetail(null); setAction(null); setProduct(undefined); document.title = `${adminTitles[page]} · LINEPOOL Admin`; }, [address, page]);
  function update(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); navigate(`${path}${next.size ? `?${next}` : ''}`); }
  function success() { setAction(null); setProduct(undefined); setRevision(x => x + 1); setNotice('操作成功，已记录审计日志。'); }
  async function logout() { setLoggingOut(true); try { await api.logout(); navigate('/login'); } catch (cause) { setNotice(errorMessage(cause)); } finally { setLoggingOut(false); } }
  const icons = { dashboard: LayoutDashboard, users: Users, numbers: Smartphone, products: ShoppingBag, orders: WalletCards };
  const listProps = { input, revision, detail: setDetail, action: setAction, update };
  return <div className="lp-admin" data-theme={p.theme}>
    <aside className="lp-admin-sidebar"><a className="lp-admin-brand" href="/admin">LINEPOOL<span>ADMIN</span></a><div className="lp-admin-sidebar-label">平台管理</div><nav aria-label="后台导航">{adminPages.map(item => { const Icon = icons[item]; return <a key={item} href={adminHref(item)} aria-current={page === item ? 'page' : undefined}><Icon size={18} /><span>{adminTitles[item]}</span></a>; })}</nav></aside>
    <div className="lp-admin-main"><header className="lp-admin-header"><div className="lp-admin-breadcrumb">平台管理<span>/</span>{adminTitles[page]}</div><div className="lp-admin-header-actions"><IconAction label={p.theme === 'dark' ? '浅色模式' : '深色模式'} onClick={p.toggleTheme}>{p.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</IconAction><span className="lp-admin-admin-badge"><ShieldCheck size={15} />平台管理员</span><UserAvatar name={user.displayName} /><span className="lp-admin-admin-name">{user.displayName}</span><IconAction label="退出登录" onClick={() => void logout()} disabled={loggingOut}><LogOut size={17} /></IconAction></div></header>
    <div className="lp-admin-mobile-nav"><IconAction label={mobile ? '收起后台导航' : '展开后台导航'} onClick={() => setMobile(!mobile)}>{mobile ? <X size={18} /> : <Menu size={18} />}</IconAction><strong>{adminTitles[page]}</strong></div>
    {mobile && <nav className="lp-admin-mobile-links" aria-label="移动后台导航">{adminPages.map(item => <a key={item} aria-current={page === item ? 'page' : undefined} href={adminHref(item)}>{adminTitles[item]}</a>)}</nav>}
    <main className="lp-admin-content"><div className="lp-admin-page-heading"><div><p>LINEPOOL / PLATFORM</p><h1>{adminTitles[page]}</h1></div><div className="lp-admin-actions">{page === 'products' && <ActionButton variant="accent" onClick={() => setProduct(null)}><Plus size={16} />创建商品</ActionButton>}<IconAction label="刷新数据" onClick={() => setRevision(x => x + 1)}><RefreshCw size={16} /></IconAction></div></div>
      {notice && <div className="lp-admin-feedback" role="status"><span>{notice}</span><IconAction label="关闭提示" onClick={() => setNotice('')}><X size={14} /></IconAction></div>}
      {page !== 'dashboard' && <form className="lp-admin-toolbar" onSubmit={e => { e.preventDefault(); update('search', search); }}><div className="lp-admin-search"><Search size={17} /><input aria-label="搜索管理记录" placeholder={page === 'users' ? '搜索用户名、邮箱或用户 ID' : page === 'numbers' ? '搜索号码、号码 ID 或用户' : page === 'products' ? '搜索商品名称、服务或套餐标识' : '搜索订单、号码或用户'} maxLength={200} value={search} onChange={e => setSearch(e.target.value)} /><ActionButton size="sm" type="submit">搜索</ActionButton></div><SelectField aria-label="状态筛选" value={input.status ?? ''} onValueChange={v => update('status', v)} options={[{ value: '', label: '全部状态' }, ...filters[page]]} />{['numbers', 'products'].includes(page) && <SelectField aria-label="国家筛选" value={input.region ?? ''} onValueChange={v => update('region', v)} options={[{ value: '', label: '全部国家' }, ...regions]} />}{input.userId && <ActionButton size="sm" onClick={() => update('userId', '')}><X size={14} />清除用户筛选</ActionButton>}</form>}
      <div id="lp-admin-records">{page === 'dashboard' ? <Dashboard revision={revision} detail={setDetail} /> : page === 'users' ? <UsersList {...listProps} /> : page === 'numbers' ? <NumbersList {...listProps} /> : page === 'products' ? <ProductsList {...listProps} edit={setProduct} /> : <OrdersList {...listProps} />}</div>
    </main></div>{detail && <Detail target={detail} onClose={() => setDetail(null)} />}{action && <ConfirmAction target={action} onClose={() => setAction(null)} onSuccess={success} />}{product !== undefined && <ProductEditor product={product} onClose={() => setProduct(undefined)} onSuccess={success} />}
  </div>;
}
function AdminAccess({ address }: { address: string }) {
  const p = useDisplayPreferences();
  const result = useResource('admin-session', signal => api.adminSession({ signal }));
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
  return <AdminMain user={result.data.data} address={address} />;
}
export default function AdminShell({ address }: { address: string }) {
  // Every admin navigation must pass the server guard before rendering management controls.
  return <AdminAccess key={address} address={address} />;
}
