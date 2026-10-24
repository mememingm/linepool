import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createLinepoolApi } from '../api/client';
import type { Agent, BalanceAccount, Customer, NumberHolding, PriceRule, TxOrder } from '../api/contracts';
import { navigate } from '../../app/router';
import { agentHref } from './navigation';
import './AgentShell.css';

const api = createLinepoolApi();
type AgentTab = 'overview' | 'customers' | 'inventory' | 'pricing' | 'balance' | 'ledger';

function readAgentTab(pathname = window.location.pathname): AgentTab {
  const page = pathname.slice('/agent/'.length);
  return page === 'customers' || page === 'inventory' || page === 'pricing' || page === 'balance' || page === 'ledger' ? page : 'overview';
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function statusText(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: '启用', SUSPENDED: '暂停', TERMINATED: '终止',
    AVAILABLE: '可售', RESERVED: '已锁定', SOLD: '已售', RETIRED: '已退出',
    PENDING: '处理中', COMPLETED: '已完成', SUCCEEDED: '成功', FAILED: '失败', CANCELLED: '已取消',
  };
  return labels[status] ?? status;
}

function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'success'; children: ReactNode }) {
  return <div className={`agent-notice ${tone}`}>{children}</div>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="agent-stat"><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

export function AgentShell() {
  const [tab, setTab] = useState<AgentTab>(() => readAgentTab());
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [holdings, setHoldings] = useState<NumberHolding[]>([]);
  const [prices, setPrices] = useState<PriceRule[]>([]);
  const [balances, setBalances] = useState<BalanceAccount[]>([]);
  const [transactions, setTransactions] = useState<TxOrder[]>([]);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [agentUserId, setAgentUserId] = useState('');
  const [agentName, setAgentName] = useState('');
  const [customerUserId, setCustomerUserId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [priceAgentId, setPriceAgentId] = useState('');
  const [priceRegion, setPriceRegion] = useState('');
  const [priceService, setPriceService] = useState('Telegram');
  const [pricePlan, setPricePlan] = useState('monthly');
  const [price, setPrice] = useState('');
  const [fromType, setFromType] = useState<'AGENT' | 'CUSTOMER'>('AGENT');
  const [fromId, setFromId] = useState('');
  const [toType, setToType] = useState<'AGENT' | 'CUSTOMER'>('CUSTOMER');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [adjustAgentId, setAdjustAgentId] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('本地演示余额调整');
  const [holdingAgentId, setHoldingAgentId] = useState('');
  const [holdingRegion, setHoldingRegion] = useState('us');
  const [holdingPhone, setHoldingPhone] = useState('');
  const [holdingService, setHoldingService] = useState('Telegram');
  const [holdingStartsAt, setHoldingStartsAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [holdingExpiresAt, setHoldingExpiresAt] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [agentResult, customerResult, holdingResult, priceResult, balanceResult, transactionResult] = await Promise.all([
        api.agentAgents(), api.agentCustomers(), api.agentHoldings(search ? { search } : {}), api.agentPrices(), api.agentBalances(), api.agentTransactions(1, 100),
      ]);
      setAgents(agentResult.data);
      setCustomers(customerResult.data);
      setHoldings(holdingResult.data);
      setPrices(priceResult.data);
      setBalances(balanceResult.data);
      setTransactions(transactionResult.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '代理工作台数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [revision]);
  useEffect(() => {
    const syncRoute = () => setTab(readAgentTab());
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  const available = useMemo(() => holdings.filter(item => item.status === 'ACTIVE').length, [holdings]);
  const balanceTotal = useMemo(() => balances.reduce((sum, item) => sum + item.balanceMinor, 0) / 100, [balances]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setNotice(''); setError('');
    try { await action(); setNotice(success); setRevision(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
  };

  const createAgent = () => runAction(() => api.agentCreateAgent({ userId: agentUserId.trim(), parentAgentId: null, name: agentName.trim(), level: 1 }), '代理已创建');
  const createCustomer = () => runAction(() => api.agentCreateCustomer({ userId: customerUserId.trim(), agentId: null, name: customerName.trim() }), '客户已创建');
  const savePrice = () => runAction(() => api.agentSavePrice({ pricingKind: 'WHOLESALE', agentId: priceAgentId.trim() || null, buyerAgentId: null, regionId: priceRegion.trim() || null, service: priceService.trim(), plan: pricePlan.trim(), currency: 'USD', unitAmountMinor: Math.round(Number(price) * 100), priority: 0, isActive: true }), '价格已保存');
  const createHolding = () => runAction(() => api.agentCreateHolding({ ownerType: 'AGENT', agentId: holdingAgentId, regionId: holdingRegion.trim(), phoneNumber: holdingPhone.trim(), service: holdingService.trim(), startsAt: new Date(holdingStartsAt).toISOString(), expiresAt: holdingExpiresAt ? new Date(holdingExpiresAt).toISOString() : null, idempotencyKey: globalThis.crypto.randomUUID() }), '本地库存已录入');
  const adjustBalance = () => runAction(() => api.adminAdjustBalance({ ownerType: 'AGENT', agentId: adjustAgentId, currency: 'USD', direction: adjustDirection, amountMinor: Math.round(Number(adjustAmount) * 100), reason: adjustReason.trim(), idempotencyKey: globalThis.crypto.randomUUID() }), '演示余额已调整');
  const transfer = () => runAction(() => api.agentTransfer({ fromOwner: fromType === 'AGENT' ? { ownerType: 'AGENT', agentId: fromId.trim() } : { ownerType: 'CUSTOMER', customerId: fromId.trim() }, toOwner: toType === 'AGENT' ? { ownerType: 'AGENT', agentId: toId.trim() } : { ownerType: 'CUSTOMER', customerId: toId.trim() }, currency: 'USD', amountMinor: Math.round(Number(transferAmount) * 100), idempotencyKey: globalThis.crypto.randomUUID() }), '余额转移已完成');

  const tabs: Array<[AgentTab, string]> = [['overview', '工作台'], ['customers', '主体管理'], ['inventory', '库存'], ['pricing', '价格'], ['balance', '余额'], ['ledger', '流水']];

  return <main className="agent-shell">
    <header className="agent-header">
      <div><p className="agent-eyebrow">LINEPOOL AGENT</p><h1>代理工作台</h1><p className="agent-subtitle">管理客户、号码库存、代理价格与余额流水</p></div>
      <button className="agent-button secondary" onClick={() => setRevision(value => value + 1)} disabled={loading}>↻ 刷新</button>
    </header>
    <nav className="agent-tabs" aria-label="代理工作台导航">
      {tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); navigate(agentHref(key === 'overview' ? 'dashboard' : key)); }}>{label}</button>)}
    </nav>
    {notice ? <Notice tone="success">{notice}</Notice> : null}
    {error ? <Notice tone="warning"><span>{error}</span><button className="agent-link" onClick={() => setRevision(value => value + 1)}>重试</button></Notice> : null}
    {loading ? <div className="agent-loading">正在同步代理数据…</div> : null}

    {tab === 'overview' ? <>
      <section className="agent-stats"><Stat label="可见库存" value={String(available)} detail={`共 ${holdings.length} 个号码`} /><Stat label="余额总计" value={`${balanceTotal.toFixed(2)} USD`} detail="当前可见账户余额" /><Stat label="客户主体" value={String(customers.length)} detail="代理名下客户" /><Stat label="价格规则" value={String(prices.length)} detail="已配置批发规则" /></section>
      <section className="agent-grid two"><div className="agent-panel"><h2>代理层级</h2><EntityTable rows={agents} empty="暂无下级代理" columns={['主体', '状态', '上级']} render={row => [row.name, statusText(row.status), row.parentAgentId ? '上级代理' : '平台']} /></div><div className="agent-panel"><h2>当前范围</h2><p className="agent-muted">页面数据仅展示当前代理及其可见下级范围。号码采购、支付与充值暂未接入真实上游。</p><div className="agent-actions"><button className="agent-button" onClick={() => setTab('customers')}>管理客户</button><button className="agent-button secondary" onClick={() => setTab('inventory')}>查看库存</button></div></div></section>
    </> : null}

    {tab === 'customers' ? <section className="agent-panel"><div className="panel-heading"><div><h2>主体管理</h2><p>创建下级代理或代理客户，必须绑定已有的普通用户账号。</p></div></div><div className="agent-grid two"><Form title="创建下级代理" submit="创建代理" onSubmit={createAgent} disabled={!agentUserId.trim() || !agentName.trim()}><label>已有用户 ID<input value={agentUserId} onChange={event => setAgentUserId(event.target.value)} placeholder="UUID" /></label><label>代理名称<input value={agentName} onChange={event => setAgentName(event.target.value)} placeholder="例如：华东代理" /></label></Form><Form title="创建客户" submit="创建客户" onSubmit={createCustomer} disabled={!customerUserId.trim() || !customerName.trim()}><label>已有用户 ID<input value={customerUserId} onChange={event => setCustomerUserId(event.target.value)} placeholder="UUID" /></label><label>客户名称<input value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="客户主体名称" /></label></Form></div><div className="agent-grid two"><div><h3>代理列表</h3><EntityTable rows={agents} empty="暂无下级代理" columns={['主体', '状态', '创建时间']} render={row => [row.name, statusText(row.status), formatDate(row.createdAt)]} /></div><div><h3>客户列表</h3><EntityTable rows={customers} empty="暂无客户" columns={['主体', '状态', '创建时间']} render={row => [row.name, statusText(row.status), formatDate(row.createdAt)]} /></div></div></section> : null}

    {tab === 'inventory' ? <section className="agent-panel"><div className="panel-heading"><div><h2>号码库存</h2><p>只显示当前代理范围内的库存状态；管理员可录入本地演示库存，真实 PC 采购链路暂未接入。</p></div><div className="agent-inline"><input aria-label="搜索号码" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索号码" /><button className="agent-button secondary" onClick={() => setRevision(value => value + 1)}>搜索</button></div></div><div className="agent-grid two"><Form title="管理员录入演示库存" submit="录入号码" onSubmit={createHolding} disabled={!holdingAgentId || !holdingPhone.trim() || !holdingRegion.trim() || !holdingService.trim()}><label>归属代理<select value={holdingAgentId} onChange={event => setHoldingAgentId(event.target.value)}><option value="">选择代理</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.level} 级</option>)}</select></label><label>地区 ID<input value={holdingRegion} onChange={event => setHoldingRegion(event.target.value)} placeholder="us / gb / ca" /></label><label>号码<input value={holdingPhone} onChange={event => setHoldingPhone(event.target.value)} placeholder="+15551234567" /></label><label>平台服务<input value={holdingService} onChange={event => setHoldingService(event.target.value)} /></label><label>开始时间<input type="datetime-local" value={holdingStartsAt} onChange={event => setHoldingStartsAt(event.target.value)} /></label><label>到期时间<input type="datetime-local" value={holdingExpiresAt} onChange={event => setHoldingExpiresAt(event.target.value)} /></label></Form></div><EntityTable rows={holdings} empty="暂无可见库存" columns={['号码', '状态', '归属类型', '地区', '持有期限']} render={row => [row.phoneNumber, statusText(row.status), row.ownerType === 'AGENT' ? '代理' : '客户', row.regionId, `${formatDate(row.startsAt)} → ${formatDate(row.expiresAt)}`]} /></section> : null}

    {tab === 'pricing' ? <section className="agent-panel"><div className="panel-heading"><div><h2>代理价格</h2><p>当前仅支持代理批发价格规则；充值、支付和真实采购不在本期范围。</p></div></div><Form title="设置批发价" submit="保存价格" onSubmit={savePrice} disabled={!priceService.trim() || !pricePlan.trim() || !price || Number(price) <= 0}><label>目标代理 ID（平台管理员填写）<input value={priceAgentId} onChange={event => setPriceAgentId(event.target.value)} placeholder="代理 UUID；代理本人可留空" /></label><label>地区 ID（可选）<input value={priceRegion} onChange={event => setPriceRegion(event.target.value)} placeholder="us / gb / ca" /></label><label>服务<input value={priceService} onChange={event => setPriceService(event.target.value)} /></label><label>套餐<input value={pricePlan} onChange={event => setPricePlan(event.target.value)} /></label><label>单价（USD）<input type="number" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} placeholder="0.00" /></label></Form><EntityTable rows={prices} empty="暂无价格规则" columns={['类型', '地区', '服务 / 套餐', '单价', '状态']} render={row => [row.pricingKind === 'WHOLESALE' ? '批发' : '零售', row.regionId ?? '全部', `${row.service} / ${row.plan}`, `${(row.unitAmountMinor / 100).toFixed(2)} ${row.currency}`, row.isActive ? '启用' : '停用']} /></section> : null}

    {tab === 'balance' ? <section className="agent-panel"><div className="panel-heading"><div><h2>余额与转移</h2><p>管理员可以为演示账户调整余额；代理只能在受控范围内转移已有余额。</p></div></div><Form title="管理员调整演示余额" submit="提交调整" onSubmit={adjustBalance} disabled={!adjustAgentId || !adjustAmount || Number(adjustAmount) <= 0 || !adjustReason.trim()}><label>目标代理<select value={adjustAgentId} onChange={event => setAdjustAgentId(event.target.value)}><option value="">选择代理</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label>方向<select value={adjustDirection} onChange={event => setAdjustDirection(event.target.value as 'CREDIT' | 'DEBIT')}><option value="CREDIT">增加</option><option value="DEBIT">扣减</option></select></label><label>金额（USD）<input type="number" min="0.01" step="0.01" value={adjustAmount} onChange={event => setAdjustAmount(event.target.value)} placeholder="0.00" /></label><label>原因<input value={adjustReason} onChange={event => setAdjustReason(event.target.value)} /></label></Form><div className="agent-grid two"><div><h3>余额账户</h3><EntityTable rows={balances} empty="暂无余额账户" columns={['账户', '类型', '币种', '余额']} render={row => [row.agentId ?? row.customerId ?? row.id, row.ownerType === 'AGENT' ? '代理' : '客户', row.currency, `${(row.balanceMinor / 100).toFixed(2)}`]} /></div><Form title="转移余额" submit="提交转移" onSubmit={transfer} disabled={!fromId.trim() || !toId.trim() || !transferAmount || Number(transferAmount) <= 0}><label>来源类型<select value={fromType} onChange={event => setFromType(event.target.value as 'AGENT' | 'CUSTOMER')}><option value="AGENT">代理</option><option value="CUSTOMER">客户</option></select></label><label>来源主体 ID<input value={fromId} onChange={event => setFromId(event.target.value)} placeholder="UUID" /></label><label>目标类型<select value={toType} onChange={event => setToType(event.target.value as 'AGENT' | 'CUSTOMER')}><option value="CUSTOMER">客户</option><option value="AGENT">代理</option></select></label><label>目标主体 ID<input value={toId} onChange={event => setToId(event.target.value)} placeholder="UUID" /></label><label>转移金额（USD）<input type="number" min="0.01" step="0.01" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} placeholder="0.00" /></label></Form></div><Notice>充值、支付、退款和真实供应商采购暂未开放，页面不会伪造成功状态。</Notice></section> : null}

    {tab === 'ledger' ? <section className="agent-panel"><div className="panel-heading"><div><h2>交易流水</h2><p>余额转移等交易记录按当前代理可见范围展示。</p></div></div><EntityTable rows={transactions} empty="暂无交易流水" columns={['单号', '类型', '买方', '金额', '状态', '时间']} render={row => [row.orderNumber, row.kind, row.buyerType === 'AGENT' ? '代理' : '客户', `${(row.amountMinor / 100).toFixed(2)} ${row.currency}`, statusText(row.status), formatDate(row.createdAt)]} /></section> : null}
  </main>;
}

export default AgentShell;

function Form({ title, submit, onSubmit, disabled, children }: { title: string; submit: string; onSubmit: () => void; disabled: boolean; children: ReactNode }) {
  return <form className="agent-form" onSubmit={event => { event.preventDefault(); if (!disabled) onSubmit(); }}><h3>{title}</h3>{children}<button className="agent-button" type="submit" disabled={disabled}>{submit}</button></form>;
}

function EntityTable<T extends object>({ rows, empty, columns, render }: { rows: T[]; empty: string; columns: string[]; render: (row: T) => string[] }) {
  if (!rows.length) return <div className="agent-empty">{empty}</div>;
  return <div className="agent-table-wrap"><table className="agent-table"><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String((row as { id?: string }).id ?? index)}>{render(row).map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
