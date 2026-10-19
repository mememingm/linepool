import { useRef, useState } from 'react';
import { ArrowRight, Smartphone } from 'lucide-react';
import { api, ApiError, errorText } from './api';
import { CopyButton, Country, EmptyState, InlineNotice, Modal, ModalDismiss, Pagination, Spinner } from './components';
import { SelectField } from './select';
import { dateTime, leaseStatusNames, money, type Lease, type LeasePlan, type LeaseResource, type LeaseSnapshot } from './types';
import './leases.css';

export function LeaseMarket({ data, onSelect }: { data: LeaseSnapshot; onSelect: (resource: LeaseResource) => void }) {
  const [country, setCountry] = useState('all'); const [availability, setAvailability] = useState('available'); const [page, setPage] = useState(1);
  const list = data.leaseResources.filter(r => (country === 'all' || r.countryCode === country) && (availability === 'all' || r.available));
  return <><div className="page-heading"><div><span className="eyebrow">EXCLUSIVE NUMBER LEASES</span><h1>号码商城</h1><p>选定一个号码，独占 7 或 30 天；每条短信都属于同一份租约。</p></div></div>
    <InlineNotice>本地 Mock 演示。号码为虚构资源，租金使用测试额度，未验证任何真实平台兼容性。</InlineNotice>
    <div className="record-toolbar"><SelectField label="国家" value={country} onChange={v => { setCountry(v); setPage(1); }} options={[{ value: 'all', label: '全部国家' }, { value: 'US', label: '美国' }, { value: 'GB', label: '英国 · 暂无资源' }, { value: 'CA', label: '加拿大 · 暂无资源' }]} /><SelectField label="可售状态" value={availability} onChange={v => { setAvailability(v); setPage(1); }} options={[{ value: 'available', label: '仅可售号码' }, { value: 'all', label: '全部独占资源' }]} /><span className="muted small">接收普通 SMS / 验证码 · 不支持发送</span></div>
    <div className="lease-grid">{list.slice((page - 1) * 8, page * 8).map(resource => <article className="lease-card" key={resource.id}><div className="lease-card-heading"><Smartphone size={22} /><Country code={resource.countryCode} /><span className="demo-badge">Mock</span></div><h2 className="mono">{resource.phone}</h2><p>{resource.available ? '可独占租用' : resource.availability === 'REVIEW' ? '待回收审核' : resource.availability === 'LEASED' ? '已出租' : resource.online ? '未上架' : '离线'}</p><p className="small muted">普通短信及验证码持续接收 · 发送不支持</p><div className="lease-prices">{data.leasePlans.filter(p => p.enabled).map(p => <span key={p.id}>{p.days} 天 <strong>{money(p.priceCents)}</strong></span>)}</div><button className="button primary" disabled={!resource.available || !data.leasePlans.some(p => p.enabled)} onClick={() => onSelect(resource)}>选择此号码<ArrowRight size={15} /></button></article>)}</div>
    {!list.length && <EmptyState title="暂无可售号码" description="当前筛选下没有可用的本地演示资源。" />}<Pagination total={list.length} page={page} onChange={setPage} />
  </>;
}
export function MyLeases({ data, now, onOpen }: { data: LeaseSnapshot; now: number; onOpen: (lease: Lease) => void }) {
  const [status, setStatus] = useState('all'); const [page, setPage] = useState(1);
  const list = data.leases.filter(l => status === 'all' || l.status === status);
  return <><div className="page-heading"><div><span className="eyebrow">YOUR NUMBERS</span><h1>我的号码</h1><p>租期内持续接收；验证码到达不会结束租约或再次扣租金。</p></div><a className="button primary" href="#/market">租用号码</a></div><div className="record-toolbar"><SelectField label="租约状态" value={status} onChange={v => { setStatus(v); setPage(1); }} options={[{ value: 'all', label: '全部租约' }, ...Object.entries(leaseStatusNames).map(([value,label]) => ({ value, label }))]} /></div><div className="lease-grid">{list.slice((page - 1) * 8, page * 8).map(lease => <article className="lease-card" key={lease.id}><div className="lease-card-heading"><Country code={lease.countryCode} /><span className="neutral-tag">{leaseStatusNames[lease.status]}</span></div><h2 className="mono">{lease.phone}</h2><p>{lease.online ? 'Mock 在线' : 'Mock 离线 · 租约保留'}</p><p>到期 {dateTime(lease.expiresAt)}（本地时间）</p><p className="small muted">{remaining(lease, now)}</p><p className="lease-preview">{lease.messages.at(-1)?.text ?? '暂无短信，等待管理员显式注入 Mock 事件。'}</p><button className="button secondary" onClick={() => onOpen(lease)}>详情{lease.canRenew ? '与续费' : ''}<ArrowRight size={15} /></button></article>)}</div>{!list.length && <EmptyState title="还没有号码租约" description="在号码商城选择指定演示号码和租期。" action={<a className="button secondary" href="#/market">浏览号码商城</a>} />}<Pagination total={list.length} page={page} onChange={setPage} /></>;
}
function remaining(lease: Lease, now: number) {
  if (lease.status !== 'ACTIVE') return leaseStatusNames[lease.status];
  const seconds = Math.max(0, Math.ceil((Date.parse(lease.expiresAt) - now) / 1000));
  return seconds ? `剩余 ${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分` : '正在确认到期';
}
export function LeaseDrawer({ lease, now, onClose, onCopy, onRenew }: { lease: Lease; now: number; onClose: () => void; onCopy: (text: string) => Promise<void>; onRenew: () => void }) {
  return <Modal title="号码详情" drawer onClose={onClose}><div className="drawer-body"><div className="lease-card-heading"><Country code={lease.countryCode} /><span className="neutral-tag">{leaseStatusNames[lease.status]}</span></div><section className="number-section"><h2 className="phone">{lease.phone}<CopyButton value={lease.phone} label="复制租赁号码" onCopy={onCopy} /></h2><p>{remaining(lease, now)}</p><p className="small muted">到期时间（UTC）{lease.expiresAt}</p></section><dl className="detail-meta"><div><dt>资源状态</dt><dd>{lease.online ? 'Mock 在线' : 'Mock 离线'}</dd></div><div><dt>托管 / 通信套餐到期</dt><dd>未知</dd></div><div><dt>上游用量</dt><dd>未支持查询</dd></div></dl><InlineNotice>发送短信暂不支持。到期停止交付新短信，号码进入待回收；历史短信只属于本租约。</InlineNotice><section className="message-section"><h3>租约短信 · {lease.messages.length} 条</h3>{lease.messages.length ? lease.messages.map(message => <article className="message" key={message.id}><div className="message-meta"><span>Mock 入站短信</span><time>{dateTime(message.receivedAt)}</time></div><p className="lease-message-text">{message.text}</p>{message.code && <div className="phone"><strong className="mono">{message.code}</strong><CopyButton value={message.code} label={`复制验证码 ${message.code}`} onCopy={onCopy} /></div>}</article>) : <EmptyState title="暂无短信" description="普通文本和验证码都可接收，不会自动生成短信。" />}</section><section className="task-timeline"><h3>租约事件</h3>{lease.events.map((event, i) => <article className="lease-event" key={i}><time className="small muted">{dateTime(event.createdAt)}</time><p>{event.detail}</p></article>)}</section></div><footer className="drawer-footer"><button className="button secondary" disabled>发送短信 · 未支持</button><button className="button primary" disabled={!lease.canRenew || Date.parse(lease.expiresAt) <= now} onClick={onRenew}>同号续费</button></footer></Modal>;
}
type LeaseAttempt = { planId: string; expectedPriceCents: number; expectedPlanVersion: number; idempotencyKey: string; resourceId?: string };
function pendingAttempt(key: string): LeaseAttempt | null {
  try { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) as LeaseAttempt : null; } catch { return null; }
}
export function LeasePurchaseDialog({ resource, lease, plans, viewerId, onClose, onDone }: { resource?: LeaseResource; lease?: Lease; plans: LeasePlan[]; viewerId: string; onClose: () => void; onDone: (lease: Lease) => Promise<void> }) {
  const storageKey = `once-pending-lease:${viewerId}:${lease?.id ?? resource?.id}`;
  const [saved] = useState(() => pendingAttempt(storageKey));
  const [planId, setPlanId] = useState(saved?.planId ?? plans.find(p => p.enabled)?.id ?? ''); const [agreed,setAgreed] = useState(false);
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [uncertain,setUncertain] = useState(Boolean(saved));
  const attempt = useRef<LeaseAttempt | null>(saved);
  const submitting=useRef(false); const plan=plans.find(p=>p.id===planId);
  async function submit() {
    if (!plan || !agreed || submitting.current) return; submitting.current=true; setBusy(true); setError('');
    attempt.current ??= { planId: plan.id, expectedPriceCents: plan.priceCents, expectedPlanVersion: plan.version, idempotencyKey: crypto.randomUUID(), ...(resource ? { resourceId:resource.id } : {}) };
    try { sessionStorage.setItem(storageKey, JSON.stringify(attempt.current)); const result=await api<{lease:Lease}>(lease ? `/leases/${lease.id}/renew` : '/leases',{method:'POST',body:JSON.stringify(attempt.current)}); sessionStorage.removeItem(storageKey); await onDone(result.lease); }
    catch(err) { const pending=!(err instanceof ApiError && err.status>=400 && err.status<500); setUncertain(pending); if(!pending) { attempt.current=null; sessionStorage.removeItem(storageKey); } setError(errorText(err)+(pending?' 结果尚未确认；重试会使用同一请求编号。':'')); }
    finally { submitting.current=false; setBusy(false); }
  }
  return <Modal title={lease ? '确认同号续费' : '确认独占租赁'} onClose={onClose} busy={busy}><form onSubmit={e=>{e.preventDefault();void submit();}}><div className="modal-body"><h3 className="mono">{lease?.phone ?? resource?.phone}</h3><SelectField label="租赁方案" value={planId} onChange={setPlanId} disabled={busy || uncertain} options={plans.filter(p=>p.enabled || p.id===planId).map(p=>({value:p.id,label:`${p.days} 天 · ${money(p.priceCents)} 测试额度`}))} /><p>{lease ? '从原到期时间追加租期，号码和客户归属保持不变。' : '成功开通即结算测试租金。租期内整号独占，可持续接收普通短信和验证码。'}</p>{lease && <p className="small muted">原到期（UTC）：{lease.expiresAt}</p>}<InlineNotice>本地 Mock 确认，无真实支付或供应商续费。发送短信、用量查询不支持；到期后需管理员回收审核。</InlineNotice><label className="checkbox-label agreement"><input type="checkbox" required checked={agreed} onChange={e=>setAgreed(e.target.checked)} disabled={busy} />我已了解虚构号码和测试额度限制。</label>{error && <p className="form-error" role="alert">{error}</p>}</div><footer className="modal-footer"><ModalDismiss><button type="button" className="button secondary" disabled={busy}>关闭</button></ModalDismiss><button type="submit" className="button primary" disabled={busy || !agreed || (!uncertain && !plan?.enabled)}>{busy ? <Spinner/> : null}{uncertain ? '重试同一请求' : lease ? '确认测试续费' : '确认开通'}</button></footer></form></Modal>;
}
export function LeaseBills({ data, onOpen }: { data: LeaseSnapshot; onOpen: (lease: Lease) => void }) {
  return <section className="admin-section"><h2>租赁订单与续费</h2><div className="lease-grid">{data.leaseOrders.map(order=><article className="lease-card" key={order.id}><strong className="mono">{order.phone}</strong><p>{order.kind==='OPEN'?'开通':'同号续费'} · {order.days} 天 · {money(order.priceCents)}</p><p>{order.status==='TEST_PAID'?'测试租金已结算':'开通失败 · 未扣款'}</p><small className="muted">{dateTime(order.createdAt)} · 方案 v{order.planVersion}</small><button className="text-button" onClick={()=>{const lease=data.leases.find(l=>l.id===order.leaseId);if(lease)onOpen(lease);}}>查看租约<ArrowRight size={14}/></button></article>)}</div>{!data.leaseOrders.length && <EmptyState title="暂无租赁账单" description="开通与续费的测试订单会在此保留。"/>}</section>;
}
export function LeaseHelp() {
  return <><div className="page-heading"><div><span className="eyebrow">HELP & POLICIES</span><h1>帮助中心</h1><p>独占号码租赁 · 本地演示</p></div></div><section className="admin-section">{[
    ['购买什么权益？','ONCE 提供指定号码 7/30 天独占租赁。普通短信及验证码持续归属同一租约；收到第一条或多条短信都不会结束租约。LINEPOOL 的产品是共享号码按平台一次取码；eSIM 托管使用客户自带资源。'],
    ['如何续费？','在有效租约详情选择同号续费。从当前到期时间追加 7 或 30 天，测试租金立即结算。已到期租约不能续回。当前只确认本地演示权益，不代表真实上游套餐续费成功。'],
    ['到期后会怎样？','停止新短信交付，号码待管理员审核回收，不自动转售或进入共享池。历史短信仍只对原租约客户可见；再次出售不代表号码没有外部绑定历史。'],
    ['为什么在线状态与租约不同？','离线不释放独占使用权。客户租期、托管到期和通信套餐到期各自独立；当前上游时间与用量未知。'],
    ['能发送短信或查询用量吗？','不支持发送短信、读写卡、设备管理或可靠用量查询。页面不会伪造成功。接收只通过管理员显式 Mock 事件演示，不接入真实上游。'],
    ['余额与账号是否真实？','额度仅为本地测试账本，不发起支付。Cookie 标识本地浏览器工作区，清除 Cookie 后无法找回旧工作区，不是生产账户系统。管理员使用独立授权。'],
    ['旧记录怎么办？','历史一次取码任务、余额、短信、流水和审计保留。旧活跃任务继续占用号码并遵循原规则结束，可在历史一次取码入口查看；不会批量转为长租。']
  ].map(([q,a],i)=><details key={q} open={i===0}><summary>{q}</summary><p>{a}</p></details>)}</section></>;
}
