import { isStorefrontRegion } from '@linepool/contracts';
import { Fragment, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, Clock3, Eye, FolderSync, Home, MessageSquare, PackageCheck, Pencil, Plus, RefreshCw, Search, ShieldCheck, Smartphone, Users, WalletCards, X } from 'lucide-react';
import { adminUserSchema, adminNumberSchema, adminProductSchema, adminOrderSchema, adminProjectSchema, adminReceiptSchema, auditSchema,
  type AdminUser, type AdminNumber, type AdminProduct, type AdminOrder, type AdminReceipt, type Allocation, type ProductInput, type AdminQuery } from '@linepool/contracts/admin';
import { serviceSchema, adminRechargeRecordSchema, rechargeRulesSchema, parseRechargeAmount, formatRechargeAmount, rechargeAmountInput,
  type User, type RechargeRules, type RechargeSettings } from '../api/contracts';
import { createLinepoolApi, LinepoolApiError } from '../api/client';
import { queryClient } from '../api/query-client';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { DropdownMenuItem } from '../ui/dropdown-menu';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/skeleton';
import { SidebarProvider, SidebarTrigger } from '../ui/sidebar';
import { TooltipProvider } from '../ui/tooltip';
import { Toaster, toast } from 'sonner';
import { AdminAccountMenu, AdminActivityProvider, AdminSidebar, AdminTooltip, Identifier, useAdminActivity } from './Presentation';
import { ActionButton, Badge, DateText, Facts, IconAction, Modal, RowMenu, ShortId, State, Table, isRowClick, planLabel, regionName, txKindLabel } from './primitives';
import SettlementOrderDrawer from '../agent/SettlementOrderDrawer';
import SelectField from '../SelectField';
import AppSearchInput from '../AppSearchInput';
import AppCombobox from '../AppCombobox';
import RecordPagination from '../workspace-reference/RecordPagination';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { languageStore } from '../preferences/store';
import { apiFailureMessage } from '../i18n/api-errors';
import { translate } from '../i18n/format';
import { navigate } from '../../app/router';
import { adminDescriptions, adminHref, adminTitles, type AdminPage } from './navigation';
import { ApiDocumentation, WebhookManagement } from './IntegrationPages';
import PcConnections from './PcConnections';
import { PlatformRuleSettings, ReceivingReviewModal } from './ReceivingControls';
import PlatformsPage from './PlatformsPage';
import ShopProducts from './ShopProducts';
import './admin.css';

const api = createLinepoolApi();
const regions = [{ value: 'us', label: '美国' }, { value: 'gb', label: '英国' }, { value: 'ca', label: '加拿大' }, { value: 'sg', label: '新加坡' }, { value: 'de', label: '德国' }, { value: 'nl', label: '荷兰' }];
function errorMessage(cause: unknown) {
  if (cause instanceof z.ZodError) return translate('请检查必填内容、数值范围和操作原因。', languageStore.getSnapshot());
  if (!(cause instanceof LinepoolApiError)) return translate('操作失败，请重试。', languageStore.getSnapshot());
  if (cause.status === 401) navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`, true);
  if (cause.status === 403 && cause.code === 'ADMIN_REQUIRED') window.dispatchEvent(new Event('linepool-admin-access-denied'));
  return apiFailureMessage(cause.code, cause.status);
}
function quantityLabel(value: number, language: string) {
  return language === 'en' ? `${value} ${value === 1 ? 'number' : 'numbers'}` : `${value} 个号码`;
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
/** Show delivery progress first; completed deliveries retain any outstanding payment state. */
function orderStatus(o: AdminOrder) {
  if (o.fulfillment_status !== 'COMPLETED') return o.fulfillment_status;
  if (o.receiving_mode === 'ONE_TIME' && o.receiving_status) return `RECEIVING_${o.receiving_status}`;
  return o.payment_status === 'POINTS_DEBITED' ? 'COMPLETED' : o.payment_status;
}
/** An allocation's service state comes from its expiry, independently of the selected filter. */
function NumberStatus({ number: n }: { number: AdminNumber }) {
  const expiresAt = n.expires_at ? Date.parse(n.expires_at) : Number.NaN;
  const remaining = expiresAt - Date.now();
  const receiving = n.receiving_status ? n.receiving_status === 'WAITING' && remaining <= 0 ? 'RECEIVING_REVIEWING' : `RECEIVING_${n.receiving_status}` : null;
  const status = receiving ?? (!n.assigned_user_id || !Number.isFinite(expiresAt) ? n.sale_status
    : remaining <= 0 ? 'SERVICE_EXPIRED'
    : remaining <= 3 * 24 * 60 * 60 * 1000 ? 'SERVICE_EXPIRING' : 'SERVICE_ACTIVE');
  return <div className="lp-admin-badges"><Badge value={status} />{n.permanently_sold && <Badge value="PERMANENTLY_SOLD" />}{(n.resource_status === 'OFFLINE' || n.resource_status === 'ERROR') && <Badge value={n.resource_status} />}</div>;
}
/** Reason is required by the audit log; quick picks save typing for routine operations. */
function ReasonField({ value, onChange, disabled, suggestions, label = '操作原因' }: { value: string; onChange: (value: string) => void; disabled?: boolean; suggestions: string[]; label?: string }) {
  const p = useDisplayPreferences();
  return <div className="lp-admin-reason-field lp-admin-span"><label>{label}<Textarea required minLength={3} maxLength={500} rows={2} placeholder={p.t("简单写一句，方便以后查记录（至少 3 个字）")} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} /></label>
    <div className="lp-admin-reason-chips" aria-label={p.t("常用原因")}>{suggestions.map(text => <button type="button" key={text} disabled={disabled} data-active={value === text || undefined} onClick={() => onChange(text)}>{text}</button>)}</div></div>;
}
function AllocationTable({ items, onReviewed }: { items: Allocation[]; onReviewed?: () => void }) {
  const p = useDisplayPreferences();
  const [reviewing, setReviewing] = useState<string | null>(null);
  return <><Table columns={[p.t("号码 / 平台"), p.t("用户"), p.t("分配时间"), p.t("原服务到期"), p.t("归属状态")]} label={p.t("归属历史")}>{items.map(item => <tr key={item.id}>
    <td>{item.phone_number}<small>{item.platform_id}</small></td><td>{item.owner_name}</td><td><DateText value={item.assigned_at} /></td><td><DateText value={item.expires_at} /></td>
    <td>{item.receiving_status ? <Badge value={item.receiving_status === 'WAITING' && Date.parse(item.receiving_ends_at ?? item.expires_at) <= Date.now() ? 'RECEIVING_REVIEWING' : `RECEIVING_${item.receiving_status}`} /> : item.released_at ? <><Badge value="CANCELLED" /><small>{p.t("回收于 ")}<DateText value={item.released_at} /></small></> : p.t("当前归属")}
      {item.receiving_mode === 'ONE_TIME' && <ActionButton size="sm" onClick={() => setReviewing(item.id)}>{p.t('查看接码窗口')}</ActionButton>}
    </td></tr>)}{!items.length && <tr><td colSpan={5}>{p.t("暂无归属记录")}</td></tr>}</Table>
    {reviewing && <ReceivingReviewModal allocationId={reviewing} onClose={() => setReviewing(null)} onReviewed={() => { setReviewing(null); onReviewed?.(); }} />}
  </>;
}
type DetailTarget = { section: 'users' | 'numbers' | 'orders'; id: string };
function UserDetail({ id }: { id: string }) {
  const p = useDisplayPreferences();
  const result = useResource(id, signal => api.adminUser(id, { signal }));
  if (!result.data) return <State {...result} />;
  const { user, numbers, orders } = result.data.data;
  return <><div className="lp-admin-detail-hero"><strong>{user.display_name}</strong><span>{user.email}</span><div><Badge value={user.account_status} /><Badge value={user.role} /></div></div><Facts rows={[
    [p.t("积分余额"), <strong className="lp-admin-big-number">{user.points_balance.toLocaleString()}{p.t(" 积分")}</strong>], [p.t("注册时间"), <DateText value={user.created_at} />],
    [p.t("持有号码"), p.t("{value1} 个", { value1: user.number_count })], [p.t("历史订单"), p.t("{value1} 笔", { value1: user.order_count })], [p.t("用户 ID"), <Identifier value={user.id} />],
  ]} /><h3>{p.t("持有号码 · 最近 50 条")}</h3>{numbers.length ? <Table columns={[p.t("号码"), p.t("平台"), p.t("到期时间")]} label={p.t("用户号码")}>{numbers.map(n => <tr key={n.id}><td className="lp-admin-mono">{n.phone_number}</td><td>{n.service}</td><td><DateText value={n.expires_at} /></td></tr>)}</Table> : <p className="lp-admin-context">{p.t("该用户目前没有号码。")}</p>}
    <h3>{p.t("历史订单 · 最近 50 条")}</h3>{orders.length ? <><OrderTable orders={orders} /><a href={adminHref('orders', { userId: id })}>{p.t("查看全部订单 ")}<ArrowUpRight size={14} /></a></> : <p className="lp-admin-context">{p.t("该用户还没有下过订单。")}</p>}</>;
}
function NumberDetail({ id }: { id: string }) {
  const p = useDisplayPreferences();
  const result = useResource(id, signal => api.adminNumber(id, { signal }));
  if (!result.data) return <State {...result} />;
  const { number: n, allocations } = result.data.data;
  return <><div className="lp-admin-detail-hero"><strong className="lp-admin-mono">{n.phone_number}</strong><span>{n.country} · {n.service}</span><NumberStatus number={n} /></div><Facts rows={[
    [p.t("归属用户"), n.owner_name ?? p.t("未分配")], [p.t("服务到期"), <DateText value={n.expires_at} />], [p.t("号码能力"), p.t("仅接收短信")], [p.t("区号"), n.prefix],
  ]} /><h3>{p.t("分配历史 · 最近 50 条")}</h3><AllocationTable items={allocations} onReviewed={result.retry} />
    <details className="lp-admin-tech"><summary>{p.t("技术信息")}</summary><Facts rows={[
      [p.t("来源"), <Badge value={n.provider === 'pingcode' ? 'PC' : 'DEMO'} />], [p.t("资源状态"), <Badge value={n.resource_status} />],
      [p.t("服务资源 ID"), <Identifier value={n.id} />], [p.t("号码 ID"), <Identifier value={n.number_id} />],
      [p.t("PC 号码 ID"), n.provider === 'pingcode' ? n.external_number_id ?? p.t("未绑定") : '—'], [p.t("PC 项目"), n.provider === 'pingcode' ? `${n.project_name} · ${n.external_project_id}` : '—'],
      [p.t("PC 号码资源到期"), <DateText value={n.resource_expires_at} />],
    ]} /></details></>;
}
function OrderDetail({ id }: { id: string }) {
  const p = useDisplayPreferences();
  const result = useResource(id, signal => api.adminOrder(id, { signal }));
  if (!result.data) return <State {...result} />;
  const { order: o, allocations } = result.data.data;
  return <><div className="lp-admin-detail-hero"><strong>{planLabel(o.plan_name, p.t)}</strong><span>{o.owner_name} · {quantityLabel(o.quantity, p.language)} · {o.total_points}{p.t(" 积分")}</span><div><Badge value={orderStatus(o)} /></div></div><Facts rows={[
    [p.t("订单编号"), <Identifier value={o.order_number} />], [p.t("已交付号码"), `${o.assigned_count} / ${o.quantity}`],
    [p.t("结算"), <Badge value={o.payment_status} />], [p.t("开通"), <Badge value={o.fulfillment_status} />],
    [p.t("下单时间"), <DateText value={o.created_at} />], [p.t("完成时间"), <DateText value={o.completed_at} />],
  ]} /><h3>{p.t("交付的号码")}</h3><AllocationTable items={allocations} onReviewed={result.retry} /><details className="lp-admin-tech"><summary>{p.t("技术信息 · 购买时商品快照")}</summary><pre className="lp-admin-json">{JSON.stringify(o.product_snapshot, null, 2)}</pre></details></>;
}
function Detail({ target, onClose }: { target: DetailTarget; onClose: () => void }) {
  const p = useDisplayPreferences();
  const content = target.section === 'users' ? <UserDetail id={target.id} /> : target.section === 'numbers' ? <NumberDetail id={target.id} /> : <OrderDetail id={target.id} />;
  return <Modal title={p.t("{value1}详情", { value1: adminTitles[target.section] })} variant="drawer" onClose={onClose}><div className="lp-admin-dialog-body">{content}</div></Modal>;
}
function OrderTable({ orders, onDetail }: { orders: AdminOrder[]; onDetail?: (id: string) => void }) {
  const p = useDisplayPreferences();
  return <Table columns={[p.t("订单号"), p.t("用户"), p.t("商品"), p.t("积分"), p.t("状态"), p.t("下单时间"), ...(onDetail ? [''] : [])]} label={p.t("订单列表")}>{orders.map(o => <tr key={o.id} className={onDetail ? 'lp-admin-clickable' : undefined} onClick={onDetail ? event => { if (isRowClick(event)) onDetail(o.id); } : undefined}><td><ShortId value={o.order_number} /></td><td><strong>{o.owner_name}</strong></td><td>{planLabel(o.plan_name, p.t)}<small>{quantityLabel(o.quantity, p.language)}{o.assigned_count < o.quantity ? p.t(" · 已交付 {value1}", { value1: o.assigned_count }) : ''}</small></td><td className="lp-admin-numeric">{o.total_points}</td><td><Badge value={orderStatus(o)} /></td><td><DateText value={o.created_at} /></td>{onDetail && <td><IconAction label={p.t("查看订单详情")} onClick={() => onDetail(o.id)}><Eye size={16} /></IconAction></td>}</tr>)}</Table>;
}

type ActionTarget = { kind: 'user'; user: AdminUser } | { kind: 'password'; user: AdminUser } | { kind: 'assign' | 'reclaim' | 'sale'; number: AdminNumber };
function ConfirmAction({ target, onClose, onSuccess }: { target: ActionTarget; onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState('30');
  const [userSearch, setUserSearch] = useState('');
  const [userTerm, setUserTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const users = useResource(`assign-users:${target.kind}:${userTerm}`, signal => target.kind === 'assign' ? api.adminList('users', adminUserSchema, { pageSize: 20, status: 'ACTIVE', search: userTerm }, { signal }) : Promise.resolve(null));
  const title = target.kind === 'password' ? p.t("重置密码") : target.kind === 'user' ? target.user.account_status === 'ACTIVE' ? p.t("禁用用户") : p.t("启用用户") : target.kind === 'assign' ? p.t("手动分配号码") : target.kind === 'reclaim' ? p.t("回收号码") : target.number.sale_enabled ? p.t("设为不可售") : p.t("设为可售");
  async function submit() {
    if (busy) return;
    if (target.kind === 'password' && password !== confirmation) { setError(p.t("两次输入的新密码不一致。")); return; }
    if (target.kind === 'password' && new TextEncoder().encode(password).length > 72) { setError(p.t("密码不能超过 72 个 UTF-8 字节。")); return; }
    setBusy(true); setError('');
    try {
      if (target.kind === 'password') {
        await api.adminResetPassword(target.user.id, { newPassword: password, reason });
        setPassword(''); setConfirmation('');
      } else if (target.kind === 'user') await api.adminUserStatus(target.user.id, { status: target.user.account_status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', reason });
      else if (target.kind === 'assign') await api.adminNumberAction(target.number.id, { action: 'assign', userId, durationDays: days === '7' ? 7 : 30, reason });
      else if (target.kind === 'reclaim') await api.adminNumberAction(target.number.id, { action: 'reclaim', expectedUserId: target.number.assigned_user_id!, expectedAllocationId: target.number.allocation_id!, reason });
      else await api.adminNumberAction(target.number.id, { action: 'sale', saleEnabled: !target.number.sale_enabled, reason });
      onSuccess();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title={title} onClose={onClose} busy={busy} variant="confirmation"><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-confirm-target">{target.kind === 'user' || target.kind === 'password' ? `${target.user.display_name} · ${target.user.email}` : `${target.number.phone_number} · ${target.number.service}`}</p>
    {target.kind === 'password' && <><p className="lp-admin-warning">{p.t("重置后，该用户在所有设备上的登录和已有找回链接将立即失效。请通过安全渠道将新密码告知用户。")}</p>
      <label>{p.t("新密码")}<Input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} placeholder={p.t("8–72 个字符，最多 72 个 UTF-8 字节")} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
      <label>{p.t("确认新密码")}<Input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} placeholder={p.t("再次输入新密码")} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label></>}
    {target.kind === 'reclaim' && <p className="lp-admin-warning">{p.t("仅结束该号码在 ")}{target.number.service}{p.t(" 平台的当前服务，保留历史订单与短信，其他平台不受影响。回收后该平台服务不会自动上架。")}</p>}
    {target.kind === 'user' && target.user.account_status === 'ACTIVE' && <p className="lp-admin-warning">{p.t("禁用后，该用户的登录会话立即失效，号码和订单记录会保留。")}</p>}
    {target.kind === 'assign' && !isStorefrontRegion(target.number.region_id) && <p className="lp-admin-warning">{p.t('该国家前台未开放，用户无法自行购买同国家号码')}</p>}
    {target.kind === 'assign' && <><p className="lp-admin-context">{p.t("手动分配不会扣用户积分，也不会生成订单。先搜索并选择用户。")}</p><AppSearchInput className="lp-admin-search" aria-label={p.t("搜索分配用户")} placeholder={p.t("用户名、邮箱或用户 ID")} value={userSearch} onValueChange={setUserSearch} disabled={busy} loading={users.loading}><IconAction label={p.t("查找用户")} onClick={() => setUserTerm(userSearch)} disabled={busy}><Search size={16} /></IconAction></AppSearchInput>
      <State loading={users.loading} error={users.error} retry={users.retry} />
      <label>{p.t("目标用户")}<AppCombobox aria-label={p.t("目标用户")} value={userId} disabled={busy || users.loading} onValueChange={setUserId} options={[{ value: '', label: p.t("请选择用户") }, ...(users.data?.data ?? []).filter(user => user.auth_kind === 'LOCAL').map(user => ({ value: user.id, label: `${user.display_name} · ${user.email}` }))]} /></label>
      <label>{p.t("服务天数")}<AppCombobox aria-label={p.t("分配服务天数")} value={days} onValueChange={setDays} options={[{ value: '7', label: p.t("7 天") }, { value: '30', label: p.t("30 天") }]} disabled={busy} /></label></>}
    <ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={target.kind === 'password' ? [p.t("用户忘记密码"), p.t("用户申请重置")] : target.kind === 'user' ? target.user.account_status === 'ACTIVE' ? [p.t("违规使用"), p.t("用户申请注销")] : [p.t("申诉通过，恢复使用")] : target.kind === 'assign' ? [p.t("客户补发号码"), p.t("线下付款开通"), p.t("测试使用")] : target.kind === 'reclaim' ? [p.t("客户退订"), p.t("服务到期回收"), p.t("分配错误")] : [p.t("号码异常暂停售卖"), p.t("恢复售卖")]} />{error && <p role="alert" className="lp-admin-error">{error}</p>}
    </div><footer><ActionButton disabled={busy} onClick={onClose}>{p.t("取消")}</ActionButton><ActionButton variant="accent" type="submit" busy={busy} disabled={target.kind === 'assign' && !userId}><Check size={15} />{p.t("确认")}{title}</ActionButton></footer></form></Modal>;
}
function ProductEditor({ product, onClose, onSuccess }: { product: AdminProduct | null; onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const [value, setValue] = useState<ProductInput>(() => product ? { region: product.region_id, service: product.service, plan: product.plan, name: product.name, receivingMode: product.receiving_mode, durationDays: product.receiving_mode === 'ONE_TIME' ? null : product.duration_days === 7 ? 7 : 30, windowMinutes: product.receiving_mode === 'ONE_TIME' ? 15 : null, unitPoints: product.unit_points, isActive: product.is_active, areaPrefix: product.area_prefix, capability: 'RECEIVE', allowRenewal: false, reason: '' }
    : { region: 'us', service: 'Telegram', plan: '', name: '', receivingMode: 'HOSTED', durationDays: 30, windowMinutes: null, unitPoints: 0, isActive: false, areaPrefix: '', capability: 'RECEIVE', allowRenewal: false, reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mappings = useResource('product-platform-mappings', signal => api.adminList('projects', adminProjectSchema, { pageSize: 100, provider: 'pingcode', status: 'ACTIVE' }, { signal }));
  // New products may only use country × platform pairs the upstream actually supplies numbers for.
  const offered = useResource('product-options', signal => product ? Promise.resolve(null) : api.adminProductOptions({ signal }));
  const offeredOptions = offered.data?.data ?? [];
  const offeredKey = `${value.region}/${value.service}`;
  useEffect(() => {
    const first = offered.data?.data[0];
    if (first && !offered.data!.data.some(option => option.region === value.region && option.service === value.service)) setValue(current => ({ ...current, region: first.region, service: first.service }));
  }, [offered.data]);
  const pcProject = mappings.data?.data.find(item => item.platform_id === value.service);
  function set<K extends keyof ProductInput>(key: K, next: ProductInput[K]) { setValue(current => ({ ...current, [key]: next })); }
  // The mode determines the service period; a one-time product is never a zero-day plan.
  const defaultName = value.receivingMode === 'ONE_TIME' ? p.t('一次性接码 · 15分钟') : p.t("{value1} 天短期服务", { value1: value.durationDays! });
  const defaultPlan = value.receivingMode === 'ONE_TIME' ? 'one_time' : value.durationDays === 7 ? 'week' : 'month';
  async function submit() { setBusy(true); setError(''); try { await api.adminSaveProduct({ ...value, name: value.name.trim() || defaultName, plan: value.plan || defaultPlan }, !product); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title={product ? p.t("编辑商品") : p.t("创建商品")} busy={busy} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><fieldset disabled={busy} className="lp-admin-form-grid">
    {!isStorefrontRegion(value.region) && <p className="lp-admin-warning lp-admin-span">{p.t('该国家前台暂未开放，保存后用户也无法购买')}</p>}
    {product ? <p className="lp-admin-confirm-target lp-admin-span">{product.country} · {product.service}<small>{p.t("国家和平台创建后不能修改")}</small></p>
      : offered.loading && !offered.data ? <p className="lp-admin-context lp-admin-span">{p.t("正在读取上游提供的国家和平台…")}</p>
      : offered.error ? <p className="lp-admin-error lp-admin-span">{offered.error}</p>
      : !offeredOptions.length ? <p className="lp-admin-warning lp-admin-span">{p.t("上游还没有提供任何号码，暂时不能创建商品。上游号码入库后，这里会自动出现可选的国家和平台。")}</p>
      : <label className="lp-admin-span">{p.t("国家 · 平台")}<AppCombobox aria-label={p.t("商品国家和平台")} disabled={busy} value={offeredKey} onValueChange={v => { const [region, service] = v.split('/'); setValue(current => ({ ...current, region: region as ProductInput['region'], service: service as ProductInput['service'] })); }}
          options={offeredOptions.map(option => ({ value: `${option.region}/${option.service}`, label: p.t("{value1} · {value2}（上游可用 {value3} 个{value4}）", { value1: option.country, value2: option.service, value3: option.availableCount, value4: option.productCount ? ` · 已有 ${option.productCount} 个商品` : '' }) }))} /><small>{p.t("只列出上游实际提供号码的组合，不能创建上游没有的国家或平台")}</small></label>}
    <label>{p.t('接码商品类型')}<AppCombobox aria-label={p.t('接码商品类型')} disabled={busy} value={value.receivingMode} onValueChange={mode => setValue(current => ({ ...current, receivingMode: mode === 'ONE_TIME' ? 'ONE_TIME' : 'HOSTED', durationDays: mode === 'ONE_TIME' ? null : 30, windowMinutes: mode === 'ONE_TIME' ? 15 : null }))} options={[{ value: 'ONE_TIME', label: p.t('一次性接码 · 15分钟') }, { value: 'HOSTED', label: p.t('平台收码托管') }]} /></label>
    {value.receivingMode === 'HOSTED' ? <label>{p.t("服务天数")}<AppCombobox aria-label={p.t("商品服务天数")} disabled={busy} value={String(value.durationDays)} onValueChange={v => set('durationDays', v === '7' ? 7 : 30)} options={[{ value: '7', label: p.t("7 天") }, { value: '30', label: p.t("30 天") }]} /><small>{p.t('从实际交付起提供完整7或30天服务。')}</small></label> : <p className="lp-admin-context lp-admin-span">{p.t('一次性每单一个号码；先冻结积分，有效首码成功才扣分。请先在商品列表配置该平台的验证码规则。')}</p>}
    <label>{p.t("价格（积分）")}<Input type="number" required min={1} max={1000000} value={value.unitPoints || ''} onChange={e => set('unitPoints', Number(e.target.value))} /><small>{p.t("每个号码扣多少积分")}</small></label>
    <label className="lp-admin-span">{p.t("商品名称")}<Input maxLength={100} placeholder={defaultName} value={value.name} onChange={e => set('name', e.target.value)} /><small>{p.t("前台展示给用户的名字，留空则使用「")}{defaultName}」</small></label>
    <label className="lp-admin-checkbox lp-admin-span lp-admin-switch-row"><Checkbox checked={value.isActive} onCheckedChange={checked => set('isActive', checked === true)} /><span>{product ? p.t("上架销售") : p.t("立即上架")}<small>{!isStorefrontRegion(value.region) ? p.t('仅保存上架状态，前台开放该国家后才能购买') : product ? p.t("取消勾选即下架，用户将看不到这个套餐") : p.t("勾选后用户马上能在前台购买")}</small></span></label>
    <details className="lp-admin-tech lp-admin-span"><summary>{p.t("高级设置（一般不用改）")}</summary><div className="lp-admin-form-grid">
      <label>{p.t("套餐标识")}<Input pattern="[a-z][a-z0-9_-]{0,31}" maxLength={32} disabled={busy || Boolean(product)} placeholder={defaultPlan} value={value.plan} onChange={e => set('plan', e.target.value)} /><small>{p.t("系统内部编号，小写英文，留空自动生成")}</small></label>
      <label>{p.t("号段前缀")}<Input maxLength={20} pattern="\+?[0-9]*" placeholder={p.t("全部号段")} value={value.areaPrefix} onChange={e => set('areaPrefix', e.target.value)} /><small>{p.t("只卖某个号段时填写，例如 +1959")}</small></label>
      <div className="lp-admin-span lp-admin-field-note"><span>{p.t("上游 PC 对应项目")}</span><small>{mappings.loading ? p.t("正在读取配置…") : mappings.error ? p.t("配置读取失败，请重新打开商品。") : pcProject ? `${pcProject.project_name} · ${pcProject.external_project_id}` : p.t("未绑定（上游同步尚未接入，不影响演示库存销售）")}</small></div>
    </div></details>
    <ReasonField value={value.reason} onChange={next => set('reason', next)} disabled={busy} suggestions={product ? [p.t("调整价格"), p.t("上架销售"), p.t("暂停销售")] : [p.t("新增销售套餐")]} />
    {error && <p role="alert" className="lp-admin-error lp-admin-span">{error}</p>}
    </fieldset></div><footer><ActionButton disabled={busy} onClick={onClose}>{p.t("取消")}</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!product && !offeredOptions.length}><Check size={16} />{p.t("保存商品")}</ActionButton></footer></form></Modal>;
}
/** Lists what upstream supplies and creates unlisted draft products for combinations not yet on sale. */
function ProductSyncModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const options = useResource('product-sync-options', signal => api.adminProductOptions({ signal }));
  const [reason, setReason] = useState(p.t("同步上游可售国家和平台"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = options.data?.data ?? [];
  const missing = rows.filter(option => option.productCount === 0).length;
  async function submit() {
    setBusy(true); setError('');
    try {
      const result = (await api.adminSyncProducts({ reason })).data;
      toast.success(result.createdCount ? p.t("已新增 {value1} 个商品（未上架），设置好价格后即可上架。", { value1: result.createdCount }) : p.t("商品已是最新，没有需要新增的。"));
      onSuccess();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title={p.t("从上游同步商品")} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <p className="lp-admin-context">{p.t("系统会读取已入库的上游号码，找出上游提供的「国家 × 平台」组合。还没有商品的组合，会自动生成 7 天和 30 天两个套餐，默认")}<strong>{p.t("不上架")}</strong>{p.t("、价格参考同平台现价，你确认价格后再上架即可。")}</p>
    <State {...options} columns={4} empty={options.data?.data.length === 0} />
    {rows.length > 0 && <Table columns={[p.t("国家"), p.t("平台"), p.t("上游可用号码"), p.t("商品")]} label={p.t("上游可售组合")}>{rows.map(option => <tr key={`${option.region}/${option.service}`}><td>{option.country}</td><td>{option.service}</td><td className="lp-admin-numeric">{option.availableCount}</td><td>{option.productCount ? p.t("已有 {value1} 个", { value1: option.productCount }) : <Badge value="PRODUCT_NEW" />}</td></tr>)}</Table>}
    {options.data && <p className="lp-admin-context">{missing ? p.t("有 {value1} 个组合还没有商品，同步后会新增 {value2} 个未上架商品。", { value1: missing, value2: missing * 2 }) : p.t("所有组合都已有商品，无需同步。")}</p>}
    <p className="lp-admin-context">{p.t("上游 PC 接口接通后，号码会自动入库，这里的列表会随之更新。")}</p>
    <ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={[p.t("同步上游可售国家和平台")]} />
    {error && <p role="alert" className="lp-admin-error">{error}</p>}
  </div><footer><ActionButton disabled={busy} onClick={onClose}>{p.t("取消")}</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!missing}><RefreshCw size={15} />{p.t("同步并生成商品")}</ActionButton></footer></form></Modal>;
}

function RechargeSettingsEditor({ settings, onClose, onSuccess }: { settings: RechargeSettings; onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
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
  const currencyOptions = [{ value: '', label: p.t("请选择币种") }, ...Intl.supportedValuesOf('currency').map(value => ({ value, label: `${value} · ${names.of(value)}` }))];
  async function submit() {
    setBusy(true); setError('');
    try {
      let rules: RechargeRules | null = null;
      if (enabled) {
        if (!currency) throw new Error(p.t("请选择充值币种。"));
        const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
        const base = { enabled: true, dailyMinor: null, currency, fractionDigits, minimumMinor: 1, maximumMinor: Number.MAX_SAFE_INTEGER, presetsMinor: [], exchangeAmountMinor: null, exchangePoints: null };
        const amount = (value: string, label: string) => {
          const parsed = parseRechargeAmount(value.trim(), base);
          if (parsed.error) throw new Error(p.t("{value1}请输入正数，最多保留 {value2} 位小数。", { value1: label, value2: fractionDigits }));
          return parsed.amountMinor;
        };
        const minimumMinor = amount(minimum, p.t("最低充值金额"));
        const maximumMinor = amount(maximum, p.t("最高充值金额"));
        if (minimumMinor > maximumMinor) throw new Error(p.t("最高充值金额不能小于最低充值金额。"));
        const presetsMinor = presets.trim() ? presets.trim().split(/[,，、\s]+/).filter(Boolean).map(value => amount(value, p.t("快捷金额"))).sort((a, b) => a - b) : [];
        if (presetsMinor.length > 12) throw new Error(p.t("快捷充值金额最多配置 12 个。"));
        if (new Set(presetsMinor).size !== presetsMinor.length) throw new Error(p.t("快捷充值金额不能重复。"));
        if (presetsMinor.some(value => value < minimumMinor || value > maximumMinor)) throw new Error(p.t("每个快捷金额都必须在充值范围内。"));
        if (!/^[0-9]+$/.test(exchangePoints) || !Number.isInteger(Number(exchangePoints)) || Number(exchangePoints) < 1) throw new Error(p.t("对应积分请输入正整数。"));
        const parsed = rechargeRulesSchema.safeParse({ enabled: original?.enabled ?? true, dailyMinor: original?.dailyMinor ?? null, currency, fractionDigits, minimumMinor, maximumMinor, presetsMinor,
          exchangeAmountMinor: amount(exchangeAmount, p.t("兑换金额")), exchangePoints: Number(exchangePoints) });
        if (!parsed.success) throw new Error(p.t("请调整兑换比例或最高金额；快捷金额须能兑换为整数积分，单次积分不能超过 2,147,483,647。"));
        rules = parsed.data;
      }
      await api.adminSaveRechargeSettings({ rules, expectedVersion: settings.version, reason });
      onSuccess();
    } catch (cause) { setError(cause instanceof LinepoolApiError || cause instanceof z.ZodError ? errorMessage(cause) : cause instanceof Error ? cause.message : p.t("保存失败，请重试。")); }
    finally { setBusy(false); }
  }
  return <Modal title={p.t("充值金额与积分规则")} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <p className="lp-admin-context">{p.t("设置用户能充多少钱、多少钱换多少积分。在线支付尚未开通，这里只影响前台显示。")}</p>
    <label className="lp-admin-checkbox"><Checkbox checked={enabled} disabled={busy} onCheckedChange={checked => setEnabled(checked === true)} />{p.t("显示充值金额和兑换规则")}</label>
    <fieldset className="lp-admin-form-grid lp-admin-recharge-form" disabled={busy || !enabled}>
      <label className="lp-admin-span">{p.t("充值币种")}<AppCombobox aria-label={p.t("充值币种")} disabled={busy || !enabled} value={currency} onValueChange={setCurrency} options={currencyOptions} /></label>
      <label>{p.t("最低充值金额")}<Input required={enabled} inputMode="decimal" maxLength={32} value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
      <label>{p.t("最高充值金额")}<Input required={enabled} inputMode="decimal" maxLength={32} value={maximum} onChange={event => setMaximum(event.target.value)} /></label>
      <label className="lp-admin-span">{p.t("快捷充值金额")}<Input placeholder={p.t("多个金额用逗号分隔，可留空")} maxLength={420} value={presets} onChange={event => setPresets(event.target.value)} /></label>
      <label>{p.t("兑换金额")}<Input required={enabled} inputMode="decimal" maxLength={32} placeholder={p.t("例如 1")} value={exchangeAmount} onChange={event => setExchangeAmount(event.target.value)} /></label>
      <label>{p.t("对应积分")}<Input required={enabled} inputMode="numeric" pattern="[0-9]+" maxLength={10} placeholder={p.t("填写对应的积分数")} value={exchangePoints} onChange={event => setExchangePoints(event.target.value)} /></label>
    </fieldset>
    <ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={[p.t("调整充值档位"), p.t("调整兑换比例")]} />
    {error && <p className="lp-admin-error" role="alert">{error}</p>}
    </div><footer><ActionButton disabled={busy} onClick={onClose}>{p.t("取消")}</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={16} />{p.t("保存充值规则")}</ActionButton></footer></form></Modal>;
}
function RechargesList({ input, revision, update }: Pick<ListProps, 'input' | 'revision' | 'update'>) {
  const p = useDisplayPreferences();
  const settings = useResource('recharge-settings', signal => api.adminRechargeSettings({ signal }), revision);
  const result = useList('recharges', adminRechargeRecordSchema, input, revision);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<z.infer<typeof adminRechargeRecordSchema> | null>(null);
  const config = settings.data?.data;
  const rules = config?.rules;
  const amount = (value: number) => rules ? formatRechargeAmount(value, rules, p.locale) : p.t("未配置");
  useEffect(() => setSelected(null), [JSON.stringify(input), revision]);
  return <><section className="lp-admin-recharge-settings" aria-label={p.t("充值规则")}><div className="lp-admin-section-heading"><h2>{p.t("充值规则")}</h2><ActionButton onClick={() => setEditing(true)} disabled={!config || settings.loading || !!settings.error}><Pencil size={15} />{p.t("配置充值")}</ActionButton></div><State {...settings} />
    {config && <><Facts rows={[
      [p.t("充值币种"), rules?.currency ?? p.t("未配置")], [p.t("充值范围"), rules ? `${amount(rules.minimumMinor)} – ${amount(rules.maximumMinor)}` : p.t("未配置")],
      [p.t("兑换比例"), rules?.exchangeAmountMinor && rules.exchangePoints ? p.t("{value1} = {value2} 积分", { value1: amount(rules.exchangeAmountMinor), value2: p.n(rules.exchangePoints) }) : p.t("未配置")],
      [p.t("快捷金额"), rules?.presetsMinor.length ? rules.presetsMinor.map(amount).join('、') : p.t("未配置")],
      [p.t("在线支付"), <Badge value="NOT_CONNECTED" />], [p.t("最近修改"), config.updatedAt ? <><DateText value={config.updatedAt} /> · {config.updatedBy}</> : '—'],
    ]} /><p className="lp-admin-context">{p.t("在线支付接入后，用户付款成功会自动出现在下方的充值记录里。")}</p></>}
    </section><div className="lp-admin-section-heading"><h2>{p.t("充值记录")}</h2></div><State {...result} columns={7} empty={result.data?.data.length === 0} />
    {result.data && <Table columns={[p.t("充值单号 / 用户"), p.t("金额"), p.t("积分"), p.t("支付方式"), p.t("状态"), p.t("创建时间 / 到账时间"), '']} label={p.t("充值记录")}>{result.data.data.map(record => <tr key={record.id}>
      <td><ShortId value={record.orderNumber} /><small>{record.ownerName} · {record.email}</small></td><td className="lp-admin-numeric">{formatRechargeAmount(record.amountMinor, record, p.locale)}</td><td className="lp-admin-numeric">{p.n(record.points)}</td>
      <td>{record.paymentMethod ?? '—'}</td><td><Badge value={record.status} /></td><td><DateText value={record.createdAt} /><small><DateText value={record.creditedAt} /></small></td><td><IconAction label={p.t("查看充值记录")} onClick={() => setSelected(record)}><Eye size={16} /></IconAction></td>
    </tr>)}</Table>}<Pager result={result} input={input} update={update} />
    {editing && config && <RechargeSettingsEditor settings={config} onClose={() => setEditing(false)} onSuccess={() => { setEditing(false); settings.retry(); toast.success(p.t("充值规则已保存。")); }} />}
    {selected && <Modal title={p.t("充值记录详情")} variant="drawer" onClose={() => setSelected(null)}><div className="lp-admin-dialog-body"><Facts rows={[
      [p.t("充值单号"), selected.orderNumber], [p.t("用户"), `${selected.ownerName} · ${selected.email}`], [p.t("充值金额"), formatRechargeAmount(selected.amountMinor, selected, p.locale)],
      [p.t("兑换积分"), p.n(selected.points)], [p.t("状态"), <Badge value={selected.status} />], [p.t("支付方式"), selected.paymentMethod ?? '—'], [p.t("支付流水号"), selected.providerTransactionId ?? '—'],
      [p.t("创建时间"), <DateText value={selected.createdAt} />], [p.t("付款时间"), <DateText value={selected.paidAt} />], [p.t("积分到账时间"), <DateText value={selected.creditedAt} />],
    ]} /></div></Modal>}</>;
}

const filters: Record<AdminPage, { value: string; label: string }[]> = {
  'api-docs': [], webhooks: [], connections: [], platforms: [],
  dashboard: [], users: [{ value: 'ACTIVE', label: '正常' }, { value: 'DISABLED', label: '已禁用' }],
  numbers: [{ value: 'AVAILABLE', label: '可售' }, { value: 'ASSIGNED', label: '已分配' }, { value: 'UNSELLABLE', label: '不可售' }, { value: 'expiring', label: '3 天内到期' }],
  products: [{ value: 'ACTIVE', label: '已上架' }, { value: 'INACTIVE', label: '已下架' }],
  projects: [{ value: 'ACTIVE', label: '已启用' }, { value: 'INACTIVE', label: '已停用' }],
  receipts: [{ value: 'IMPORTED', label: '已分发' }, { value: 'UNMATCHED', label: '未匹配用户' }, { value: 'PENDING', label: '待处理' }, { value: 'FAILED', label: '处理失败' }, { value: 'QUARANTINED', label: '已隔离' }],
  agents: [{ value: 'ACTIVE', label: '正常' }, { value: 'SUSPENDED', label: '已暂停' }, { value: 'TERMINATED', label: '已终止' }],
  inventory: [{ value: 'ACTIVE', label: '持有中' }, { value: 'SUSPENDED', label: '已暂停' }, { value: 'RETIRED', label: '已退出库存' }],
  recharges: [{ value: 'PENDING', label: '待支付' }, { value: 'CHECKING', label: '支付核对中' }, { value: 'PAID_UNCREDITED', label: '已支付，积分未到账' }, { value: 'SUCCEEDED', label: '已到账' }, { value: 'PAID', label: '已支付' }, { value: 'REFUNDING', label: '退款中' }, { value: 'REFUNDED', label: '已退款' }, { value: 'FAILED', label: '失败' }, { value: 'EXPIRED', label: '已超时' }, { value: 'CANCELLED', label: '已取消' }],
  orders: [{ value: 'PROCESSING', label: '处理中' }, { value: 'COMPLETED', label: '已完成' }, { value: 'FAILED', label: '失败' }, { value: 'CANCELLED', label: '已取消' }],
};
function OrderQuickFilters({ input, revision, update }: Pick<ListProps, 'input' | 'revision' | 'update'>) {
  const p = useDisplayPreferences();
  const summary = useResource('order-attention-count', signal => api.adminSummary({ signal }), revision);
  return <div className="lp-admin-status-chips" role="group" aria-label={p.t('快捷筛选')}>
    {[{ value: '', label: '全部' }, { value: 'today', label: '今天' }, { value: 'attention', label: '需要处理' }].map(item => <button key={item.value} type="button" aria-pressed={(input.view ?? '') === item.value} onClick={() => update('view', item.value)}>{p.t(item.label)}{item.value === 'attention' && summary.data && <span>{p.n(summary.data.data.exceptionOrders)}</span>}</button>)}
  </div>;
}
function translatedFilters(page: AdminPage, t: (source: string) => string) {
  return filters[page].map(option => ({ ...option, label: t(option.label) }));
}
function useList<T extends z.ZodType>(section: string, schema: T, input: Partial<AdminQuery>, revision: number) {
  return useResource(`${section}:${JSON.stringify(input)}`, signal => api.adminList(section, schema, input, { signal }), revision);
}
function Pager({ result, input, update }: { result: { loading: boolean; data: { pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } } | null }; input: Partial<AdminQuery>; update: (key: string, value: string) => void }) {
  const size = input.pageSize === 5 || input.pageSize === 10 ? input.pageSize : 20;
  return <RecordPagination busy={result.loading} page={input.page ?? 1} pageSize={size} totalPages={result.data?.pagination.totalPages ?? 0} totalItems={result.data?.pagination.totalItems ?? 0} controls="lp-admin-records" onPageChange={page => update('page', String(page))} onPageSizeChange={size => update('pageSize', String(size))} />;
}
function UsersList({ input, revision, detail, action, update }: ListProps) {
  const p = useDisplayPreferences();
  const result = useList('users', adminUserSchema, input, revision);
  return <><State {...result} columns={6} empty={result.data?.data.length === 0} />{result.data && <Table columns={[p.t("用户"), p.t("积分余额"), p.t("号码"), p.t("订单"), p.t("状态"), p.t("注册时间"), '']} label={p.t("用户管理")}>{result.data.data.map(u => <tr key={u.id} className="lp-admin-clickable" onClick={event => { if (isRowClick(event)) detail({ section: 'users', id: u.id }); }}><td><strong>{u.display_name}{u.role === 'ADMIN' && <span className="lp-admin-inline-tag">{p.t("管理员")}</span>}{u.auth_kind === 'PINCLODE' && <span className="lp-admin-inline-tag">PinClode</span>}</strong><small>{u.email}</small></td><td className="lp-admin-numeric"><strong>{u.auth_kind === 'PINCLODE' ? '—' : u.points_balance.toLocaleString()}</strong></td><td className="lp-admin-numeric">{u.number_count}</td><td className="lp-admin-numeric">{u.order_count}</td><td><Badge value={u.account_status} /></td><td><DateText value={u.created_at} /></td><td><div className="lp-admin-row-actions"><IconAction label={p.t("查看用户详情")} onClick={() => detail({ section: 'users', id: u.id })}><Eye size={16} /></IconAction><RowMenu label={p.t("更多操作")} items={u.role === 'ADMIN' ? [] : [...(u.auth_kind === 'LOCAL' ? [{ label: p.t("查看该用户订单"), onSelect: () => navigate(adminHref('orders', { userId: u.id })) }, { label: p.t("重置密码"), onSelect: () => action({ kind: 'password', user: u }) }] : []), { label: u.account_status === 'ACTIVE' ? p.t("禁用账号") : p.t("启用账号"), danger: u.account_status === 'ACTIVE', onSelect: () => action({ kind: 'user', user: u }) }]} /></div></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
type ListProps = { input: Partial<AdminQuery>; revision: number; detail: (value: DetailTarget) => void; action: (value: ActionTarget) => void; update: (key: string, value: string) => void };
function NumbersList({ input, revision, detail, action, update }: ListProps) {
  const p = useDisplayPreferences();
  const result = useList('numbers', adminNumberSchema, input, revision);
  return <><State {...result} columns={7} empty={result.data?.data.length === 0} />{result.data && <Table columns={[p.t("号码"), p.t("国家"), p.t("平台"), p.t("状态"), p.t("归属用户"), p.t("服务到期"), '']} label={p.t("号码管理")}>{result.data.data.map(n => <tr key={n.id} className="lp-admin-clickable" onClick={event => { if (isRowClick(event)) detail({ section: 'numbers', id: n.id }); }}><td><strong className="lp-admin-mono">{n.phone_number}</strong>{n.provider === 'pingcode' && <small>{p.t("上游 PC 号码")}</small>}</td><td>{n.country}<small>{n.prefix}</small></td><td>{n.service}</td><td><NumberStatus number={n} /></td><td>{n.owner_name ?? <span className="lp-admin-faint">—</span>}</td><td><DateText value={n.expires_at} /></td><td><div className="lp-admin-row-actions">{n.assigned_user_id ? <ActionButton size="sm" onClick={() => action({ kind: 'reclaim', number: n })}>{p.t("回收")}</ActionButton> : <ActionButton size="sm" disabled={n.sale_status !== 'AVAILABLE'} onClick={() => action({ kind: 'assign', number: n })}>{p.t("分配")}</ActionButton>}<RowMenu label={p.t("更多操作")} items={[{ label: p.t("查看详情和历史"), onSelect: () => detail({ section: 'numbers', id: n.id }) }, ...(n.assigned_user_id ? [] : [{ label: n.sale_enabled ? p.t("下架（暂停售卖）") : p.t("重新上架"), onSelect: () => action({ kind: 'sale', number: n }) }])]} /></div></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function ProductsList({ input, revision, update, edit }: Pick<ListProps, 'input' | 'revision' | 'update'> & { edit: (product: AdminProduct) => void }) {
  const p = useDisplayPreferences();
  const result = useList('products', adminProductSchema, input, revision);
  const rows = result.data?.data ?? [];
  return <><PlatformRuleSettings /><State {...result} columns={7} empty={result.data?.data.length === 0} />{result.data && <Table columns={[p.t("平台"), p.t("套餐"), p.t('服务窗口'), p.t("价格"), p.t("库存"), p.t("状态"), '']} label={p.t("商品管理")}>{rows.map((o, index) => <Fragment key={`${o.region_id}/${o.service}/${o.plan}`}>
    {o.region_id !== rows[index - 1]?.region_id && <tr className="lp-admin-group-row"><th colSpan={7} scope="rowgroup">{o.country}{!isStorefrontRegion(o.region_id) && <Badge value="STOREFRONT_CLOSED" />}<small>{rows.filter(item => item.region_id === o.region_id).length}{p.t(" 个套餐")}</small></th></tr>}
    <tr className="lp-admin-clickable" onClick={event => { if (isRowClick(event)) edit(o); }}><td><strong>{o.service}</strong></td><td>{o.name}{o.area_prefix && <small>{p.t("号段 ")}{o.area_prefix}</small>}</td><td>{o.receiving_mode === 'ONE_TIME' ? p.t('一次性接码 · 15分钟') : <>{o.duration_days}{p.t(" 天")}</>}</td><td><strong>{o.unit_points}</strong>{p.t(" 积分")}</td><td className={o.available_count + o.pc_available_count === 0 ? 'lp-admin-low-stock' : undefined}>{o.available_count + o.pc_available_count}{p.t(" 个")}{o.available_count + o.pc_available_count === 0 && <small>{p.t("已无库存")}</small>}</td><td><Badge value={!isStorefrontRegion(o.region_id) ? 'STOREFRONT_CLOSED' : o.is_active ? 'PRODUCT_ON' : 'PRODUCT_OFF'} /></td><td><IconAction label={p.t("编辑价格和上下架")} onClick={() => edit(o)}><Pencil size={16} /></IconAction></td></tr>
  </Fragment>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function OrdersList({ input, revision, update, detail }: Pick<ListProps, 'input' | 'revision' | 'update' | 'detail'>) {
  const p = useDisplayPreferences();
  const result = useList('orders', adminOrderSchema, input, revision);
  return <><State {...result} columns={7} empty={result.data?.data.length === 0} />{result.data && <OrderTable orders={result.data.data} onDetail={id => detail({ section: 'orders', id })} />}<Pager result={result} input={input} update={update} /></>;
}
function ProjectsList({ input, revision, update }: Pick<ListProps, 'input' | 'revision' | 'update'>) {
  const p = useDisplayPreferences();
  const result = useList('projects', adminProjectSchema, input, revision);
  return <><p className="lp-admin-context">{p.t("上游同步尚未接入，下面是系统里已保存的平台配置，一般不需要改动。")}</p><State {...result} columns={6} empty={result.data?.data.length === 0} />{result.data && <Table columns={[p.t("平台名称"), p.t("来源"), p.t("项目 ID"), p.t("配置状态"), p.t("已入库号码"), p.t("保存时间")]} label={p.t("平台项目")}>{result.data.data.map(item => <tr key={`${item.provider}/${item.external_project_id}`}><td><strong>{item.platform_name}</strong><small>{item.project_name}</small></td><td><Badge value={item.provider === 'pingcode' ? 'PC' : 'DEMO'} /></td><td><Identifier value={item.external_project_id} /></td><td><Badge value={item.is_active ? 'PROJECT_ACTIVE' : 'PROJECT_INACTIVE'} /></td><td>{item.number_count}</td><td><DateText value={item.synced_at} /></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
}
function ReceiptsList({ input, revision, update, onProcessed }: Pick<ListProps, 'input' | 'revision' | 'update'> & { onProcessed?: () => void }) {
  const p = useDisplayPreferences();
  const result = useList('receipts', adminReceiptSchema, input, revision);
  const [selected, setSelected] = useState<AdminReceipt | null>(null);
  const [retryReason, setRetryReason] = useState('');
  const [retryError, setRetryError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);
  const { begin } = useAdminActivity();
  useEffect(() => { setRetryReason(''); setRetryError(''); }, [selected?.external_message_id]);
  async function reprocess() {
    if (!selected || retryLock.current) return;
    retryLock.current = true; setRetrying(true); setRetryError('');
    const finish = begin();
    try {
      const response = await api.adminRetryWebhook({ messageId: selected.external_message_id, reason: retryReason });
      setSelected(null); onProcessed?.();
      if (response.data.status === 'IMPORTED') toast.success(p.t("已匹配并分发短信，操作已记录审计日志。"));
      else toast.info(p.t("已重新处理，仍未找到唯一用户服务。请核对项目、号码和接收时的服务有效期。"));
    } catch (cause) { setRetryError(errorMessage(cause)); }
    finally { retryLock.current = false; setRetrying(false); finish(); }
  }
  const queryKey = JSON.stringify(input);
  useEffect(() => setSelected(null), [queryKey, revision]);
  const receiptStatus = (status: string) => status === 'PENDING' ? 'RECEIPT_PENDING' : status;
  const failureReason = (reason: string | null) => reason === 'No unique number/platform service at original reception time' ? p.t("未找到短信接收时对应的号码、平台和用户服务。") : reason ?? '—';
  return <><p className="lp-admin-context">{p.t("「未匹配用户」的短信没有进入任何用户的收件箱，点开可查看原因。")}</p><State {...result} columns={6} empty={result.data?.data.length === 0} />{result.data && <Table columns={[p.t("收到时间"), p.t("号码"), p.t("平台 / 用户"), p.t("来源"), p.t("处理结果"), '']} label={p.t("收信记录")}>{result.data.data.map(item => <tr key={`${item.provider}/${item.external_message_id}`} className="lp-admin-clickable" onClick={event => { if (isRowClick(event)) setSelected(item); }}><td><DateText value={item.recorded_at} /></td><td><strong className="lp-admin-mono">{item.phone_number ?? p.t("号码待绑定")}</strong></td><td>{item.platform ?? p.t("平台待匹配")}<small>{item.owner_name ?? p.t("未匹配用户")}</small></td><td><Badge value={item.provider === 'pingcode' ? 'PC' : 'DEMO'} /></td><td><Badge value={receiptStatus(item.processing_status)} /></td><td><IconAction label={p.t("查看短信内容")} onClick={() => setSelected(item)}><Eye size={16} /></IconAction></td></tr>)}</Table>}<Pager result={result} input={input} update={update} />{selected && <Modal title={p.t("收信记录详情")} variant="drawer" busy={retrying} onClose={() => setSelected(null)}><div className="lp-admin-dialog-body"><h3 className="lp-admin-first-heading">{p.t("短信内容")}</h3><p className="lp-admin-message-body">{selected.body ?? p.t("无正文记录")}</p><Facts rows={[
    [p.t("来源"), <Badge value={selected.provider === 'pingcode' ? 'PC' : 'DEMO'} />], [p.t("处理结果"), <Badge value={receiptStatus(selected.processing_status)} />],
    [p.t("短信 ID"), <Identifier value={selected.external_message_id} />], [p.t("最近事件 ID"), selected.event_id ? <Identifier value={selected.event_id} /> : p.t("未记录")],
    [p.t("号码"), selected.phone_number ?? p.t("待绑定")], [p.t("平台"), selected.platform ?? p.t("待匹配")], [p.t("用户"), selected.owner_name ?? p.t("未匹配用户")], [p.t("发信方"), selected.sender ?? '—'],
    [p.t("PC 项目 ID"), selected.external_project_id ?? '—'], [p.t("上游号码 ID"), selected.external_number_id ?? '—'],
    [p.t("短信接收时间"), <DateText value={selected.sms_received_at} />], [p.t("LP 收到时间"), <DateText value={selected.recorded_at} />],
    [p.t("处理时间"), <DateText value={selected.processed_at} />], [p.t("推送次数"), selected.delivery_count], [p.t("异常原因"), failureReason(selected.failure_reason)],
  ]} />
  {onProcessed && selected.provider === 'pingcode-mock' && selected.processing_status !== 'IMPORTED' && <form className="lp-webhook-retry" onSubmit={event => { event.preventDefault(); void reprocess(); }}>
    <label>{p.t("重新处理原因")}<Textarea required minLength={3} maxLength={500} disabled={retrying} value={retryReason} onChange={event => setRetryReason(event.target.value)} placeholder={p.t("例如：已修复项目映射，重新匹配短信归属")} /></label>
    <p className="lp-admin-context">{p.t("仅重新匹配这条已保存的短信，不向 PC 发起新请求；处理结果将记录审计日志。")}</p>
    {retryError && <p role="alert" className="lp-admin-error">{retryError}</p>}
    <ActionButton type="submit" variant="accent" busy={retrying} disabled={retryReason.trim().length < 3}><RefreshCw size={15} />{p.t("重新处理")}</ActionButton>
  </form>}</div></Modal>}</>;
}
function WebhookPage({ input, revision, update }: Pick<ListProps, 'input' | 'revision' | 'update'>) {
  const p = useDisplayPreferences();
  const [processedRevision, setProcessedRevision] = useState(0);
  const [search, setSearch] = useState(input.search ?? '');
  useEffect(() => setSearch(input.search ?? ''), [input.search]);
  const status = useResource('upstream-status', signal => api.adminUpstreamStatus({ signal }), `${revision}:${processedRevision}`);
  const integration = status.errorCode === 'PC_PLATFORM_PROJECT_UNCONFIRMED' ? null : status.data;
  return <><State {...status} data={integration} />{integration && <WebhookManagement status={integration.data}>
    <form className="lp-admin-toolbar" onSubmit={event => { event.preventDefault(); update('search', search); }}>
      <AppSearchInput className="lp-admin-search" aria-label={p.t("搜索 Webhook 接收记录")} placeholder={p.t("搜索短信 ID、项目、号码、平台或用户")} maxLength={200} value={search} onValueChange={setSearch}><ActionButton type="submit" size="sm">{p.t("搜索")}</ActionButton></AppSearchInput>
      <SelectField aria-label={p.t("Webhook 处理状态")} value={input.status ?? ''} onValueChange={value => update('status', value)} options={[{ value: '', label: p.t("全部处理状态") }, ...translatedFilters('receipts', p.t)]} />
    </form>
    <ReceiptsList input={{ ...input, provider: 'pingcode' }} revision={revision + processedRevision} update={update} onProcessed={() => setProcessedRevision(value => value + 1)} />
  </WebhookManagement>}</>;
}
type AgentListProps = { revision: number };
function AgentsList({ revision }: AgentListProps) {
  const p = useDisplayPreferences();
  const result = useResource(`agents:${revision}`, signal => api.agentAgents({ signal }), revision);
  const customers = useResource(`customers:${revision}`, signal => api.agentCustomers({ signal }), revision);
  const [selected, setSelected] = useState<{ ownerType: 'AGENT' | 'CUSTOMER'; id: string } | null>(null);
  return <><p className="lp-admin-context">{p.t('历史代理与客户资料只读保留。当前代理连接请前往 PC 连接查看。')}</p><State {...result} columns={6} empty={result.data?.data.length === 0} />
    {result.data && <Table columns={[p.t('代理名称'), p.t('级别'), p.t('上级代理'), p.t('历史余额'), p.t('持有号码'), p.t('状态'), '']} label={p.t('历史代理')}>{result.data.data.map(agent => <tr key={agent.id}>
      <td><strong>{agent.name}</strong>{agent.email && <small>{agent.email}</small>}</td><td>{agent.level}</td><td>{agent.parentAgentId ? result.data!.data.find(item => item.id === agent.parentAgentId)?.name ?? agent.parentAgentId : p.t('直属平台')}</td>
      <td>{agent.balanceMinor !== undefined ? `${(agent.balanceMinor / 100).toFixed(2)} USD` : '—'}</td><td>{agent.holdingCount ?? '—'}</td><td><Badge value={agent.status} /></td><td><IconAction label={p.t('查看历史流水')} onClick={() => setSelected({ ownerType: 'AGENT', id: agent.id })}><Eye size={16} /></IconAction></td>
    </tr>)}</Table>}
    <div className="lp-admin-section-heading"><h2>{p.t('历史客户')}</h2></div><State {...customers} columns={4} empty={customers.data?.data.length === 0} />
    {customers.data && <Table columns={[p.t('客户名称'), p.t('所属代理'), p.t('状态'), '']} label={p.t('历史客户')}>{customers.data.data.map(customer => <tr key={customer.id}><td>{customer.name}</td><td>{customer.agentId ? result.data?.data.find(agent => agent.id === customer.agentId)?.name ?? customer.agentId : p.t('平台客户')}</td><td><Badge value={customer.status} /></td><td><IconAction label={p.t('查看历史流水')} onClick={() => setSelected({ ownerType: 'CUSTOMER', id: customer.id })}><Eye size={16} /></IconAction></td></tr>)}</Table>}
    {selected && <LedgerDrawer ownerType={selected.ownerType} ownerId={selected.id} title={p.t('历史余额流水')} onClose={() => setSelected(null)} />}
  </>;
}
function LedgerDrawer({ ownerType, ownerId, title, onClose }: { ownerType: 'AGENT' | 'CUSTOMER'; ownerId: string; title: string; onClose: () => void }) {
  const p = useDisplayPreferences();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<5 | 10 | 20>(20);
  const [orderId, setOrderId] = useState<string | null>(null);
  const result = useResource(`ledger:${ownerType}:${ownerId}:${page}:${pageSize}`, signal => api.agentLedger(ownerType === 'AGENT' ? { ownerType, agentId: ownerId } : { ownerType, customerId: ownerId }, page, pageSize, { signal }), 0);
  const d = result.data?.data;
  return <Modal title={title} variant="drawer" onClose={onClose}><div className="lp-admin-dialog-body" id="lp-admin-ledger">
    {d && <Facts rows={[[p.t("当前余额"), <strong className="lp-admin-big-number">{(d.balanceMinor / 100).toLocaleString()} {d.currency}</strong>], [p.t("主体 ID"), <Identifier value={ownerId} />]]} />}
    <State {...result} columns={5} empty={Boolean(d) && d!.entries.length === 0} />
    {d && d.entries.length > 0 && <Table columns={[p.t("时间"), p.t("类型"), p.t("变动"), p.t("变动后余额"), p.t("说明")]} label={p.t("余额流水")}>{d.entries.map(e => <tr key={e.id}>
      <td><DateText value={e.createdAt} /></td><td>{e.description === '下级进货收入' ? p.t('下级进货收入') : e.type === 'ORDER_DEBIT' ? p.t('进货扣款') : e.type}</td>
      <td className="lp-admin-numeric" style={{ color: e.delta < 0 ? 'var(--lp-danger, #c0392b)' : undefined }}>{e.delta > 0 ? '+' : ''}{(e.delta / 100).toFixed(2)}</td>
      <td className="lp-admin-numeric">{(e.balanceAfter / 100).toFixed(2)}</td><td>{e.description}{e.txOrderId && <ActionButton size="sm" onClick={() => setOrderId(e.txOrderId)}>{p.t('查看订单')}</ActionButton>}</td>
    </tr>)}</Table>}
    {orderId && <SettlementOrderDrawer id={orderId} onClose={() => setOrderId(null)} />}
    <RecordPagination busy={result.loading} page={page} pageSize={pageSize} totalPages={result.data?.pagination.totalPages ?? 0} totalItems={result.data?.pagination.totalItems ?? 0} controls="lp-admin-ledger" onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
  </div></Modal>;
}
function InventoryPage({ revision }: { revision: number }) {
  const p = useDisplayPreferences();
  const [tab, setTab] = useState<'stock' | 'holdings' | 'balances' | 'prices' | 'transactions'>('holdings');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<5 | 10 | 20>(20);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<{ ownerType: 'AGENT' | 'CUSTOMER'; id: string } | null>(null);
  const stock = useResource(`history-stock:${page}:${pageSize}:${query}`, signal => api.agentStock({ page, pageSize, search: query }, { signal }), revision);
  const holdings = useResource(`history-holdings:${page}:${pageSize}:${query}`, signal => api.agentHoldings({ page, pageSize, search: query }, { signal }), revision);
  const balances = useResource('history-balances', signal => api.agentBalances({ signal }), revision);
  const prices = useResource('history-prices', signal => api.agentPrices({ signal }), revision);
  const transactions = useResource(`history-transactions:${page}:${pageSize}:${query}`, signal => api.agentTransactions(page, pageSize, { signal }, { search: query }), revision);
  const agents = useResource('history-agents', signal => api.agentAgents({ signal }), revision);
  const customers = useResource('history-customers', signal => api.agentCustomers({ signal }), revision);
  const ownerName = (agentId: string | null | undefined, customerId: string | null | undefined) =>
    (agentId ? agents.data?.data.find(agent => agent.id === agentId)?.name ?? agentId : customers.data?.data.find(customer => customer.id === customerId)?.name ?? customerId) ?? '—';
  const tabs = [['stock', '历史库存'], ['holdings', '历史持有'], ['balances', '历史余额'], ['prices', '历史价格'], ['transactions', '历史交易']] as const;
  const paged = tab === 'stock' ? stock : tab === 'holdings' ? holdings : transactions;
  return <><p className="lp-admin-context">{p.t('历史分销数据只读保留，金额按原记录展示。')}</p><div className="lp-admin-tabs" role="tablist" aria-label={p.t('历史分销视图')}>{tabs.map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={tab === key} className="lp-admin-tab" onClick={() => { setTab(key); setPage(1); }}>{p.t(label)}</button>)}</div>
    {(tab === 'stock' || tab === 'holdings' || tab === 'transactions') && <form className="lp-admin-toolbar lp-admin-tab-search" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search); }}><AppSearchInput className="lp-admin-search" aria-label={p.t('搜索历史记录')} maxLength={64} value={search} onValueChange={setSearch}><ActionButton type="submit" size="sm">{p.t('搜索')}</ActionButton></AppSearchInput></form>}
    {tab === 'stock' && <><State {...stock} empty={stock.data?.data.length === 0} />{stock.data && <Table label={p.t('历史号码库存')} columns={[p.t('号码'), p.t('平台'), p.t('国家'), p.t('状态'), p.t('资源到期')]}>{stock.data.data.map(item => <tr key={item.id}><td>{item.phoneNumber}</td><td>{item.platformId}</td><td>{regionName(item.regionId)}</td><td><Badge value={item.status} /></td><td><DateText value={item.resourceExpiresAt} /></td></tr>)}</Table>}</>}
    {tab === 'holdings' && <><State {...holdings} empty={holdings.data?.data.length === 0} />{holdings.data && <Table label={p.t('历史持有')} columns={[p.t('号码'), p.t('持有人'), p.t('国家'), p.t('平台'), p.t('状态'), p.t('有效期至')]}>{holdings.data.data.map(item => <tr key={item.id}><td>{item.phoneNumber}</td><td>{ownerName(item.agentId, item.customerId)}</td><td>{regionName(item.regionId)}</td><td>{item.service ?? '—'}</td><td><Badge value={item.status} /></td><td><DateText value={item.expiresAt} /></td></tr>)}</Table>}</>}
    {tab === 'balances' && <><State {...balances} empty={balances.data?.data.length === 0} />{balances.data && <Table label={p.t('历史余额')} columns={[p.t('名称'), p.t('类型'), p.t('余额'), '']}>{balances.data.data.map(item => <tr key={item.id}><td>{ownerName(item.agentId, item.customerId)}</td><td>{p.t(item.ownerType === 'AGENT' ? '代理' : '客户')}</td><td>{(item.balanceMinor / 100).toFixed(2)} {item.currency}</td><td><ActionButton size="sm" onClick={() => setLedger({ ownerType: item.ownerType, id: (item.agentId ?? item.customerId)! })}>{p.t('查看历史流水')}</ActionButton></td></tr>)}</Table>}</>}
    {tab === 'prices' && <><State {...prices} empty={prices.data?.data.length === 0} />{prices.data && <Table label={p.t('历史价格')} columns={[p.t('卖方'), p.t('买方'), p.t('国家'), p.t('平台'), p.t('价格'), p.t('状态')]}>{prices.data.data.map(item => <tr key={item.id}><td>{item.sellerType === 'PLATFORM' ? p.t('平台') : ownerName(item.agentId, null)}</td><td>{item.buyerAgentId ? ownerName(item.buyerAgentId, null) : p.t('通用规则')}</td><td>{regionName(item.regionId)}</td><td>{item.service}</td><td>{(item.unitAmountMinor / 100).toFixed(2)} {item.currency}</td><td>{p.t(item.isActive ? '启用' : '停用')}</td></tr>)}</Table>}</>}
    {tab === 'transactions' && <><State {...transactions} empty={transactions.data?.data.length === 0} />{transactions.data && <Table label={p.t('历史交易')} columns={[p.t('单号'), p.t('类型'), p.t('买方'), p.t('金额'), p.t('状态'), p.t('创建时间')]}>{transactions.data.data.map(item => <tr key={item.id}><td><ActionButton size="sm" onClick={() => setTransactionId(item.id)}><ShortId value={item.orderNumber} /></ActionButton></td><td>{p.t(txKindLabel(item.orderNumber, item.kind))}</td><td>{ownerName(item.buyerAgentId, item.buyerCustomerId)}</td><td>{(item.amountMinor / 100).toFixed(2)} {item.currency}</td><td><Badge value={item.status} /></td><td><DateText value={item.createdAt} /></td></tr>)}</Table>}</>}
    {(tab === 'stock' || tab === 'holdings' || tab === 'transactions') && <RecordPagination busy={paged.loading} page={page} pageSize={pageSize} totalPages={paged.data?.pagination.totalPages ?? 0} totalItems={paged.data?.pagination.totalItems ?? 0} controls="lp-admin-records" onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />}
    <State loading={agents.loading || customers.loading} data={agents.data ?? customers.data} error={agents.error || customers.error} retry={() => { agents.retry(); customers.retry(); }} />
    {ledger && <LedgerDrawer ownerType={ledger.ownerType} ownerId={ledger.id} title={p.t('历史余额流水')} onClose={() => setLedger(null)} />}
    {transactionId && <SettlementOrderDrawer id={transactionId} onClose={() => setTransactionId(null)} />}
  </>;
}
function Dashboard({ revision, detail }: { revision: number; detail: (value: DetailTarget) => void }) {
  const p = useDisplayPreferences();
  const result = useResource('summary', signal => api.adminSummary({ signal }), revision);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState<5 | 10 | 20>(5);
  const audit = useList('audit', auditSchema, { page: auditPage, pageSize: auditPageSize }, revision);
  if (!result.data) return result.loading ? <><div className="lp-admin-metrics" aria-hidden="true">{[0, 1, 2, 3].map(key => <Card className="lp-admin-metric-skeleton" key={key}><Skeleton /><Skeleton /></Card>)}</div><Card className="lp-admin-section"><State {...result} columns={7} /></Card></> : <State {...result} />;
  const s = result.data.data;
  const metrics: { label: string; value: number; page: AdminPage; status?: string; view?: string; hint: string; icon: typeof Users }[] = [
    { label: p.t("今日订单"), value: s.todayOrders, page: 'orders', view: 'today', hint: p.t("今天用户下的单"), icon: WalletCards },
    { label: p.t("使用中的号码"), value: s.activeNumbers, page: 'numbers', status: 'ACTIVE', hint: p.t("已卖出且在服务期内"), icon: Smartphone },
    { label: p.t("可售号码"), value: s.saleNumbers, page: 'numbers', status: 'AVAILABLE', hint: p.t("仅统计前台开放的地区"), icon: PackageCheck },
    { label: p.t("用户总数"), value: s.users, page: 'users', hint: p.t("所有注册账号"), icon: Users },
  ];
  const todos = [
    { count: s.exceptionOrders, label: p.t("笔订单需要核对"), empty: p.t("订单都正常"), href: adminHref('orders', { view: 'attention' }), icon: AlertCircle },
    { count: s.expiringNumbers, label: p.t("个号码 3 天内到期"), empty: p.t("近 3 天没有到期的号码"), href: adminHref('numbers', { status: 'expiring' }), icon: Clock3 },
  ];
  const pending = todos.filter(item => item.count > 0).length;
  return <><State {...result} />
    <section className="lp-admin-todo" data-attention={pending > 0} aria-label={p.t("待处理事项")}><div className="lp-admin-todo-title">{pending ? <AlertCircle size={20} /> : <Check size={20} />}<div><h2>{pending ? p.t("有 {value1} 件事需要你看一下", { value1: pending }) : p.t("一切正常，暂时没有要处理的事")}</h2><p>{p.t("点击下面的条目可以直接跳到对应列表。")}</p></div></div>
      <div className="lp-admin-todo-items">{todos.map(item => { const Icon = item.icon; return <a key={item.label} className="lp-admin-todo-item" data-attention={item.count > 0} href={item.href}><Icon size={18} aria-hidden="true" /><span>{item.count > 0 ? <><strong>{item.count}</strong> {item.label}</> : item.empty}</span><ArrowUpRight size={15} aria-hidden="true" /></a>; })}</div></section>
    <div className="lp-admin-metrics">{metrics.map(m => { const Icon = m.icon; return <Card className="lp-admin-metric" key={m.label}><a href={adminHref(m.page, { ...(m.status ? { status: m.status } : {}), ...(m.view ? { view: m.view } : {}) })}><span>{m.label}</span><Icon size={18} className="lp-admin-metric-icon" aria-hidden="true" /><strong>{m.value.toLocaleString()}</strong><small>{m.hint}</small></a></Card>; })}</div>
    <nav className="lp-admin-quick" aria-label={p.t("常用操作")}><span>{p.t("常用操作")}</span>
      <a href={adminHref('numbers', { status: 'AVAILABLE' })}><Smartphone size={16} />{p.t("手动给用户分配号码")}</a>
      <a href={adminHref('products')}><Pencil size={16} />{p.t("修改商品价格")}</a>
      <a href={adminHref('recharges')}><WalletCards size={16} />{p.t("设置充值规则")}</a>
      <a href={adminHref('agents')}><Plus size={16} />{p.t("新增代理")}</a>
    </nav>
    <Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>{p.t("最近订单")}</h2><a href={adminHref('orders')}>{p.t("全部订单 ")}<ArrowUpRight size={14} /></a></div><OrderTable orders={s.recentOrders} onDetail={id => detail({ section: 'orders', id })} />{!s.recentOrders.length && <p className="lp-admin-context">{p.t("还没有订单")}</p>}</Card>
    <div className="lp-admin-two-column"><Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>{p.t("即将到期的号码")}</h2><a href={adminHref('numbers', { status: 'expiring' })}>{p.t("查看全部 ")}<ArrowUpRight size={14} /></a></div>{s.expiring.length ? <Table columns={[p.t("号码 / 用户"), p.t("到期时间")]} label={p.t("即将到期")}>{s.expiring.map(n => <tr key={n.id}><td><button className="lp-admin-text-button lp-admin-mono" onClick={() => detail({ section: 'numbers', id: n.id })}>{n.phone_number}</button><small>{n.owner_name} · {n.service}</small></td><td><DateText value={n.expires_at} /></td></tr>)}</Table> : <p className="lp-admin-context">{p.t("近 3 天没有到期的号码。")}</p>}</Card>
    <Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>{p.t("系统接入状态")}</h2><span>{p.t("技术人员关注")}</span></div><a className="lp-admin-task" href={adminHref('projects')}><FolderSync size={18} /><span>{p.t("上游号码同步")}</span><Badge value="NOT_CONNECTED" /><ArrowUpRight size={15} /></a><a className="lp-admin-task" href={adminHref('webhooks')}><MessageSquare size={18} /><span>{p.t("上游短信推送")}</span><Badge value="UNVERIFIED" /><ArrowUpRight size={15} /></a><p className="lp-admin-context lp-admin-payment-note"><ShieldCheck size={15} />{p.t("在线支付与退款：未接入，目前使用演示号码库存。")}</p></Card></div>
    <Card id="lp-admin-audit" className="lp-admin-section"><div className="lp-admin-section-heading"><h2>{p.t("操作记录")}</h2><span>{p.t("谁在什么时候做了什么")}</span></div><State {...audit} columns={5} />{audit.data && <Table columns={[p.t("时间"), p.t("管理员"), p.t("操作"), p.t("对象"), p.t("原因")]} label={p.t("管理审计")}>{audit.data.data.map(a => <tr key={a.id}><td><DateText value={a.created_at} /></td><td>{a.actor_name}</td><td>{({ ADMIN_BOOTSTRAP: p.t("初始化管理员"), USER_STATUS: p.t("修改用户状态"), USER_PASSWORD_RESET: p.t("重置用户密码"), NUMBER_ASSIGN: p.t("分配号码"), NUMBER_RECLAIM: p.t("回收号码"), NUMBER_SALE: p.t("号码上 / 下架"), PRODUCT_CREATE: p.t("创建商品"), PRODUCT_UPDATE: p.t("编辑商品"), RECHARGE_SETTINGS: p.t("修改充值规则"), WEBHOOK_RETRY: p.t("重新处理短信") } as Record<string, string>)[a.action] ?? a.action}</td><td>{/^[0-9a-f-]{36}$/i.test(a.target_id) ? <ShortId value={a.target_id} /> : a.target_id === 'recharge' ? p.t("充值规则") : a.target_id}</td><td className="lp-admin-reason">{a.reason}</td></tr>)}</Table>}<RecordPagination busy={audit.loading} page={auditPage} pageSize={auditPageSize} totalPages={audit.data?.pagination.totalPages ?? 0} totalItems={audit.data?.pagination.totalItems ?? 0} controls="lp-admin-audit" onPageChange={setAuditPage} onPageSizeChange={size => { setAuditPageSize(size); setAuditPage(1); }} /></Card>
  </>;
}
function AdminMain({ user, address, sessionError, retrySession }: { user: User; address: string; sessionError: string; retrySession: () => void }) {
  const p = useDisplayPreferences();
  const path = address.split('?')[0];
  const page: AdminPage = path === '/admin' ? 'dashboard' : path.slice('/admin/'.length) as AdminPage;
  const params = new URLSearchParams(address.split('?')[1] ?? '');
  const legacyOrderStatus = page === 'orders' ? params.get('status') : null;
  const legacyOrderView = legacyOrderStatus === 'today' ? 'today' : ['EXCEPTION', 'UNVERIFIED'].includes(legacyOrderStatus ?? '') ? 'attention' : undefined;
  if (legacyOrderView) { params.delete('status'); if (!params.get('view')) params.set('view', legacyOrderView); }
  useEffect(() => { if (legacyOrderView) navigate(`${path}?${params}`, true); }, [address]);
  const parsed = Number(params.get('page'));
  const provider = params.get('provider');
  const pageNumber = Number.isInteger(parsed) && parsed > 0 && parsed <= 100000 ? parsed : 1;
  const input: Partial<AdminQuery> = { page: pageNumber, pageSize: [5, 10, 20].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20, search: params.get('search') ?? '', status: params.get('status') ?? '', ...(page === 'orders' && (params.get('view') === 'today' || params.get('view') === 'attention') ? { view: params.get('view') as AdminQuery['view'] } : {}), ...(regions.some(r => r.value === params.get('region')) ? { region: params.get('region') as AdminQuery['region'] } : {}), ...(params.get('userId') && z.string().uuid().safeParse(params.get('userId')).success ? { userId: params.get('userId')! } : {}), ...(provider === 'pingcode' || provider === 'pingcode-mock' ? { provider } : {}) };
  const [search, setSearch] = useState(input.search ?? '');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [product, setProduct] = useState<AdminProduct | null | undefined>(undefined);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const { pending } = useAdminActivity();
  const refreshLock = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => { if (pending > 0) refreshLock.current = false; }, [pending]);
  useEffect(() => { setSearch(new URLSearchParams(address.split('?')[1]).get('search') ?? ''); setDetail(null); setAction(null); setProduct(undefined); setSyncingProducts(false); document.title = `${p.t(adminTitles[page])} · LINEPOOL Admin`;}, [address, page]);
  function update(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); navigate(`${path}${next.size ? `?${next}` : ''}`); }
  function success() { setAction(null); setProduct(undefined); setRevision(x => x + 1); toast.success(p.t("操作成功，已记录审计日志。")); }
  async function logout() { setLoggingOut(true); try { await api.logout(); queryClient.clear(); navigate('/login'); } catch (cause) { toast.error(errorMessage(cause)); } finally { setLoggingOut(false); } }
  function refresh() { if (pending || refreshLock.current) return; refreshLock.current = true; setRevision(x => x + 1); }
  const listProps = { input, revision, detail: setDetail, action: setAction, update };
  return <TooltipProvider delayDuration={300}><SidebarProvider className="lp-admin lp-admin-theme" data-theme={p.theme}>
    <AdminSidebar page={page} />
    <div className="lp-admin-main"><header className="lp-admin-header"><div className="lp-admin-header-leading"><AdminTooltip label={p.t("展开 / 收起导航")} side="bottom"><SidebarTrigger className="lp-admin-button lp-admin-sidebar-trigger" aria-label={p.t("展开 / 收起导航")} /></AdminTooltip><nav className="lp-admin-breadcrumb" aria-label={p.t("面包屑")}><span>{p.t("平台管理")}</span><span aria-hidden="true">/</span><span aria-current="page">{p.t(adminTitles[page])}</span></nav></div><div className="lp-admin-header-actions"><AdminTooltip label={p.t("刷新数据")}><span><ActionButton variant="ghost" aria-label={p.t("刷新数据")} aria-busy={pending > 0} disabled={pending > 0} onClick={refresh}><RefreshCw size={16} className={pending > 0 ? 'lp-admin-spin' : ''} /><span className="lp-admin-refresh-label">{pending > 0 ? p.t("正在刷新…") : p.t("刷新数据")}</span></ActionButton></span></AdminTooltip><AdminAccountMenu user={user} logout={() => void logout()} busy={loggingOut}>
      <DropdownMenuItem asChild><a href="/"><Home size={16} />{p.t('返回首页')}</a></DropdownMenuItem>
      <DropdownMenuItem asChild><a href="/login?switchAccount=local&redirect=%2Fapp"><ArrowLeft size={16} />{p.t('切换本站账号')}</a></DropdownMenuItem>
    </AdminAccountMenu></div></header>
    <main className="lp-admin-content" aria-busy={pending > 0}>{sessionError && <div className="lp-admin-refresh-error" role="alert"><AlertCircle size={16} /><p>{p.t("权限复核失败：")}{sessionError}</p><ActionButton onClick={retrySession}>{p.t("重试")}</ActionButton></div>}<div key={page} className="lp-admin-page"><div className="lp-admin-page-heading"><div><h1>{p.t(adminTitles[page])}</h1><p className="lp-admin-page-description">{p.t(adminDescriptions[page])}</p></div><div className="lp-admin-actions">{page === 'products' && <><ActionButton onClick={() => setSyncingProducts(true)}><RefreshCw size={16} />{p.t("从上游同步")}</ActionButton><ActionButton variant="accent" onClick={() => setProduct(null)}><Plus size={16} />{p.t("创建商品")}</ActionButton></>}</div></div>
      {page !== 'dashboard' && !['agents', 'inventory', 'connections', 'platforms', 'api-docs', 'webhooks'].includes(page) && <form className="lp-admin-toolbar" onSubmit={e => { e.preventDefault(); update('search', search); }}><AppSearchInput className="lp-admin-search" aria-label={p.t("搜索管理记录")} placeholder={page === 'users' ? p.t("搜索用户名、邮箱或用户 ID") : page === 'numbers' ? p.t("搜索号码、平台或用户") : page === 'products' ? p.t("搜索商品名称或平台") : page === 'projects' ? p.t("搜索平台名称或项目 ID") : page === 'receipts' ? p.t("搜索短信 ID、号码、平台或用户") : p.t("搜索订单或用户")} maxLength={200} value={search} onValueChange={setSearch}><ActionButton size="sm" type="submit">{p.t("搜索")}</ActionButton></AppSearchInput><SelectField aria-label={p.t("状态筛选")} value={input.status ?? ''} onValueChange={v => update('status', v)} options={[{ value: '', label: p.t("全部状态") }, ...translatedFilters(page, p.t)]} />{page === 'orders' && <OrderQuickFilters input={input} revision={revision} update={update} />}{['projects', 'receipts'].includes(page) && <SelectField aria-label={p.t("来源筛选")} value={input.provider ?? ''} onValueChange={v => update('provider', v)} options={[{ value: '', label: p.t("全部来源") }, { value: 'pingcode', label: p.t("上游 PC") }, { value: 'pingcode-mock', label: p.t("演示数据") }]} />}{['numbers', 'products'].includes(page) && <AppCombobox aria-label={p.t("国家筛选")} value={input.region ?? ''} onValueChange={v => update('region', v)} options={[{ value: '', label: p.t("全部国家") }, ...regions]} />}{input.userId && <ActionButton size="sm" onClick={() => update('userId', '')}><X size={14} />{p.t("只看某个用户：清除")}</ActionButton>}</form>}
      <Card className={['dashboard', 'api-docs', 'webhooks'].includes(page) ? 'lp-admin-records-dashboard' : 'lp-admin-records-card'} id="lp-admin-records">{page === 'connections' ? <PcConnections revision={revision} /> : page === 'platforms' ? <PlatformsPage revision={revision} /> : page === 'api-docs' ? <ApiDocumentation /> : page === 'webhooks' ? <WebhookPage {...listProps} /> : page === 'dashboard' ? <Dashboard revision={revision} detail={setDetail} /> : page === 'users' ? <UsersList {...listProps} /> : page === 'numbers' ? <NumbersList {...listProps} /> : page === 'products' ? <><ShopProducts revision={revision} /><details className="lp-admin-tech"><summary>{p.t('全站旧商品（演示模式使用，真实前台不再出售）')}</summary><ProductsList {...listProps} edit={setProduct} /></details></> : page === 'projects' ? <ProjectsList {...listProps} /> : page === 'receipts' ? <ReceiptsList {...listProps} /> : page === 'recharges' ? <RechargesList {...listProps} /> : page === 'agents' ? <AgentsList revision={revision} /> : page === 'inventory' ? <InventoryPage revision={revision} /> : <OrdersList {...listProps} />}</Card>
    </div></main></div>{detail && <Detail target={detail} onClose={() => setDetail(null)} />}{action && <ConfirmAction target={action} onClose={() => setAction(null)} onSuccess={success} />}{product !== undefined && <ProductEditor product={product} onClose={() => setProduct(undefined)} onSuccess={success} />}{syncingProducts && <ProductSyncModal onClose={() => setSyncingProducts(false)} onSuccess={() => { setSyncingProducts(false); setRevision(x => x + 1); }} />}
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
  if (result.errorCode === 'ADMIN_REQUIRED' || (result.data && result.data.data.role !== 'ADMIN')) return <main className="lp-admin-access" data-theme={p.theme}><ShieldCheck size={32} /><h1>{p.t("403 · 无管理后台访问权限")}</h1><p>{p.t("当前账号无法访问管理后台。")}</p><a href="/">{p.t("返回首页")}</a><a href="/login?switchAccount=local&redirect=%2Fapp">{p.t("切换本站账号进入工作台")}</a></main>;
  if (!result.data) return <main className="lp-admin-access" data-theme={p.theme}><a href="/">LINEPOOL</a><State {...result} /></main>;
  return <AdminActivityProvider><AdminMain user={result.data.data} address={address} sessionError={result.error} retrySession={result.retry} /></AdminActivityProvider>;
}
export default function AdminShell({ address }: { address: string }) {
  // Revalidate on navigation without unmounting the authenticated layout.
  return <AdminAccess address={address} />;
}
