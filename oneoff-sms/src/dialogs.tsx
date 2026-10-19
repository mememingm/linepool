import { useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Copy, FileText, Globe2, MessageSquare, RefreshCw, Send, ShieldCheck, XCircle } from 'lucide-react';
import { ApiError, errorText } from './api';
import { durationLabel, platformDescription, platformList } from './catalog';
import { SelectField } from './select';
import { CopyButton, Countdown, Country, EmptyState, InlineNotice, Modal, ModalDismiss, SearchField, ServiceIcon, Spinner, Status, StepMark } from './components';
import { countries, dateTime, isActive, money, paymentNames, settlementNames, shortId, statusNames, type Product, type Task } from './types';

export function CreateDialog({ products, initialProductId, onClose, onCreate }: { products: Product[]; initialProductId?: string; onClose: () => void; onCreate: (product: Product) => Promise<void> }) {
  const [service, setService] = useState(products.find(p => p.id === initialProductId)?.service ?? '');
  const [selectedId, setSelectedId] = useState('');
  const [stage, setStage] = useState<'country' | 'confirm'>('country');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const submittedProduct = useRef<Product | null>(null);
  const currentProduct = products.find(p => p.id === selectedId && p.service === service);
  const product = uncertain ? submittedProduct.current : currentProduct;
  const available = Boolean(product?.enabled && product.stock > 0);
  const countryOptions = products.filter(p => p.service === service && `${countries[p.countryCode] ?? p.country} ${p.country} ${p.countryCode}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === 'price' ? a.priceCents - b.priceCents : sort === 'stock' ? Number(b.enabled && b.stock > 0) - Number(a.enabled && a.stock > 0) : a.countryCode.localeCompare(b.countryCode));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !product) return;
    if (stage === 'country') {
      if (available) { setStage('confirm'); setAgreed(false); }
      return;
    }
    if (!agreed || (!available && !uncertain)) return;
    submitting.current = true;
    submittedProduct.current = product;
    setBusy(true); setError('');
    try { await onCreate(product); }
    catch (err) {
      setError(errorText(err));
      setUncertain(!(err instanceof ApiError && err.status >= 400 && err.status < 500));
    } finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title="确认接码" onClose={onClose} busy={busy} className="create-modal"><form onSubmit={event => void submit(event)}>
    <div className="modal-body create-body">
      {!service ? <><div className="flow-heading"><h3>选择平台</h3><span className="muted small">本地演示</span></div><div className="platform-picker">{platformList(products).map(platform => <button key={platform.service} type="button" className="platform-picker-row" onClick={() => setService(platform.service)}><ServiceIcon service={platform.service} small /><span><strong>{platform.service}</strong><small>{platformDescription(platform.service)}</small></span><ArrowRight size={16} /></button>)}</div></> : <>
        <div className="creation-platform"><ServiceIcon service={service} /><div><h3>{service}</h3><p>{platformDescription(service)}</p></div><span className="demo-badge">演示商品</span></div>
        <div className="flow-steps" aria-label="创建步骤"><span className={stage === 'country' ? 'current' : 'finished'}><span>{stage === 'confirm' ? <Check size={12} /> : '1'}</span>选择国家</span><span className="flow-connector" /><span className={stage === 'confirm' ? 'current' : ''}><span>2</span>确认订单</span></div>
        {stage === 'country' ? <><div className="country-toolbar"><SearchField label="搜索国家" placeholder="搜索国家、地区或代码" value={query} onChange={setQuery} /><SelectField label="国家排序" value={sort} onChange={setSort} options={[{ value: 'default', label: '默认排序' }, { value: 'price', label: '价格优先' }, { value: 'stock', label: '有货优先' }]} /></div>
          <fieldset className="country-picker"><legend className="sr-only">选择国家</legend><div className="country-list-heading"><span>国家 / 地区</span><span>单次标价</span></div><div className="country-list">{countryOptions.length ? countryOptions.map(option => <label key={option.id} className={`country-option ${selectedId === option.id ? 'selected' : ''} ${!option.enabled || option.stock <= 0 ? 'unavailable' : ''}`}><input type="radio" name="task-country" value={option.id} checked={selectedId === option.id} disabled={busy || !option.enabled || option.stock <= 0} onChange={() => { setSelectedId(option.id); setError(''); setAgreed(false); }} aria-label={`${countries[option.countryCode] ?? option.country} ${money(option.priceCents, option.currency)}`} /><span className="country-choice"><Country code={option.countryCode} /><small>{option.enabled && option.stock > 0 ? `演示库存 ${option.stock}` : '暂无库存'}<span>·</span>{durationLabel(option.durationSeconds)}</small></span><strong className="country-price">{money(option.priceCents, option.currency)}</strong><span className="radio-mark">{selectedId === option.id && <span />}</span></label>) : <EmptyState title="没有匹配的国家" description="调整国家名称或代码后再试。" />}</div></fieldset>
          {product && <div className="selection-preview"><Globe2 size={16} /><span><strong>{countries[product.countryCode] ?? product.country}</strong><span>有效 {durationLabel(product.durationSeconds)}</span></span><strong>{money(product.priceCents, product.currency)}</strong></div>}
        </> : product ? <><div className="flow-heading"><h3>确认任务信息</h3><span className="small muted">单次接码</span></div><dl className="confirmation-details"><div><dt>平台</dt><dd>{product.service}</dd></div><div><dt>国家 / 地区</dt><dd><Country code={product.countryCode} /></dd></div><div><dt>有效时间</dt><dd>{durationLabel(product.durationSeconds)}</dd></div><div><dt>演示库存</dt><dd>{product.stock} 个 · 共享资源</dd></div><div><dt>取消规则</dt><dd>{product.canCancel ? '等待验证码时可取消' : '此商品不支持取消'}</dd></div><div><dt>测试退款规则</dt><dd>超时{product.rules.refundOnExpiry ? '退回额度' : '人工结算'}；取消{product.rules.refundOnCancel ? '退回额度' : '人工结算'}；分配失败{product.rules.refundOnFailure ? '退回额度' : '人工结算'}</dd></div><div className="confirmation-total"><dt>单次测试价格</dt><dd>{money(product.priceCents, product.currency)}<small>仅使用测试额度</small></dd></div></dl>
          <label className="checkbox-label agreement"><input type="checkbox" required checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />我已了解仅使用测试额度，不会发生真实交易。</label>
          {!available && !uncertain && <p className="form-error" role="alert"><AlertCircle size={16} />此商品当前不可用，请返回重新选择。</p>}
        </> : <EmptyState title="商品已不可用" description="返回国家列表选择其他可用商品。" />}
        {error && <p className="form-error" role="alert"><AlertCircle size={16} />{error}</p>}
      </>}
    </div>
    <footer className="modal-footer create-footer"><span className="checkout-note"><ShieldCheck size={14} />本地测试 · 测试额度</span><div>{stage === 'confirm' ? <button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => { setStage('country'); setAgreed(false); setError(''); }}><ArrowLeft size={14} />上一步</button> : <ModalDismiss><button type="button" className="button secondary">取消</button></ModalDismiss>}{service && <button className="button primary" type="submit" disabled={busy || (stage === 'country' ? !available : !agreed || (!available && !uncertain))}>{busy ? <Spinner /> : stage === 'country' ? <ArrowRight size={15} /> : <ShieldCheck size={15} />}{busy ? '正在创建' : stage === 'country' ? '确认订单' : error ? '重试同一次接码' : '确认接码'}</button>}</div></footer>
    </form></Modal>;
}

export function TaskDrawer({ task, now, onClose, onCopy, onRefresh, onCancel, onFeedback }: { task: Task; now: number; onClose: () => void; onCopy: (value: string) => Promise<void>; onRefresh: () => Promise<boolean>; onCancel: () => void; onFeedback: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const active = isActive(task);
  const duration = Date.parse(task.expiresAt) - Date.parse(task.createdAt);
  const remaining = Math.max(0, Math.min(100, (Date.parse(task.expiresAt) - now) / duration * 100));
  const descriptions: Record<Task['status'], string> = {
    WAITING_SMS: '等待对应平台的验证码，收到后自动同步。测试短信只能由本地运营后台显式触发。',
    PAYMENT_PENDING: '等待确认测试额度。',
    ALLOCATION_FAILED: '号码分配失败，请查看下方结算状态。',
    SMS_FAILED: '接码处理失败，请查看结算记录或提交反馈。',
    ALLOCATING: '正在分配适用于当前平台的号码。',
    COMPLETED: '此处仅展示后台明确匹配本订单的测试短信。',
    EXPIRED: '接码已超时，结算结果以下方账本状态为准。',
    CANCELLED: '订单已取消，号码已按冷却规则回收。结算结果以下方状态为准。',
    REVIEW_REQUIRED: '异常订单待核对，不代表接码成功或已经退款。',
  };
  return <Modal title="接码订单" drawer onClose={onClose}><div className="drawer-body"><div className="drawer-service"><ServiceIcon service={task.service} /><div><h3>{task.service}</h3><Country code={task.countryCode} /></div><Status status={task.status} /></div><div className="drawer-label">任务编号<span className="mono">#{shortId(task.id)}</span><CopyButton value={task.id} label="复制完整任务编号" onCopy={onCopy} /></div><section className="number-section"><span className="field-label">临时号码 <span className="micro-label">虚构号码</span></span><div className={`drawer-phone ${task.phone ? '' : 'unallocated'}`}>{task.phone ?? '等待分配'}{task.phone && <CopyButton value={task.phone} label="复制临时号码" onCopy={onCopy} />}</div><div className="time-label"><span><Clock3 size={15} />{active ? '剩余有效时间' : '任务已结束'}</span><Countdown task={task} now={now} /></div>{active && <div className="time-track"><span className={remaining < 15 ? 'urgent-bar' : ''} style={{ width: `${remaining}%` }} /></div>}</section>
      <section className="message-section"><div className="section-title"><h3>接收结果</h3><button className="text-button" disabled={refreshing} onClick={() => { setRefreshing(true); void onRefresh().finally(() => setRefreshing(false)); }}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />刷新</button></div>{task.messages.length ? task.messages.map(message => <article className="message" key={message.id}><div className="message-meta"><span><MessageSquare size={14} />本地测试短信</span><time>{dateTime(message.receivedAt)}</time></div><p>{message.text}</p><div className="verification-code"><span>{message.code}</span><button className="text-button" onClick={() => void onCopy(message.code)}><Copy size={14} />复制验证码</button></div></article>) : <div className="message-empty"><span><MessageSquare size={24} /></span><strong>{task.status === 'ALLOCATING' ? '号码正在分配中' : active ? '等待短信' : '没有接码结果'}</strong><p>{descriptions[task.status]}</p></div>}{task.messages.length > 0 && <p className="small muted">{descriptions[task.status]}</p>}</section>
      <section className="task-timeline"><h3>订单进度</h3>{task.events.length ? task.events.map((event, index) => <div key={`${event.state}-${index}`}><StepMark done /><span>{statusNames[event.state]}<small>{dateTime(event.createdAt)}</small></span></div>) : <p className="muted small">旧版本地演示记录，未发生支付。</p>}</section>
      <dl className="detail-meta"><div><dt>订单编号</dt><dd>#{shortId(task.orderId)}</dd></div><div><dt>演示标价</dt><dd>{money(task.priceCents, task.currency)}</dd></div><div><dt>支付状态</dt><dd>{paymentNames[task.paymentStatus] ?? task.paymentStatus}</dd></div><div><dt>结算状态</dt><dd>{settlementNames[task.settlementStatus] ?? task.settlementStatus}</dd></div></dl><InlineNotice>本地演示，号码与短信不可用于实际验证。</InlineNotice></div><footer className="drawer-footer"><button className="button secondary" onClick={onFeedback}><FileText size={16} />反馈问题</button>{active && <button className="button danger-quiet" disabled={!task.canCancel} title={!task.canCancel ? '下单时的商品规则不支持取消' : '取消此接码订单'} onClick={onCancel}><XCircle size={16} />{task.canCancel ? '取消订单' : '不支持取消'}</button>}</footer></Modal>;
}

export function CancelDialog({ task, onClose, onConfirm }: { task: Task; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="取消这个订单？" onClose={onClose} busy={busy} className="compact-modal"><div className="modal-body"><div className="confirm-icon"><XCircle size={26} /></div><p className="confirm-copy">{task.service} · #{shortId(task.id)}</p><p className="muted">取消后停止等待，号码进入回收冷却。{task.paymentStatus === 'DEMO_ONLY' ? '旧版样例未扣款，不涉及结算。' : task.rules.refundOnCancel ? '本订单规则允许退回预占的测试额度，不会发生真实退款。' : '本订单将进入人工结算，测试额度不会立即退回。'}</p>{error && <p className="form-error" role="alert">{error}</p>}</div><footer className="modal-footer"><ModalDismiss><button className="button secondary" disabled={busy}>继续等待</button></ModalDismiss><button className="button danger" disabled={busy} onClick={() => { setBusy(true); setError(''); void onConfirm().catch(err => { setError(errorText(err)); setBusy(false); }); }}>{busy ? <Spinner /> : <XCircle size={16} />}确认取消</button></footer></Modal>;
}

export function FeedbackDialog({ task, onClose, onSubmit }: { task: Task; onClose: () => void; onSubmit: (message: string) => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="记录问题反馈" onClose={onClose} busy={busy}><form onSubmit={e => { e.preventDefault(); if (!message.trim() || busy) return; setBusy(true); setError(''); void onSubmit(message).catch(err => { setError(errorText(err)); setBusy(false); }); }}><div className="modal-body"><p className="muted">{task.service} · #{shortId(task.id)}</p><label className="field">问题描述<textarea aria-label="问题描述" autoFocus rows={5} maxLength={2000} required value={message} disabled={busy} onChange={e => setMessage(e.target.value)} placeholder="描述当前任务遇到的问题…" /></label><p className="small muted align-right">{message.length} / 2000</p><InlineNotice>仅保存到本地数据库，不会发送给在线客服。</InlineNotice>{error && <p className="form-error" role="alert">{error}</p>}</div><footer className="modal-footer"><ModalDismiss><button type="button" className="button secondary" disabled={busy}>返回</button></ModalDismiss><button className="button primary" type="submit" disabled={busy || !message.trim()}>{busy ? <Spinner /> : <Send size={16} />}保存反馈</button></footer></form></Modal>;
}

export function AccountDialog({ viewer, onClose }: { viewer: { id: string; name: string; email: string }; onClose: () => void }) {
  return <Modal title="本地工作区" onClose={onClose}><div className="modal-body"><div className="account-heading"><span className="avatar large">D</span><div><h3>{viewer.name}</h3><p className="muted small">{viewer.email}</p></div><CheckCircle2 size={20} className="success-text" /></div><dl className="detail-meta"><div><dt>工作区编号</dt><dd className="break-all">{viewer.id}</dd></div><div><dt>存储位置</dt><dd>本机 SQLite 数据库</dd></div><div><dt>会话类型</dt><dd>浏览器本地演示会话</dd></div></dl><InlineNotice>不是正式账号登录。当前 Cookie 用于恢复此工作区；清除后无法通过账号找回。未共享 LINEPOOL 账户或余额。</InlineNotice></div><footer className="modal-footer"><ModalDismiss><button className="button primary">关闭</button></ModalDismiss></footer></Modal>;
}
