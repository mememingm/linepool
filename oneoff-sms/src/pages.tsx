import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, Plus, RefreshCw, SlidersHorizontal, Wallet } from 'lucide-react';
import { api, errorText } from './api';
import { platformDescription, platformList } from './catalog';
import { SelectField } from './select';
import { CopyButton, Countdown, Country, EmptyState, InlineNotice, Modal, ModalDismiss, Pagination, SearchField, ServiceIcon, Spinner, Status, tabKeys } from './components';
import { dateTime, isActive, ledgerNames, money, shortId, statusNames, type Bootstrap, type Product, type Task } from './types';

type TaskActions = { onOpen: (task: Task) => void; onCopy: (value: string) => Promise<void> };
export function TaskTable({ tasks, now, history = false, onOpen, onCopy }: TaskActions & { tasks: Task[]; now: number; history?: boolean }) {
  return <div className="table-scroll"><table className="task-table"><thead><tr><th>平台 / 订单</th><th>国家</th><th>临时号码</th><th>金额</th><th>{history ? '创建时间' : '剩余时间'}</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id} data-task-id={task.id}>
    <td className="cell-service"><ServiceIcon service={task.service} small /><span><strong>{task.service}</strong><span className="row-secondary">#{shortId(task.orderId)}</span></span></td>
    <td className="cell-country"><Country code={task.countryCode} /></td>
    <td className="cell-phone">{task.phone ? <span className="phone"><span>{task.phone}</span><CopyButton value={task.phone} label={`复制 ${task.service} 号码`} onCopy={onCopy} /></span> : <span className="muted unallocated">尚未分配</span>}</td>
    <td className="cell-amount numeric">{money(task.priceCents, task.currency)}</td>
    <td className="cell-time">{history ? <span className="date-value">{dateTime(task.createdAt)}</span> : <Countdown task={task} now={now} />}</td>
    <td className="cell-status"><Status status={task.status} /></td>
    <td className="cell-action align-right"><button className="text-button" aria-label={`查看 ${task.service} 订单 ${shortId(task.orderId)}`} onClick={() => onOpen(task)}>查看<ChevronRight size={15} /></button></td>
  </tr>)}</tbody></table></div>;
}

export function TasksPage({ data, now, onOpen, onCopy, onCreate, onRefresh, syncing, lastUpdated }: TaskActions & { data: Bootstrap; now: number; onCreate: () => void; onRefresh: () => void; syncing: boolean; lastUpdated: number }) {
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [days, setDays] = useState('all'); const [page, setPage] = useState(1);
  const active = data.tasks.filter(isActive); const history = data.tasks.filter(task => !isActive(task));
  const list = (tab === 'active' ? active : history).filter(task => `${task.service} ${task.id} ${task.orderId} ${task.phone ?? ''}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || task.status === status) && (days === 'all' || now - Date.parse(task.createdAt) <= Number(days) * 86400000));
  const pages = Math.max(1, Math.ceil(list.length / 8)); useEffect(() => { setPage(p => Math.min(p, pages)); }, [pages]);
  return <>
    <div className="page-heading"><div><span className="eyebrow">YOUR VERIFICATIONS</span><h1>我的订单</h1><p>单次收码订单 · 自动同步接收结果</p></div><button className="button primary" onClick={onCreate}><Plus size={17} />立即接码</button></div>
    <section className="task-section" aria-label="接码订单列表"><div className="section-toolbar"><div className="tabs" role="tablist" aria-label="订单分类" onKeyDown={tabKeys}>{(['active', 'history'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => { setTab(value); setStatus('all'); setPage(1); }}>{value === 'active' ? '进行中' : '已结束'}<span>{value === 'active' ? active.length : history.length}</span></button>)}</div><div className="toolbar-controls"><SearchField value={query} onChange={value => { setQuery(value); setPage(1); }} placeholder="搜索平台、号码或订单" /><SelectField label="订单状态" icon={<SlidersHorizontal size={15} />} value={status} onChange={value => { setStatus(value); setPage(1); }} options={[{ value: 'all', label: '全部状态' }, ...(tab === 'active' ? ['PAYMENT_PENDING', 'WAITING_SMS', 'ALLOCATING'] : ['COMPLETED', 'EXPIRED', 'CANCELLED', 'ALLOCATION_FAILED', 'SMS_FAILED', 'REVIEW_REQUIRED']).map(value => ({ value, label: statusNames[value as Task['status']] }))]} /><DateFilter value={days} onChange={value => { setDays(value); setPage(1); }} /></div></div>
      {list.length ? <TaskTable tasks={list.slice((page - 1) * 8, page * 8)} now={now} history={tab === 'history'} onOpen={onOpen} onCopy={onCopy} /> : <EmptyState title={query || status !== 'all' || days !== 'all' ? '没有匹配的订单' : tab === 'active' ? '当前没有进行中的接码' : '还没有已结束订单'} description="选择所需平台和国家，开始一次接码。" action={<button className="button secondary" onClick={onCreate}><Plus size={16} />选择平台</button>} />}
      <div className="list-footer"><span className="sync-status"><span className="live-dot" />{syncing ? '正在同步' : `更新于 ${new Date(lastUpdated).toLocaleTimeString('zh-CN', { hour12: false })}`}<button className="icon-button" title="重新同步" aria-label="重新同步" onClick={onRefresh} disabled={syncing}><RefreshCw size={14} className={syncing ? 'spin' : ''} /></button></span><Pagination total={list.length} page={page} onChange={setPage} /></div>
    </section><InlineNotice>测试环境：号码、价格、短信及资金均为本地测试数据，不能用于真实验证。</InlineNotice>
  </>;
}

export function MarketPage({ products, onSelect }: { products: Product[]; onSelect: (product: Product) => void }) {
  const [query, setQuery] = useState('');
  const list = platformList(products).filter(product => product.service.toLowerCase().includes(query.trim().toLowerCase()) || platformDescription(product.service).includes(query.trim()));
  return <><div className="page-heading market-heading"><div><span className="eyebrow">SMS VERIFICATION</span><h1>接收验证码</h1><p>选择平台和国家，开始一次接码。</p></div><SearchField value={query} onChange={setQuery} placeholder="搜索平台" label="搜索市场服务" /></div>
    <div className="catalog-meta"><span>选择平台 <strong>{list.length}</strong></span><span className="muted">平台<ChevronRight size={12} />国家<ChevronRight size={12} />确认接码</span></div>
    {list.length ? <div className="platform-grid">{list.map(platform => <button type="button" className="platform-card" key={platform.service} onClick={() => onSelect(platform)} aria-label={`选择平台 ${platform.service}`}><ServiceIcon service={platform.service} /><span><strong>{platform.service}</strong><small>{platformDescription(platform.service)}</small></span></button>)}</div> : <EmptyState title="没有匹配的平台" description="尝试其他平台名称。" action={<button className="button secondary" onClick={() => setQuery('')}>清除搜索</button>} />}
    <div className="market-disclosure"><span className="live-dot" /><p>本地测试模式 · 价格与可用量来自本机数据库，不代表真实可售资源。</p></div></>;
}

function DateFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <SelectField label="订单时间" value={value} onChange={onChange} options={[{ value: 'all', label: '全部时间' }, { value: '7', label: '最近 7 天' }, { value: '30', label: '最近 30 天' }]} />;
}
export function HistoryPage({ data, now, onOpen, onCopy }: TaskActions & { data: Bootstrap; now: number }) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [days, setDays] = useState('all'); const [page, setPage] = useState(1);
  const list = data.tasks.filter(t => `${t.service} ${t.id} ${t.phone ?? ''} ${t.orderId}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || t.status === status) && (days === 'all' || now - Date.parse(t.createdAt) <= Number(days) * 86400000));
  const pages = Math.max(1, Math.ceil(list.length / 8)); useEffect(() => { setPage(p => Math.min(p, pages)); }, [pages]);
  return <><div className="page-heading"><div><span className="eyebrow">ORDER HISTORY</span><h1>历史一次取码</h1><p>{data.tasks.length} 条旧任务，含仍在等待的遗留分配；按原规则结束。</p></div></div><section className="task-section"><div className="record-toolbar"><SearchField value={query} onChange={v => { setQuery(v); setPage(1); }} placeholder="搜索平台、号码或订单" /><SelectField label="历史状态" value={status} onChange={value => { setStatus(value); setPage(1); }} options={[{ value: 'all', label: '全部状态' }, ...['WAITING_SMS', 'ALLOCATING', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'ALLOCATION_FAILED', 'SMS_FAILED', 'REVIEW_REQUIRED'].map(value => ({ value, label: statusNames[value as Task['status']] }))]} /><DateFilter value={days} onChange={value => { setDays(value); setPage(1); }} /></div>{list.length ? <TaskTable tasks={list.slice((page - 1) * 8, page * 8)} now={now} history onOpen={onOpen} onCopy={onCopy} /> : <EmptyState />}<Pagination total={list.length} page={page} onChange={setPage} /></section></>;
}

export function FinancePage({ data, now, onOpen, onRefresh }: { data: Bootstrap; now: number; onOpen: (task: Task) => void; onRefresh: () => Promise<boolean> }) {
  const [kind, setKind] = useState('all'); const [query, setQuery] = useState(''); const [days, setDays] = useState('all'); const [page, setPage] = useState(1); const [topUp, setTopUp] = useState(false);
  const list = data.ledger.filter(entry => (kind === 'all' || entry.kind === kind) && `${entry.id} ${entry.taskId ?? ''} ${ledgerNames[entry.kind]}`.toLowerCase().includes(query.toLowerCase()) && (days === 'all' || now - Date.parse(entry.createdAt) <= Number(days) * 86400000));
  const pages = Math.max(1, Math.ceil(list.length / 8)); useEffect(() => { setPage(p => Math.min(p, pages)); }, [pages]);
  return <><div className="page-heading"><div><span className="eyebrow">TEST WALLET</span><h1>钱包</h1><p>测试额度账本 · 无真实充值、付款或退款</p></div><button className="button primary" onClick={() => setTopUp(true)}><Plus size={16} />添加测试额度</button></div>
    <div className="finance-summary"><div><span>可用测试额度</span><strong>{money(data.wallet.balanceCents)}</strong></div><div><span>订单预占额度</span><strong>{money(data.wallet.heldCents)}</strong></div><div><span>已结算测试租金与历史订单</span><strong>{money(data.leaseOrders.filter(o => o.status === 'TEST_PAID').reduce((sum, o) => sum + o.priceCents, 0) + data.tasks.filter(t => t.settlementStatus === 'TEST_SETTLED').reduce((sum, t) => sum + t.priceCents, 0))}</strong></div></div>
    <section className="task-section"><div className="record-toolbar"><SearchField value={query} onChange={value => { setQuery(value); setPage(1); }} placeholder="搜索流水或关联任务" /><SelectField label="流水类型" value={kind} onChange={value => { setKind(value); setPage(1); }} options={[{ value: 'all', label: '全部流水' }, ...Object.entries(ledgerNames).map(([value, label]) => ({ value, label }))]} /><DateFilter value={days} onChange={value => { setDays(value); setPage(1); }} /></div>{list.length ? <div className="table-scroll"><table className="ledger-table"><thead><tr><th>类型 / 编号</th><th>可用额度变动</th><th>预占变动</th><th>变动后可用</th><th>时间</th><th /></tr></thead><tbody>{list.slice((page - 1) * 8, page * 8).map(entry => <tr key={entry.id}><td><strong>{ledgerNames[entry.kind]}</strong><small className="row-secondary">#{shortId(entry.id)}</small></td><td data-label="可用变动" className={entry.balanceDelta > 0 ? 'success-text numeric' : 'numeric'}>{entry.balanceDelta > 0 ? '+' : ''}{money(entry.balanceDelta)}</td><td data-label="预占变动" className="numeric">{entry.heldDelta > 0 ? '+' : ''}{money(entry.heldDelta)}</td><td data-label="可用余额" className="numeric">{money(entry.balanceAfter)}</td><td data-label="时间" className="date-value">{dateTime(entry.createdAt)}</td><td>{entry.taskId && <button className="text-button" onClick={() => { const task = data.tasks.find(t => t.id === entry.taskId); if (task) onOpen(task); }}>订单<ArrowRight size={14} /></button>}</td></tr>)}</tbody></table></div> : <EmptyState />}<Pagination total={list.length} page={page} onChange={setPage} /></section>
    <InlineNotice>租约开通和续费立即结算，旧订单按原预占规则处理；金额不是可提现资产。真实充值接口未接通，未发生真实到账。</InlineNotice>
    {topUp && <TestCreditDialog onClose={() => setTopUp(false)} onDone={async () => { await onRefresh(); setTopUp(false); }} />}
  </>;
}
function TestCreditDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState('1000'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const key = useRef(crypto.randomUUID()); const attempt = useRef<{ amountCents: number; idempotencyKey: string } | null>(null);
  return <Modal title="添加测试额度" onClose={onClose} busy={busy}><form onSubmit={e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); attempt.current ??= { amountCents: Number(amount), idempotencyKey: key.current }; void api('/wallet/test-credit', { method: 'POST', body: JSON.stringify(attempt.current) }).then(onDone).catch(err => { setError(errorText(err)); setBusy(false); }); }}><div className="modal-body"><InlineNotice>这是本机测试账本，不会发起支付，不代表真实充值到账。</InlineNotice><SelectField label="测试额度金额" value={amount} onChange={value => { setAmount(value); attempt.current = null; key.current = crypto.randomUUID(); }} options={[{ value: '1000', label: '$10.00 测试额度' }, { value: '5000', label: '$50.00 测试额度' }]} disabled={busy || Boolean(attempt.current)} />{error && <p className="form-error" role="alert">{error}</p>}</div><footer className="modal-footer"><ModalDismiss><button type="button" className="button secondary" disabled={busy}>取消</button></ModalDismiss><button className="button primary" disabled={busy} type="submit">{busy ? <Spinner /> : <Wallet size={16} />}{error ? '重试同一请求' : '确认添加测试额度'}</button></footer></form></Modal>;
}

export function HelpPage() {
  return <><div className="page-heading"><div><span className="eyebrow">HELP & POLICIES</span><h1>帮助中心</h1><p>服务规则与测试边界</p></div></div><div className="help-layout"><section><h2>常见问题</h2>{[
    ['我购买的是什么？', '指定平台、指定国家的一次验证码接收服务，不是号码所有权。号码由系统分配。当前全部为本地测试，不能用于真实验证。'],
    ['为什么不同国家的库存不一样？', '可用量按号码国家、已确认的平台能力、在线状态、占用、历史使用和冷却条件计算。未配置资源的国家或平台不提供接码。演示能力不代表真实服务兼容性。'],
    ['同一个号码会给不同用户使用吗？', '测试模型允许跨平台顺序复用，但同一时间只允许一个有效订单。任务结束后有冷却期；默认不再出售同一号码在已使用平台的接码机会。'],
    ['验证码如何更新？', '管理员可显式发起本地测试短信。后台校验任务、号码、平台、时间窗口和消息标识后才交付；页面通过实时连接自动更新。系统不会自行生成短信或伪造真实接收结果。'],
    ['取消和退款按什么规则处理？', '以下单时保存的商品规则为准。默认测试配置允许取消并退回预占额度，超时和分配失败也会退回。未配置自动退款的订单进入人工结算，不会虚报已退款。所有资金操作仅为测试账本。'],
    ['余额和充值是真实的吗？', '不是。新工作区会获赠明确标记的测试额度，后续可手动添加测试额度。真实支付接口尚未接通，不会模拟真实到账，也不能提现。'],
    ['会收到其他客户的短信吗？', '只有明确匹配当前订单及分配周期的短信才会展示。无法确认归属的短信进入后台隔离队列，不会按当前号码使用人直接分发。'],
    ['旧版任务和 LINEPOOL 数据怎么办？', '旧版演示任务及会话保留，按原来的无支付状态展示。新旧数据不会混用资金流水。LINEPOOL 和 eSIM 的代码、号码、账号及余额均未改动。'],
    ['是否有正式账号登录？', '当前仍为浏览器本地演示会话，保存在本机 SQLite。清除 Cookie 会进入不同工作区，未实现正式账号登录与找回。运营后台使用独立的本机管理员凭据。'],
  ].map(([q, a], i) => <details key={q} open={i === 0}><summary>{q}<Plus size={16} /></summary><p>{a}</p></details>)}</section><aside className="help-note"><h2>真实接入前需确认</h2><ul><li>PingCode 资源与平台可用性</li><li>短信归属及分配周期标识</li><li>号码使用历史与冷却限制</li><li>支付、退款及成功判定规则</li><li>正式客户身份与运营权限</li></ul><span className="outline-tag">真实交易未开放</span></aside></div></>;
}
