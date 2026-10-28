import { isStorefrontRegion } from '@linepool/contracts';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { HoldingBatchSelection, NumberHolding } from '@linepool/contracts';
import { z } from 'zod';
import { AlertCircle, ArrowUpRight, Check, Clock3, Eye, FolderSync, MessageSquare, PackageCheck, Pencil, Plus, RefreshCw, Search, ShieldCheck, Smartphone, Users, WalletCards, X } from 'lucide-react';
import { adminUserSchema, adminNumberSchema, adminProductSchema, adminOrderSchema, adminProjectSchema, adminReceiptSchema, auditSchema,
  type AdminUser, type AdminNumber, type AdminProduct, type AdminOrder, type AdminReceipt, type Allocation, type ProductInput, type AdminQuery } from '@linepool/contracts/admin';
import { serviceSchema, adminRechargeRecordSchema, rechargeRulesSchema, parseRechargeAmount, formatRechargeAmount, rechargeAmountInput,
  type User, type RechargeRules, type RechargeSettings, type PriceRule } from '../api/contracts';
import { createLinepoolApi, LinepoolApiError } from '../api/client';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/skeleton';
import { SidebarProvider, SidebarTrigger } from '../ui/sidebar';
import { TooltipProvider } from '../ui/tooltip';
import { Toaster, toast } from 'sonner';
import { AdminAccountMenu, AdminActivityProvider, AdminSidebar, AdminTooltip, Identifier, useAdminActivity } from './Presentation';
import { ActionButton, Badge, DateText, Facts, IconAction, Modal, RowMenu, ShortId, State, Table, isRowClick, planLabel, regionName, txKindLabel } from './primitives';
import { StockClaimModal, BatchStockClaimModal, ResellHoldingModal } from './SettlementModals';
import SettlementOrderDrawer from '../agent/SettlementOrderDrawer';
import AdminPriceEditor from '../agent/SettlementPriceEditor';
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
import AdminHoldingBatchModal from './AdminHoldingBatchModal';
import './admin.css';

const api = createLinepoolApi();
const canUseLocalInventoryImport = import.meta.env.DEV;
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

function localInput(value: Date | string | number) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
/** Points are debited at checkout, so one status is enough unless settlement or delivery needs attention. */
function orderStatus(o: AdminOrder) {
  if (o.fulfillment_status !== 'COMPLETED') return o.fulfillment_status;
  return o.payment_status === 'POINTS_DEBITED' ? 'COMPLETED' : o.payment_status;
}
/** An allocation's service state comes from its expiry, independently of the selected filter. */
function NumberStatus({ number: n }: { number: AdminNumber }) {
  const expiresAt = n.expires_at ? Date.parse(n.expires_at) : Number.NaN;
  const remaining = expiresAt - Date.now();
  const status = !n.assigned_user_id || !Number.isFinite(expiresAt) ? n.sale_status
    : remaining <= 0 ? 'SERVICE_EXPIRED'
    : remaining <= 3 * 24 * 60 * 60 * 1000 ? 'SERVICE_EXPIRING' : 'SERVICE_ACTIVE';
  return <div className="lp-admin-badges"><Badge value={status} />{(n.resource_status === 'OFFLINE' || n.resource_status === 'ERROR') && <Badge value={n.resource_status} />}</div>;
}
/** Reason is required by the audit log; quick picks save typing for routine operations. */
function ReasonField({ value, onChange, disabled, suggestions, label = '操作原因' }: { value: string; onChange: (value: string) => void; disabled?: boolean; suggestions: string[]; label?: string }) {
  const p = useDisplayPreferences();
  return <div className="lp-admin-reason-field lp-admin-span"><label>{label}<Textarea required minLength={3} maxLength={500} rows={2} placeholder={p.t("简单写一句，方便以后查记录（至少 3 个字）")} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} /></label>
    <div className="lp-admin-reason-chips" aria-label={p.t("常用原因")}>{suggestions.map(text => <button type="button" key={text} disabled={disabled} data-active={value === text || undefined} onClick={() => onChange(text)}>{text}</button>)}</div></div>;
}
function AllocationTable({ items }: { items: Allocation[] }) {
  const p = useDisplayPreferences();
  return <Table columns={[p.t("号码 / 平台"), p.t("用户"), p.t("分配时间"), p.t("原服务到期"), p.t("归属状态")]} label={p.t("归属历史")}><>{items.map(item => <tr key={item.id}><td>{item.phone_number}<small>{item.platform_id}</small></td><td>{item.owner_name}</td><td><DateText value={item.assigned_at} /></td><td><DateText value={item.expires_at} /></td><td>{item.released_at ? <><Badge value="CANCELLED" /><small>{p.t("回收于 ")}<DateText value={item.released_at} /></small></> : p.t("当前归属")}</td></tr>)}{!items.length && <tr><td colSpan={5}>{p.t("暂无归属记录")}</td></tr>}</></Table>;
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
  ]} /><h3>{p.t("分配历史 · 最近 50 条")}</h3><AllocationTable items={allocations} />
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
  ]} /><h3>{p.t("交付的号码")}</h3><AllocationTable items={allocations} /><details className="lp-admin-tech"><summary>{p.t("技术信息 · 购买时商品快照")}</summary><pre className="lp-admin-json">{JSON.stringify(o.product_snapshot, null, 2)}</pre></details></>;
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
      <label>{p.t("目标用户")}<AppCombobox aria-label={p.t("目标用户")} value={userId} disabled={busy || users.loading} onValueChange={setUserId} options={[{ value: '', label: p.t("请选择用户") }, ...(users.data?.data ?? []).map(user => ({ value: user.id, label: `${user.display_name} · ${user.email}` }))]} /></label>
      <label>{p.t("服务天数")}<AppCombobox aria-label={p.t("分配服务天数")} value={days} onValueChange={setDays} options={[{ value: '7', label: p.t("7 天") }, { value: '30', label: p.t("30 天") }]} disabled={busy} /></label></>}
    <ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={target.kind === 'password' ? [p.t("用户忘记密码"), p.t("用户申请重置")] : target.kind === 'user' ? target.user.account_status === 'ACTIVE' ? [p.t("违规使用"), p.t("用户申请注销")] : [p.t("申诉通过，恢复使用")] : target.kind === 'assign' ? [p.t("客户补发号码"), p.t("线下付款开通"), p.t("测试使用")] : target.kind === 'reclaim' ? [p.t("客户退订"), p.t("服务到期回收"), p.t("分配错误")] : [p.t("号码异常暂停售卖"), p.t("恢复售卖")]} />{error && <p role="alert" className="lp-admin-error">{error}</p>}
    </div><footer><ActionButton disabled={busy} onClick={onClose}>{p.t("取消")}</ActionButton><ActionButton variant="accent" type="submit" busy={busy} disabled={target.kind === 'assign' && !userId}><Check size={15} />{p.t("确认")}{title}</ActionButton></footer></form></Modal>;
}
function ProductEditor({ product, onClose, onSuccess }: { product: AdminProduct | null; onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const [value, setValue] = useState<ProductInput>(() => product ? { region: product.region_id, service: product.service, plan: product.plan, name: product.name, durationDays: product.duration_days === 7 ? 7 : 30, unitPoints: product.unit_points, isActive: product.is_active, areaPrefix: product.area_prefix, capability: 'RECEIVE', allowRenewal: false, reason: '' }
    : { region: 'us', service: 'Telegram', plan: '', name: '', durationDays: 30, unitPoints: 15, isActive: false, areaPrefix: '', capability: 'RECEIVE', allowRenewal: false, reason: '' });
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
  // New products get a sensible name and plan ID from the chosen duration unless the operator typed one.
  const defaultName = p.t("{value1} 天短期服务", { value1: value.durationDays });
  const defaultPlan = value.durationDays === 7 ? 'week' : 'month';
  async function submit() { setBusy(true); setError(''); try { await api.adminSaveProduct({ ...value, name: value.name.trim() || defaultName, plan: value.plan || defaultPlan }, !product); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title={product ? p.t("编辑商品") : p.t("创建商品")} busy={busy} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><fieldset disabled={busy} className="lp-admin-form-grid">
    {!isStorefrontRegion(value.region) && <p className="lp-admin-warning lp-admin-span">{p.t('该国家前台暂未开放，保存后用户也无法购买')}</p>}
    {product ? <p className="lp-admin-confirm-target lp-admin-span">{product.country} · {product.service}<small>{p.t("国家和平台创建后不能修改")}</small></p>
      : offered.loading && !offered.data ? <p className="lp-admin-context lp-admin-span">{p.t("正在读取上游提供的国家和平台…")}</p>
      : offered.error ? <p className="lp-admin-error lp-admin-span">{offered.error}</p>
      : !offeredOptions.length ? <p className="lp-admin-warning lp-admin-span">{p.t("上游还没有提供任何号码，暂时不能创建商品。上游号码入库后，这里会自动出现可选的国家和平台。")}</p>
      : <label className="lp-admin-span">{p.t("国家 · 平台")}<AppCombobox aria-label={p.t("商品国家和平台")} disabled={busy} value={offeredKey} onValueChange={v => { const [region, service] = v.split('/'); setValue(current => ({ ...current, region: region as ProductInput['region'], service: service as ProductInput['service'] })); }}
          options={offeredOptions.map(option => ({ value: `${option.region}/${option.service}`, label: p.t("{value1} · {value2}（上游可用 {value3} 个{value4}）", { value1: option.country, value2: option.service, value3: option.availableCount, value4: option.productCount ? ` · 已有 ${option.productCount} 个商品` : '' }) }))} /><small>{p.t("只列出上游实际提供号码的组合，不能创建上游没有的国家或平台")}</small></label>}
    <label>{p.t("服务天数")}<AppCombobox aria-label={p.t("商品服务天数")} disabled={busy} value={String(value.durationDays)} onValueChange={v => set('durationDays', v === '7' ? 7 : 30)} options={[{ value: '7', label: p.t("7 天") }, { value: '30', label: p.t("30 天") }]} /><small>{p.t("用户买到号码后可以使用的天数")}</small></label>
    {product && product.duration_days !== 7 && product.duration_days !== 30 && <p className="lp-admin-context lp-admin-span">{p.t("原商品为 ")}{product.duration_days}{p.t(" 天，保存时使用本次所选的 7/30 天。")}</p>}
    <label>{p.t("价格（积分）")}<Input type="number" required min={1} max={1000000} value={value.unitPoints} onChange={e => set('unitPoints', Number(e.target.value))} /><small>{p.t("每个号码扣多少积分")}</small></label>
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
        const base = { currency, fractionDigits, minimumMinor: 1, maximumMinor: Number.MAX_SAFE_INTEGER, presetsMinor: [], exchangeAmountMinor: null, exchangePoints: null };
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
        const parsed = rechargeRulesSchema.safeParse({ currency, fractionDigits, minimumMinor, maximumMinor, presetsMinor,
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
  'api-docs': [], webhooks: [],
  dashboard: [], users: [{ value: 'ACTIVE', label: '正常' }, { value: 'DISABLED', label: '已禁用' }],
  numbers: [{ value: 'AVAILABLE', label: '可售' }, { value: 'ASSIGNED', label: '已分配' }, { value: 'UNSELLABLE', label: '不可售' }, { value: 'expiring', label: '3 天内到期' }, { value: 'ACTIVE', label: '服务有效' }, { value: 'ERROR', label: '号码异常' }, { value: 'OFFLINE', label: '号码离线' }],
  products: [{ value: 'ACTIVE', label: '已上架' }, { value: 'INACTIVE', label: '已下架' }],
  projects: [{ value: 'ACTIVE', label: '已启用' }, { value: 'INACTIVE', label: '已停用' }],
  receipts: [{ value: 'IMPORTED', label: '已分发' }, { value: 'UNMATCHED', label: '未匹配用户' }, { value: 'PENDING', label: '待处理' }],
  agents: [{ value: 'ACTIVE', label: '正常' }, { value: 'SUSPENDED', label: '已暂停' }, { value: 'TERMINATED', label: '已终止' }],
  inventory: [{ value: 'ACTIVE', label: '持有中' }, { value: 'SUSPENDED', label: '已暂停' }, { value: 'RETIRED', label: '已退出库存' }],
  recharges: [{ value: 'PENDING', label: '待支付' }, { value: 'SUCCEEDED', label: '已到账' }, { value: 'FAILED', label: '失败' }, { value: 'EXPIRED', label: '已超时' }, { value: 'CANCELLED', label: '已取消' }],
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
  return <><State {...result} columns={6} empty={result.data?.data.length === 0} />{result.data && <Table columns={[p.t("用户"), p.t("积分余额"), p.t("号码"), p.t("订单"), p.t("状态"), p.t("注册时间"), '']} label={p.t("用户管理")}>{result.data.data.map(u => <tr key={u.id} className="lp-admin-clickable" onClick={event => { if (isRowClick(event)) detail({ section: 'users', id: u.id }); }}><td><strong>{u.display_name}{u.role === 'ADMIN' && <span className="lp-admin-inline-tag">{p.t("管理员")}</span>}</strong><small>{u.email}</small></td><td className="lp-admin-numeric"><strong>{u.points_balance.toLocaleString()}</strong></td><td className="lp-admin-numeric">{u.number_count}</td><td className="lp-admin-numeric">{u.order_count}</td><td><Badge value={u.account_status} /></td><td><DateText value={u.created_at} /></td><td><div className="lp-admin-row-actions"><IconAction label={p.t("查看用户详情")} onClick={() => detail({ section: 'users', id: u.id })}><Eye size={16} /></IconAction><RowMenu label={p.t("更多操作")} items={u.role === 'ADMIN' ? [] : [{ label: p.t("查看该用户订单"), onSelect: () => navigate(adminHref('orders', { userId: u.id })) }, { label: p.t("重置密码"), onSelect: () => action({ kind: 'password', user: u }) }, { label: u.account_status === 'ACTIVE' ? p.t("禁用账号") : p.t("启用账号"), danger: u.account_status === 'ACTIVE', onSelect: () => action({ kind: 'user', user: u }) }]} /></div></td></tr>)}</Table>}<Pager result={result} input={input} update={update} /></>;
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
  return <><State {...result} columns={7} empty={result.data?.data.length === 0} />{result.data && <Table columns={[p.t("平台"), p.t("套餐"), p.t("天数"), p.t("价格"), p.t("库存"), p.t("状态"), '']} label={p.t("商品管理")}>{rows.map((o, index) => <Fragment key={`${o.region_id}/${o.service}/${o.plan}`}>
    {o.region_id !== rows[index - 1]?.region_id && <tr className="lp-admin-group-row"><th colSpan={7} scope="rowgroup">{o.country}{!isStorefrontRegion(o.region_id) && <Badge value="STOREFRONT_CLOSED" />}<small>{rows.filter(item => item.region_id === o.region_id).length}{p.t(" 个套餐")}</small></th></tr>}
    <tr className="lp-admin-clickable" onClick={event => { if (isRowClick(event)) edit(o); }}><td><strong>{o.service}</strong></td><td>{o.name}{o.area_prefix && <small>{p.t("号段 ")}{o.area_prefix}</small>}</td><td>{o.duration_days}{p.t(" 天")}</td><td><strong>{o.unit_points}</strong>{p.t(" 积分")}</td><td className={o.available_count + o.pc_available_count === 0 ? 'lp-admin-low-stock' : undefined}>{o.available_count + o.pc_available_count}{p.t(" 个")}{o.available_count + o.pc_available_count === 0 && <small>{p.t("已无库存")}</small>}</td><td><Badge value={!isStorefrontRegion(o.region_id) ? 'STOREFRONT_CLOSED' : o.is_active ? 'PRODUCT_ON' : 'PRODUCT_OFF'} /></td><td><IconAction label={p.t("编辑价格和上下架")} onClick={() => edit(o)}><Pencil size={16} /></IconAction></td></tr>
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
  {onProcessed && selected.provider === 'pingcode' && selected.processing_status !== 'IMPORTED' && <form className="lp-webhook-retry" onSubmit={event => { event.preventDefault(); void reprocess(); }}>
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
  return <><State {...status} />{status.data && <WebhookManagement status={status.data.data}>
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
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<'agent' | 'customer' | null>(null);
  return <><div className="lp-admin-section-heading"><p className="lp-admin-context">{p.t("代理和客户都要先有一个注册账号（在「用户管理」里能看到）。")}<strong>{p.t("代理")}</strong>{p.t("负责批量拿号转卖；")}<strong>{p.t("客户")}</strong>{p.t("是某个代理名下的终端用户，代理可以给他分号码、转余额。不选代理的客户直属平台。")}</p><div className="lp-admin-actions"><ActionButton variant="accent" onClick={() => setEditor('agent')}><Plus size={16} />{p.t("创建代理")}</ActionButton><ActionButton onClick={() => setEditor('customer')}><Plus size={16} />{p.t("创建客户")}</ActionButton></div></div><State {...result} columns={6} empty={result.data?.data.length === 0} />
    {result.data && <Table columns={[p.t("代理名称"), p.t("级别"), p.t("上级代理"), p.t("余额"), p.t("持有号码"), p.t("状态"), '']} label={p.t("代理管理")}>{result.data.data.map(a => <tr key={a.id}>
      <td><strong>{a.name}</strong>{a.email && <small>{a.email}</small>}</td><td>{a.level === 1 ? p.t("一级代理") : p.t("二级代理")}</td><td>{a.parentAgentId ? <button className="lp-admin-text-button" onClick={() => setSelected(a.parentAgentId!)}>{result.data!.data.find(x => x.id === a.parentAgentId)?.name ?? a.parentAgentId}</button> : <span className="lp-admin-faint">{p.t("直属平台")}</span>}</td>
      <td className="lp-admin-numeric">{a.balanceMinor !== undefined ? `${(a.balanceMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD` : '—'}</td><td className="lp-admin-numeric">{a.holdingCount ?? '—'}</td>
      <td><Badge value={a.status} /></td>
      <td><IconAction label={p.t("查看余额流水")} onClick={() => setSelected(a.id)}><Eye size={16} /></IconAction></td>
    </tr>)}</Table>}
    {selected && <LedgerDrawer ownerType="AGENT" ownerId={selected} title={p.t("代理余额流水")} onClose={() => setSelected(null)} />}
    {editor && <AgentEditor kind={editor} onClose={() => setEditor(null)} onSuccess={() => { setEditor(null); result.retry(); toast.success(editor === 'agent' ? `代理已创建，请把 ${window.location.origin}/agent 发给对方。` : p.t("客户已创建。")); }} />}</>;
}
function AgentEditor({ kind, onClose, onSuccess }: { kind: 'agent' | 'customer'; onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const [userSearch, setUserSearch] = useState('');
  const [userTerm, setUserTerm] = useState('');
  const users = useResource(`admin-action-users:${userTerm}`, signal => api.adminList('users', adminUserSchema, { page: 1, pageSize: 20, status: 'ACTIVE', search: userTerm }, { signal }));
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
  return <Modal title={kind === 'agent' ? p.t("创建代理") : p.t("创建客户")} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-context">{kind === 'agent' ? p.t("把一个已注册的普通用户升级为代理。代理可以从平台拿号，再分给自己的下级代理或客户。") : p.t("把一个已注册的普通用户登记为某个代理名下的客户。之后该代理就能给这个客户分配号码、转账余额。")} {p.t("可按昵称、邮箱或用户 ID 搜索绑定用户。")} </p><AppSearchInput className="lp-admin-search" aria-label={p.t("搜索绑定用户")} placeholder={p.t("昵称、邮箱或用户 ID")} value={userSearch} onValueChange={setUserSearch} disabled={busy} loading={users.loading}><ActionButton size="sm" type="button" onClick={() => setUserTerm(userSearch.trim())} disabled={busy}>{p.t("搜索")}</ActionButton></AppSearchInput><fieldset disabled={busy} className="lp-admin-form-grid">
    <label className="lp-admin-span">{p.t("绑定用户")}<AppCombobox aria-label={p.t("绑定用户")} value={userId} onValueChange={setUserId} options={[{ value: '', label: users.loading ? p.t("正在加载用户…") : p.t("请选择普通用户") }, ...eligibleUsers.map(user => ({ value: user.id, label: `${user.display_name} · ${user.email}` }))]} /></label>
    <label className="lp-admin-span">{kind === 'agent' ? p.t("代理名称") : p.t("客户名称")}<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'agent' ? p.t("例如：华东代理") : p.t("例如：测试客户")} /></label>
    {kind === 'agent' && <label className="lp-admin-span">{p.t("上级代理（可选）")}<AppCombobox aria-label={p.t("上级代理")} value={parentAgentId} onValueChange={setParentAgentId} options={[{ value: '', label: p.t("顶层代理") }, ...(agents.data?.data ?? []).filter(agent => agent.level === 1 && agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }))]} /></label>}
    {kind === 'customer' && <label className="lp-admin-span">{p.t("所属代理（可选）")}<AppCombobox aria-label={p.t("所属代理")} value={agentId} onValueChange={setAgentId} options={[{ value: '', label: p.t("平台客户") }, ...(agents.data?.data ?? []).filter(agent => agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }))]} /></label>}
    {users.error && <p className="lp-admin-error lp-admin-span">{users.error}</p>}{agents.error && <p className="lp-admin-error lp-admin-span">{agents.error}</p>}{error && <p role="alert" className="lp-admin-error lp-admin-span">{error}</p>}
  </fieldset></div><footer><ActionButton onClick={onClose} disabled={busy}>{p.t("取消")}</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!userId || !name.trim()}><Check size={16} />{p.t("确认创建")}</ActionButton></footer></form></Modal>;
}
function LedgerDrawer({ ownerType, ownerId, title, onClose }: { ownerType: 'AGENT' | 'CUSTOMER'; ownerId: string; title: string; onClose: () => void }) {
  const p = useDisplayPreferences();
  const [page, setPage] = useState(1);
  const [orderId, setOrderId] = useState<string | null>(null);
  const result = useResource(`ledger:${ownerType}:${ownerId}:${page}`, signal => api.agentLedger(ownerType === 'AGENT' ? { ownerType, agentId: ownerId } : { ownerType, customerId: ownerId }, page, 20, { signal }), 0);
  const d = result.data?.data;
  return <Modal title={title} variant="drawer" onClose={onClose}><div className="lp-admin-dialog-body">
    {d && <Facts rows={[[p.t("当前余额"), <strong className="lp-admin-big-number">{(d.balanceMinor / 100).toLocaleString()} {d.currency}</strong>], [p.t("主体 ID"), <Identifier value={ownerId} />]]} />}
    <State {...result} columns={5} empty={Boolean(d) && d!.entries.length === 0} />
    {d && d.entries.length > 0 && <Table columns={[p.t("时间"), p.t("类型"), p.t("变动"), p.t("变动后余额"), p.t("说明")]} label={p.t("余额流水")}>{d.entries.map(e => <tr key={e.id}>
      <td><DateText value={e.createdAt} /></td><td>{e.description === '下级进货收入' ? p.t('下级进货收入') : e.type === 'ORDER_DEBIT' ? p.t('进货扣款') : e.type}</td>
      <td className="lp-admin-numeric" style={{ color: e.delta < 0 ? 'var(--lp-danger, #c0392b)' : undefined }}>{e.delta > 0 ? '+' : ''}{(e.delta / 100).toFixed(2)}</td>
      <td className="lp-admin-numeric">{(e.balanceAfter / 100).toFixed(2)}</td><td>{e.description}{e.txOrderId && <ActionButton size="sm" onClick={() => setOrderId(e.txOrderId)}>{p.t('查看订单')}</ActionButton>}</td>
    </tr>)}</Table>}
    {orderId && <SettlementOrderDrawer id={orderId} onClose={() => setOrderId(null)} />}
    <RecordPagination busy={result.loading} page={page} pageSize={20} totalPages={result.data?.pagination.totalPages ?? 0} totalItems={result.data?.pagination.totalItems ?? 0} controls="lp-admin-ledger" onPageChange={setPage} onPageSizeChange={() => {}} />
  </div></Modal>;
}
function StockImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const [text, setText] = useState('platformId,externalProjectId,externalNumberId,phoneNumber,regionId,resourceStatus,resourceExpiresAt\\nTelegram,Telegram,local-001,+15551234567,us,LOCAL,');
  const [reason, setReason] = useState(p.t("管理员导入本地测试库存"));
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
      if (parsed.some(row => !row.platformId || !row.externalProjectId || !row.phoneNumber || !row.regionId)) throw new Error(p.t("每行必须填写平台、项目、号码和地区。"));
      await api.agentImportStock({ rows: parsed.map(({ line: _line, ...row }) => row), idempotencyKey: globalThis.crypto.randomUUID(), reason });
      onSuccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : errorMessage(cause)); } finally { setBusy(false); }
  }
  return <Modal title={p.t("导入号码")} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <p className="lp-admin-context">{p.t("可以直接从 Excel 复制粘贴。每行一个号码，列顺序为：平台、项目、外部编号、号码（带 +）、国家代码（如 us）、状态、到期时间。第一行示例可替换掉。")}</p>
    <label>{p.t("号码数据")}<Textarea required rows={10} value={text} onChange={event => setText(event.target.value)} disabled={busy} /><small>{p.t("当前为本地测试库存，不会向上游采购。")}</small></label>
    <label>{p.t("导入原因")}<Textarea required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
    {error && <p role="alert" className="lp-admin-error">{error}</p>}
  </div><footer><ActionButton onClick={onClose} disabled={busy}>{p.t("取消")}</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={16} />{p.t("导入库存")}</ActionButton></footer></form></Modal>;
}
function ReleaseHoldingModal({ holdingId, onClose, onSuccess }: { holdingId: string; onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const [reason, setReason] = useState(p.t("号码回收到本地库存")); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() { setBusy(true); setError(''); try { await api.agentReleaseHolding(holdingId, { reason, idempotencyKey: globalThis.crypto.randomUUID() }); onSuccess(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <Modal title={p.t("释放号码回到库存")} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body"><p className="lp-admin-warning">{p.t("释放会结束代理持有记录，并将号码重新标记为可分配。释放不退还已付货款。")}</p><label>{p.t("操作原因")}<Textarea required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} /></label>{error && <p role="alert" className="lp-admin-error">{error}</p>}</div><footer><ActionButton onClick={onClose} disabled={busy}>{p.t("取消")}</ActionButton><ActionButton type="submit" variant="accent" busy={busy}><Check size={15} />{p.t("确认释放")}</ActionButton></footer></form></Modal>;
}
function InventoryPage() {
  const p = useDisplayPreferences();
  const [tab, setTab] = useState<'stock' | 'holdings' | 'balances' | 'prices' | 'transactions'>('stock');
  const [incomePeriod, setIncomePeriod] = useState<'today' | '7d' | '30d'>('7d');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<'holding' | 'adjust' | 'transfer' | null>(null);
  const [stockImport, setStockImport] = useState(false);
  const [selectedStockIds, setSelectedStockIds] = useState<string[]>([]);
  const [batchClaimStock, setBatchClaimStock] = useState(false);
  const [claimStock, setClaimStock] = useState<{ id: string; platformId: 'Telegram' | 'WhatsApp' | 'Google'; phoneNumber: string; resourceExpiresAt: string | null } | null>(null);
  const [releaseHolding, setReleaseHolding] = useState<string | null>(null);
  const [resellHolding, setResellHolding] = useState<{ id: string; agentId: string | null; phoneNumber: string; startsAt: string; expiresAt: string | null } | null>(null);
  const [priceEdit, setPriceEdit] = useState<PriceRule | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [ledgerAgent, setLedgerAgent] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ ownerType: 'AGENT' | 'CUSTOMER'; ownerId: string } | null>(null);
  // Stock and holdings are paged on the server so very large inventories stay fast; selection survives page changes.
  const [stockFilter, setStockFilter] = useState<{ status: '' | 'AVAILABLE' | 'ALLOCATED' | 'RELEASED'; platform: '' | 'Telegram' | 'WhatsApp' | 'Google'; region: '' | 'us' | 'gb' | 'ca' | 'sg' | 'de' | 'nl' }>({ status: 'AVAILABLE', platform: '', region: '' });
  const [stockPage, setStockPage] = useState<{ page: number; pageSize: 5 | 10 | 20 }>({ page: 1, pageSize: 20 });
  const [holdingRegion, setHoldingRegion] = useState<'' | 'us' | 'gb' | 'ca' | 'sg' | 'de' | 'nl'>('');
  const [holdingAgent, setHoldingAgent] = useState('');
  const [selectedHoldings, setSelectedHoldings] = useState<Map<string, NumberHolding>>(new Map());
  const [allFilteredHoldings, setAllFilteredHoldings] = useState(false);
  const [holdingBatch, setHoldingBatch] = useState<{ selection: HoldingBatchSelection; sourceAgentId: string } | null>(null);
  const [holdingPage, setHoldingPage] = useState<{ page: number; pageSize: 5 | 10 | 20 }>({ page: 1, pageSize: 20 });
  const clearHoldingSelection = () => { setSelectedHoldings(new Map()); setAllFilteredHoldings(false); };
  const refresh = () => { setSelectedStockIds([]); clearHoldingSelection(); setRevision(x => x + 1); };
  function filterStock(next: Partial<typeof stockFilter>) { setStockFilter(current => ({ ...current, ...next })); setStockPage(current => ({ ...current, page: 1 })); setSelectedStockIds([]); }
  const stockInput = { search: query, ...stockFilter, ...stockPage };
  const holdingInput = { search: query, region: holdingRegion, agentId: holdingAgent || undefined, ...holdingPage };
  const stock = useResource(`stock:${revision}:${JSON.stringify(stockInput)}`, signal => api.agentStock(stockInput, { signal }), revision);
  const holdings = useResource(`holdings:${revision}:${JSON.stringify(holdingInput)}`, signal => api.agentHoldings(holdingInput, { signal }), revision);
  const pageAvailable = stock.data?.data.filter(item => item.status === 'AVAILABLE') ?? [];
  const regionOptions = [{ value: '', label: p.t("全部国家") }, ...regions];
  const balances = useResource(`balances:${revision}`, signal => api.agentBalances({ signal }), revision);
  const prices = useResource(`prices:${revision}`, signal => api.agentPrices({ signal }), revision);
  const income = useResource(`platform-income:${revision}:${incomePeriod}`, signal => api.agentPlatformSettlement(incomePeriod, { signal }), revision);
  const transactions = useResource(`tx:${revision}:${page}`, signal => api.agentTransactions(page, 20, { signal }), revision);
  const agents = useResource(`inventory-agents:${revision}`, signal => api.agentAgents({ signal }), revision);
  const customers = useResource(`inventory-customers:${revision}`, signal => api.agentCustomers({ signal }), revision);
  const ownerName = (agentId: string | null | undefined, customerId: string | null | undefined) =>
    (agentId ? agents.data?.data.find(item => item.id === agentId)?.name : customers.data?.data.find(item => item.id === customerId)?.name) ?? null;
  const pageTransferable = holdings.data?.data.filter(holding => holding.transferable === true) ?? [];
  const selectedOwners = new Set([...selectedHoldings.values()].map(holding => holding.agentId).filter((id): id is string => Boolean(id)));
  const batchSourceAgent = allFilteredHoldings ? holdingAgent : selectedOwners.size === 1 ? [...selectedOwners][0] : '';
  const holdingSelectionCount = allFilteredHoldings ? p.t('已选择当前筛选结果中全部可转交号码（跨页）') : `${p.t('已勾选')} ${selectedHoldings.size.toLocaleString()} ${p.t('个号码（可跨页）')}`;
  function selectHoldings(rows: NumberHolding[], checked: boolean) {
    setSelectedHoldings(previous => {
      const next = new Map(previous);
      for (const holding of rows) {
        if (checked && next.size < 10000) next.set(holding.id, holding);
        else if (!checked) next.delete(holding.id);
      }
      return next;
    });
  }
  const tabs = [['stock', p.t("号码库存"), p.t("来自总库存的号码 × 平台资源；在这里把可售资源分给代理")], ['holdings', p.t("代理持有"), p.t("代理手里现有的号码")], ['balances', p.t("余额"), p.t("代理和客户的账户余额")], ['prices', p.t("价格"), p.t("代理拿货价和零售价")], ['transactions', p.t("交易流水"), p.t("所有余额变动")]] as const;
  return <>
    <div className="lp-admin-tabs" role="tablist" aria-label={p.t("代理库存视图")}>
      {tabs.map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={tab === key} className="lp-admin-tab" onClick={() => setTab(key)}>{label}</button>)}
      <AdminTooltip label={p.t("刷新数据")}><span className="lp-admin-tabs-refresh"><ActionButton variant="ghost" size="icon" className="lp-admin-icon-button" aria-label={p.t("刷新数据")} onClick={refresh}><RefreshCw size={16} /></ActionButton></span></AdminTooltip>
    </div>
    <div className="lp-admin-tab-toolbar"><p className="lp-admin-context">{tabs.find(([key]) => key === tab)?.[2]}{tab === 'stock' && p.t("，可跨页勾选后一次分配。")}</p><div className="lp-admin-actions">
      {tab === 'stock' && canUseLocalInventoryImport && <ActionButton onClick={() => setStockImport(true)}><Plus size={16} />{p.t("导入号码（开发）")}</ActionButton>}
      {tab === 'holdings' && canUseLocalInventoryImport && <ActionButton onClick={() => setAction('holding')}><Plus size={16} />{p.t("手动录入代理号码（开发）")}</ActionButton>}
      {tab === 'prices' && <ActionButton variant="accent" onClick={() => setPriceEdit('new')}><Plus size={16} />{p.t("新增代理价格")}</ActionButton>}
    </div></div>
    {tab === 'stock' && <div className="lp-admin-status-chips" role="group" aria-label={p.t("按状态查看")}>
      {([['AVAILABLE', p.t("可分配")], ['ALLOCATED', p.t("已分配给代理")], ['RELEASED', p.t("已释放")], ['', p.t("全部")]] as const).map(([value, label]) => {
        const counts = stock.data?.counts;
        const count = counts ? value ? counts[value] : counts.AVAILABLE + counts.ALLOCATED + counts.RELEASED : null;
        return <button type="button" key={label} aria-pressed={stockFilter.status === value} onClick={() => filterStock({ status: value })}>{label}{count !== null && <span>{count.toLocaleString()}</span>}</button>;
      })}
    </div>}
    {(tab === 'stock' || tab === 'holdings') && <form className="lp-admin-toolbar lp-admin-tab-search" onSubmit={e => { e.preventDefault(); setStockPage(current => ({ ...current, page: 1 })); setHoldingPage(current => ({ ...current, page: 1 })); setSelectedStockIds([]); clearHoldingSelection(); setQuery(search); }}>
      <AppSearchInput className="lp-admin-search" aria-label={p.t("搜索号码")} placeholder={p.t("搜索号码")} maxLength={64} value={search} onValueChange={setSearch}><ActionButton size="sm" type="submit">{p.t("搜索")}</ActionButton></AppSearchInput>
      {tab === 'stock' && <SelectField aria-label={p.t("平台筛选")} value={stockFilter.platform} onValueChange={value => filterStock({ platform: value as typeof stockFilter.platform })} options={[{ value: '', label: p.t("全部平台") }, ...serviceSchema.options.map(v => ({ value: v, label: v }))]} />}
      {tab === 'holdings' && <AppCombobox aria-label={p.t('持有代理筛选')} value={holdingAgent} onValueChange={value => { setHoldingAgent(value); setHoldingPage(current => ({ ...current, page: 1 })); clearHoldingSelection(); }} options={[{ value: '', label: p.t('全部持有人') }, ...(agents.data?.data ?? []).map(agent => ({ value: agent.id, label: agent.name }))]} searchPlaceholder={p.t('搜索代理')} emptyMessage={p.t('没有匹配的代理')} />}
      <AppCombobox aria-label={p.t("国家筛选")} value={tab === 'stock' ? stockFilter.region : holdingRegion} onValueChange={value => { if (tab === 'stock') filterStock({ region: value as typeof stockFilter.region }); else { setHoldingRegion(value as typeof holdingRegion); setHoldingPage(current => ({ ...current, page: 1 })); clearHoldingSelection(); } }} options={regionOptions} />
    </form>}
    {tab === 'stock' && selectedStockIds.length > 0 && <div className="lp-admin-selection-bar" role="status"><span>{p.t("已选择 ")}<strong>{quantityLabel(selectedStockIds.length, p.language)}</strong>{p.t("（翻页后仍保留）")}</span><ActionButton size="sm" variant="ghost" onClick={() => setSelectedStockIds([])}>{p.t("清空选择")}</ActionButton><ActionButton size="sm" variant="accent" onClick={() => setBatchClaimStock(true)}><Users size={15} />{p.t("分配给代理")}</ActionButton></div>}
    {tab === 'stock' && <><State {...stock} columns={7} empty={stock.data?.data.length === 0} />{stock.data && <Table columns={[<Checkbox aria-label={p.t("选择本页全部可分配号码")} disabled={!pageAvailable.length} checked={pageAvailable.length > 0 && pageAvailable.every(item => selectedStockIds.includes(item.id))} onCheckedChange={checked => setSelectedStockIds(current => checked === true ? [...new Set([...current, ...pageAvailable.map(item => item.id)])] : current.filter(id => !pageAvailable.some(item => item.id === id)))} />, p.t("号码"), p.t("平台"), p.t("国家"), p.t("状态"), p.t("号码到期"), '']} label={p.t("待分配号码库存")}>{stock.data.data.map(item => <tr key={item.id}><td><Checkbox aria-label={p.t("选择 {value1}", { value1: item.phoneNumber })} checked={selectedStockIds.includes(item.id)} disabled={item.status !== 'AVAILABLE'} onCheckedChange={checked => setSelectedStockIds(current => checked === true ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))} /></td><td><strong className="lp-admin-mono">{item.phoneNumber}</strong></td><td>{item.platformId}</td><td>{regionName(item.regionId)}</td><td><div className="lp-admin-badges"><Badge value={item.status} />{(item.resourceStatus === 'OFFLINE' || item.resourceStatus === 'ERROR') && <Badge value={item.resourceStatus} />}</div></td><td><DateText value={item.resourceExpiresAt} /></td><td>{item.status === 'AVAILABLE' && <ActionButton size="sm" onClick={() => setClaimStock(item)}>{p.t("分配给代理")}</ActionButton>}</td></tr>)}</Table>}
      <RecordPagination busy={stock.loading} page={stockPage.page} pageSize={stockPage.pageSize} totalPages={stock.data?.pagination.totalPages ?? 0} totalItems={stock.data?.pagination.totalItems ?? 0} controls="lp-admin-stock" onPageChange={next => setStockPage(current => ({ ...current, page: next }))} onPageSizeChange={size => setStockPage({ page: 1, pageSize: size })} /></>}
    {tab === 'holdings' && <>
      <div className="lp-admin-selection-bar" role="status"><span>{holdingSelectionCount}</span>
        <ActionButton size="sm" disabled={!holdingAgent || !holdings.data?.pagination.totalItems || holdings.loading || Boolean(holdings.error)} onClick={() => { setAllFilteredHoldings(true); setSelectedHoldings(new Map()); }}>{p.t('跨页全选筛选结果')}</ActionButton>
        <ActionButton size="sm" variant="ghost" disabled={!allFilteredHoldings && !selectedHoldings.size} onClick={clearHoldingSelection}>{p.t('清空选择')}</ActionButton>
        <ActionButton size="sm" variant="accent" disabled={!batchSourceAgent || (!allFilteredHoldings && !selectedHoldings.size) || holdings.loading || Boolean(holdings.error) || agents.loading || !agents.data} onClick={() => setHoldingBatch({ sourceAgentId: batchSourceAgent, selection: allFilteredHoldings ? { mode: 'FILTER', search: query, status: 'ACTIVE', region: holdingRegion, service: '' } : { mode: 'IDS', holdingIds: [...selectedHoldings.keys()].sort() } })}>{p.t('批量转给其他代理')}</ActionButton>
      </div>
      <p className="lp-admin-context">{selectedOwners.size > 1 ? p.t('批量转交请选择同一持有代理的号码，可先按持有代理筛选。') : p.t('每批最多 10,000 个；选择持有代理后可跨页全选。调整筛选会清空选择。')}</p>
      <State {...holdings} columns={8} empty={holdings.data?.data.length === 0} />
      {holdings.data && <Table columns={[<Checkbox aria-label={p.t('选择本页全部可转交号码')} disabled={!pageTransferable.length || allFilteredHoldings || holdings.loading} checked={allFilteredHoldings || (pageTransferable.length > 0 && pageTransferable.every(holding => selectedHoldings.has(holding.id)))} onCheckedChange={checked => selectHoldings(pageTransferable, checked === true)} />, p.t("号码"), p.t("持有人"), p.t("国家"), p.t("平台"), p.t("状态"), p.t("有效期至"), '']} label={p.t("号码库存")}>{holdings.data.data.map(h => <tr key={h.id}>
        <td><Checkbox aria-label={p.t('选择 {value1}', { value1: h.phoneNumber })} checked={h.transferable === true && (allFilteredHoldings || selectedHoldings.has(h.id))} disabled={h.transferable !== true || allFilteredHoldings || holdings.loading || (selectedHoldings.size >= 10000 && !selectedHoldings.has(h.id))} onCheckedChange={checked => selectHoldings([h], checked === true)} /></td><td><strong className="lp-admin-mono">{h.phoneNumber}</strong></td><td>{ownerName(h.agentId, h.customerId) ?? '—'}<small>{h.ownerType === 'AGENT' ? p.t("代理") : p.t("客户")}</small></td><td>{regionName(h.regionId)}</td><td>{h.service ?? '—'}</td>
        <td><Badge value={h.status} /></td><td>{h.expiresAt ? <DateText value={h.expiresAt} /> : p.t("长期")}</td><td>{h.status === 'ACTIVE' && <div className="lp-admin-row-actions"><ActionButton size="sm" onClick={() => setResellHolding(h)}>{p.t("转给其他代理")}</ActionButton><RowMenu label={p.t("更多操作")} items={[{ label: p.t("释放回库存"), danger: true, onSelect: () => setReleaseHolding(h.id) }]} /></div>}</td>
      </tr>)}</Table>}
      <RecordPagination busy={holdings.loading} page={holdingPage.page} pageSize={holdingPage.pageSize} totalPages={holdings.data?.pagination.totalPages ?? 0} totalItems={holdings.data?.pagination.totalItems ?? 0} controls="lp-admin-holdings" onPageChange={next => setHoldingPage(current => ({ ...current, page: next }))} onPageSizeChange={size => setHoldingPage({ page: 1, pageSize: size })} /></>}
    {tab === 'balances' && <><State {...balances} columns={4} empty={balances.data?.data.length === 0} />
      {balances.data && <Table columns={[p.t("名称"), p.t("类型"), p.t("余额"), '']} label={p.t("余额")}>{balances.data.data.map(b => <tr key={b.id}>
        <td><strong>{ownerName(b.agentId, b.customerId) ?? <ShortId value={(b.agentId ?? b.customerId)!} />}</strong></td><td>{b.ownerType === 'AGENT' ? p.t("代理") : p.t("客户")}</td>
        <td className="lp-admin-numeric"><strong>{(b.balanceMinor / 100).toLocaleString()}</strong> {b.currency}</td><td><div className="lp-admin-row-actions"><ActionButton size="sm" onClick={() => setAdjustTarget({ ownerType: b.ownerType, ownerId: (b.agentId ?? b.customerId)! })}>{p.t("充值 / 扣减")}</ActionButton>{b.ownerType === 'AGENT' && b.agentId && <IconAction label={p.t("查看余额流水")} onClick={() => setLedgerAgent(b.agentId!)}><Eye size={16} /></IconAction>}</div></td>
      </tr>)}</Table>}</>}
    {tab === 'prices' && <><State {...prices} columns={8} empty={prices.data?.data.length === 0} />
      {prices.data && <Table columns={[p.t("适用一级代理"), p.t("国家"), p.t("平台"), p.t("30 天价格"), p.t("状态"), '']} label={p.t("平台批发价")}>{prices.data.data.filter(r => r.sellerType === 'PLATFORM' && r.pricingKind === 'WHOLESALE').map(r => <tr key={r.id}>
        <td>{r.buyerAgentId ? ownerName(r.buyerAgentId, null) ?? <ShortId value={r.buyerAgentId} /> : p.t("全部一级代理")}</td><td>{r.regionId ? regionName(r.regionId) : p.t("全部国家")}</td><td>{r.service}</td>
        <td className="lp-admin-numeric">{(r.unitAmountMinor / 100).toFixed(2)} {r.currency}</td><td>{r.isActive ? p.t("启用") : p.t("停用")}</td><td><ActionButton size="sm" onClick={() => setPriceEdit(r)}>{p.t("编辑")}</ActionButton></td>
      </tr>)}</Table>}</> }
    {tab === 'transactions' && <>
      <div className="lp-admin-toolbar"><label>{p.t('平台收入周期')}<select value={incomePeriod} onChange={e => setIncomePeriod(e.target.value as typeof incomePeriod)}><option value="today">{p.t('今日')}</option><option value="7d">{p.t('近 7 天')}</option><option value="30d">{p.t('近 30 天')}</option></select></label>
        {income.data && <strong>{p.t('平台批发收入')}：{(income.data.data.amountMinor / 100).toFixed(2)} USD · {income.data.data.quantity} {p.t('个号码')}</strong>}
      </div><State {...income} />
      <State {...transactions} columns={6} empty={transactions.data?.data.length === 0} />
      {transactions.data && <Table columns={[p.t("单号"), p.t("类型"), p.t("买方"), p.t("金额"), p.t("状态"), p.t("创建时间")]} label={p.t("交易流水")}>{transactions.data.data.map(t => <tr key={t.id}>
        <td><ActionButton size="sm" onClick={() => setTransactionId(t.id)}><ShortId value={t.orderNumber} /></ActionButton></td><td>{p.t(txKindLabel(t.orderNumber, t.kind))}</td>
        <td>{ownerName(t.buyerAgentId, t.buyerCustomerId) ?? '—'}<small>{t.buyerType === 'AGENT' ? p.t("代理") : p.t("客户")}</small></td><td className="lp-admin-numeric">{(t.amountMinor / 100).toFixed(2)} {t.currency}</td>
        <td><Badge value={t.status} /></td><td><DateText value={t.createdAt} /></td>
      </tr>)}</Table>}
      <RecordPagination busy={transactions.loading} page={page} pageSize={20} totalPages={transactions.data?.pagination.totalPages ?? 0} totalItems={transactions.data?.pagination.totalItems ?? 0} controls="lp-admin-tx" onPageChange={setPage} onPageSizeChange={() => {}} /></>}
    {transactionId && <SettlementOrderDrawer id={transactionId} onClose={() => setTransactionId(null)} />}
    {ledgerAgent && <LedgerDrawer ownerType="AGENT" ownerId={ledgerAgent} title={p.t("{value1} · 余额流水", { value1: ownerName(ledgerAgent, null) ?? '代理' })} onClose={() => setLedgerAgent(null)} />}
    {action && <InventoryAction kind={action} onClose={() => setAction(null)} onSuccess={() => { setAction(null); refresh(); toast.success(p.t("操作成功，已刷新代理库存。")); }} />}
    {adjustTarget && <InventoryAction kind="adjust" initialOwner={adjustTarget} onClose={() => setAdjustTarget(null)} onSuccess={() => { setAdjustTarget(null); refresh(); toast.success(p.t("余额已更新。")); }} />}
    {stockImport && canUseLocalInventoryImport && <StockImportModal onClose={() => setStockImport(false)} onSuccess={() => { setStockImport(false); refresh(); toast.success(p.t("号码库存已导入。")); }} />}
    {batchClaimStock && <BatchStockClaimModal stockIds={selectedStockIds} onClose={() => setBatchClaimStock(false)} onSuccess={() => { setBatchClaimStock(false); refresh(); toast.success(p.t("已批量分配 {value1} 个号码。", { value1: selectedStockIds.length })); }} />}
    {claimStock && <StockClaimModal stock={claimStock} onClose={() => setClaimStock(null)} onSuccess={() => { setClaimStock(null); refresh(); toast.success(p.t("号码已分配给代理。")); }} />}
    {releaseHolding && <ReleaseHoldingModal holdingId={releaseHolding} onClose={() => setReleaseHolding(null)} onSuccess={() => { setReleaseHolding(null); refresh(); toast.success(p.t("号码已释放回库存。")); }} />}
    {holdingBatch && <AdminHoldingBatchModal selection={holdingBatch.selection} sourceAgentId={holdingBatch.sourceAgentId} agents={agents.data?.data ?? []} onClose={() => setHoldingBatch(null)} onComplete={result => { setHoldingBatch(null); refresh(); toast.success(p.t('已批量转交 {value1} 个号码。', { value1: result.count })); }} />}
    {resellHolding && <ResellHoldingModal holding={resellHolding} onClose={() => setResellHolding(null)} onSuccess={() => { setResellHolding(null); refresh(); toast.success(p.t("号码已转售给代理。")); }} />}
    {priceEdit && <AdminPriceEditor rule={priceEdit === 'new' ? null : priceEdit} onClose={() => setPriceEdit(null)} onSuccess={() => { setPriceEdit(null); refresh(); toast.success(p.t("代理价格已保存。")); }} />}
  </>;
}
function InventoryAction({ kind, initialOwner, onClose, onSuccess }: { kind: 'holding' | 'adjust' | 'transfer'; initialOwner?: { ownerType: 'AGENT' | 'CUSTOMER'; ownerId: string }; onClose: () => void; onSuccess: () => void }) {
  const p = useDisplayPreferences();
  const agents = useResource('admin-inventory-agents', signal => api.agentAgents({ signal }));
  const customers = useResource('admin-inventory-customers', signal => api.agentCustomers({ signal }));
  const [agentId, setAgentId] = useState('');
  const [ownerType, setOwnerType] = useState<'AGENT' | 'CUSTOMER'>(initialOwner?.ownerType ?? 'AGENT');
  const [ownerId, setOwnerId] = useState(initialOwner?.ownerId ?? '');
  const [fromType, setFromType] = useState<'AGENT' | 'CUSTOMER'>('AGENT');
  const [fromId, setFromId] = useState('');
  const [toType, setToType] = useState<'AGENT' | 'CUSTOMER'>('CUSTOMER');
  const [toId, setToId] = useState('');
  const [regionId, setRegionId] = useState('us');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [service, setService] = useState('Telegram');
  const [startsAt, setStartsAt] = useState(() => localInput(Date.now()));
  const [expiresAt, setExpiresAt] = useState(() => localInput(Date.now() + 30 * 86400000));
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const agentOptions = (agents.data?.data ?? []).filter(agent => agent.status === 'ACTIVE').map(agent => ({ value: agent.id, label: agent.name }));
  const customerOptions = (customers.data?.data ?? []).filter(customer => customer.status === 'ACTIVE').map(customer => ({ value: customer.id, label: customer.name }));
  const ownerOptions = ownerType === 'AGENT' ? agentOptions : customerOptions;
  const fromOptions = fromType === 'AGENT' ? agentOptions : customerOptions;
  const toOptions = toType === 'AGENT' ? agentOptions : customerOptions;
  const title = kind === 'holding' ? p.t("手动录入代理号码") : kind === 'adjust' ? p.t("充值 / 扣减余额") : p.t("余额转账");
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
    {kind === 'holding' && <><label className="lp-admin-span">{p.t("归属代理")}<AppCombobox aria-label={p.t("归属代理")} value={agentId} onValueChange={setAgentId} options={[{ value: '', label: agents.loading ? p.t("正在加载代理…") : p.t("请选择代理") }, ...agentOptions]} /></label><label>{p.t("国家")}<AppCombobox aria-label={p.t("国家")} value={regionId} onValueChange={setRegionId} options={regions} /></label><label>{p.t("平台")}<AppCombobox aria-label={p.t("平台")} value={service} onValueChange={setService} options={serviceSchema.options.map(v => ({ value: v, label: v }))} /></label><label className="lp-admin-span">{p.t("号码")}<Input required value={phoneNumber} onChange={event => setPhoneNumber(event.target.value)} placeholder="+15551234567" /></label><label>{p.t("开始时间")}<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>{p.t("到期时间")}<Input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label></>}
    {kind === 'adjust' && <><label>{p.t("给代理还是客户")}<AppCombobox aria-label={p.t("给代理还是客户")} value={ownerType} onValueChange={value => { setOwnerType(value as 'AGENT' | 'CUSTOMER'); setOwnerId(''); }} options={[{ value: 'AGENT', label: p.t("代理") }, { value: 'CUSTOMER', label: p.t("客户") }]} /></label><label>{ownerType === 'AGENT' ? p.t("选择代理") : p.t("选择客户")}<AppCombobox aria-label={ownerType === 'AGENT' ? p.t("选择代理") : p.t("选择客户")} value={ownerId} onValueChange={setOwnerId} options={[{ value: '', label: p.t("请选择") }, ...ownerOptions]} /></label><label>{p.t("充值还是扣减")}<AppCombobox aria-label={p.t("余额调整方向")} value={direction} onValueChange={value => setDirection(value as 'CREDIT' | 'DEBIT')} options={[{ value: 'CREDIT', label: p.t("充值（增加余额）") }, { value: 'DEBIT', label: p.t("扣减余额") }]} /></label><label>{p.t("金额（USD）")}<Input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label><ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={direction === 'CREDIT' ? [p.t("代理线下打款充值"), p.t("活动赠送")] : [p.t("退款扣回"), p.t("充值录入错误更正")]} /></>}
    {kind === 'transfer' && <><label>{p.t("从谁转出（类型）")}<AppCombobox aria-label={p.t("从谁转出（类型）")} value={fromType} onValueChange={value => { setFromType(value as 'AGENT' | 'CUSTOMER'); setFromId(''); }} options={[{ value: 'AGENT', label: p.t("代理") }, { value: 'CUSTOMER', label: p.t("客户") }]} /></label><label>{p.t("从谁转出")}<AppCombobox aria-label={p.t("从谁转出")} value={fromId} onValueChange={setFromId} options={[{ value: '', label: p.t("请选择") }, ...fromOptions]} /></label><label>{p.t("转给谁（类型）")}<AppCombobox aria-label={p.t("转给谁（类型）")} value={toType} onValueChange={value => { setToType(value as 'AGENT' | 'CUSTOMER'); setToId(''); }} options={[{ value: 'AGENT', label: p.t("代理") }, { value: 'CUSTOMER', label: p.t("客户") }]} /></label><label>{p.t("转给谁")}<AppCombobox aria-label={p.t("转给谁")} value={toId} onValueChange={setToId} options={[{ value: '', label: p.t("请选择") }, ...toOptions]} /></label><label>{p.t("金额（USD）")}<Input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label><ReasonField label={p.t("转账说明")} value={reason} onChange={setReason} disabled={busy} suggestions={[p.t("代理给客户划拨余额"), p.t("代理之间调账")]} /></>}
    {error && <p role="alert" className="lp-admin-error lp-admin-span">{error}</p>}
  </fieldset></div><footer><ActionButton onClick={onClose} disabled={busy}>{p.t("取消")}</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!valid}><Check size={16} />{p.t("确认提交")}</ActionButton></footer></form></Modal>;
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
  async function logout() { setLoggingOut(true); try { await api.logout(); navigate('/login'); } catch (cause) { toast.error(errorMessage(cause)); } finally { setLoggingOut(false); } }
  function refresh() { if (pending || refreshLock.current) return; refreshLock.current = true; setRevision(x => x + 1); }
  const listProps = { input, revision, detail: setDetail, action: setAction, update };
  return <TooltipProvider delayDuration={300}><SidebarProvider className="lp-admin lp-admin-theme" data-theme={p.theme}>
    <AdminSidebar page={page} />
    <div className="lp-admin-main"><header className="lp-admin-header"><div className="lp-admin-header-leading"><AdminTooltip label={p.t("展开 / 收起导航")} side="bottom"><SidebarTrigger className="lp-admin-button lp-admin-sidebar-trigger" aria-label={p.t("展开 / 收起导航")} /></AdminTooltip><nav className="lp-admin-breadcrumb" aria-label={p.t("面包屑")}><span>{p.t("平台管理")}</span><span aria-hidden="true">/</span><span aria-current="page">{p.t(adminTitles[page])}</span></nav></div><div className="lp-admin-header-actions"><AdminTooltip label={p.t("刷新数据")}><span><ActionButton variant="ghost" aria-label={p.t("刷新数据")} aria-busy={pending > 0} disabled={pending > 0} onClick={refresh}><RefreshCw size={16} className={pending > 0 ? 'lp-admin-spin' : ''} /><span className="lp-admin-refresh-label">{pending > 0 ? p.t("正在刷新…") : p.t("刷新数据")}</span></ActionButton></span></AdminTooltip><AdminAccountMenu user={user} logout={() => void logout()} busy={loggingOut} /></div></header>
    <main className="lp-admin-content" aria-busy={pending > 0}>{sessionError && <div className="lp-admin-refresh-error" role="alert"><AlertCircle size={16} /><p>{p.t("权限复核失败：")}{sessionError}</p><ActionButton onClick={retrySession}>{p.t("重试")}</ActionButton></div>}<div key={page} className="lp-admin-page"><div className="lp-admin-page-heading"><div><h1>{p.t(adminTitles[page])}</h1><p className="lp-admin-page-description">{p.t(adminDescriptions[page])}</p></div><div className="lp-admin-actions">{page === 'products' && <><ActionButton onClick={() => setSyncingProducts(true)}><RefreshCw size={16} />{p.t("从上游同步")}</ActionButton><ActionButton variant="accent" onClick={() => setProduct(null)}><Plus size={16} />{p.t("创建商品")}</ActionButton></>}</div></div>
      {page !== 'dashboard' && !['agents', 'inventory', 'api-docs', 'webhooks'].includes(page) && <form className="lp-admin-toolbar" onSubmit={e => { e.preventDefault(); update('search', search); }}><AppSearchInput className="lp-admin-search" aria-label={p.t("搜索管理记录")} placeholder={page === 'users' ? p.t("搜索用户名、邮箱或用户 ID") : page === 'numbers' ? p.t("搜索号码、平台或用户") : page === 'products' ? p.t("搜索商品名称或平台") : page === 'projects' ? p.t("搜索平台名称或项目 ID") : page === 'receipts' ? p.t("搜索短信 ID、号码、平台或用户") : p.t("搜索订单或用户")} maxLength={200} value={search} onValueChange={setSearch}><ActionButton size="sm" type="submit">{p.t("搜索")}</ActionButton></AppSearchInput><SelectField aria-label={p.t("状态筛选")} value={input.status ?? ''} onValueChange={v => update('status', v)} options={[{ value: '', label: p.t("全部状态") }, ...translatedFilters(page, p.t)]} />{page === 'orders' && <OrderQuickFilters input={input} revision={revision} update={update} />}{['projects', 'receipts'].includes(page) && <SelectField aria-label={p.t("来源筛选")} value={input.provider ?? ''} onValueChange={v => update('provider', v)} options={[{ value: '', label: p.t("全部来源") }, { value: 'pingcode', label: p.t("上游 PC") }, { value: 'pingcode-mock', label: p.t("演示数据") }]} />}{['numbers', 'products'].includes(page) && <AppCombobox aria-label={p.t("国家筛选")} value={input.region ?? ''} onValueChange={v => update('region', v)} options={[{ value: '', label: p.t("全部国家") }, ...regions]} />}{input.userId && <ActionButton size="sm" onClick={() => update('userId', '')}><X size={14} />{p.t("只看某个用户：清除")}</ActionButton>}</form>}
      <Card className={['dashboard', 'api-docs', 'webhooks'].includes(page) ? 'lp-admin-records-dashboard' : 'lp-admin-records-card'} id="lp-admin-records">{page === 'api-docs' ? <ApiDocumentation /> : page === 'webhooks' ? <WebhookPage {...listProps} /> : page === 'dashboard' ? <Dashboard revision={revision} detail={setDetail} /> : page === 'users' ? <UsersList {...listProps} /> : page === 'numbers' ? <NumbersList {...listProps} /> : page === 'products' ? <ProductsList {...listProps} edit={setProduct} /> : page === 'projects' ? <ProjectsList {...listProps} /> : page === 'receipts' ? <ReceiptsList {...listProps} /> : page === 'recharges' ? <RechargesList {...listProps} /> : page === 'agents' ? <AgentsList revision={revision} /> : page === 'inventory' ? <InventoryPage /> : <OrdersList {...listProps} />}</Card>
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
  if (result.errorCode === 'ADMIN_REQUIRED' || (result.data && result.data.data.role !== 'ADMIN')) return <main className="lp-admin-access" data-theme={p.theme}><ShieldCheck size={32} /><h1>{p.t("403 · 无管理后台访问权限")}</h1><p>{p.t("当前账号无法访问管理后台。")}</p><a href="/app">{p.t("返回工作台")}</a></main>;
  if (!result.data) return <main className="lp-admin-access" data-theme={p.theme}><a href="/">LINEPOOL</a><State {...result} /></main>;
  return <AdminActivityProvider><AdminMain user={result.data.data} address={address} sessionError={result.error} retrySession={result.retry} /></AdminActivityProvider>;
}
export default function AdminShell({ address }: { address: string }) {
  // Revalidate on navigation without unmounting the authenticated layout.
  return <AdminAccess address={address} />;
}
