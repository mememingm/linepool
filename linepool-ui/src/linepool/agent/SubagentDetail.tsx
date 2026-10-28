import { useEffect, useState } from 'react';
import { ArrowLeft, Copy } from 'lucide-react';
import { navigate } from '../../app/router';
import { createLinepoolApi } from '../api/client';
import type { HoldingTransfer, Subagent, TxOrder } from '../api/contracts';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import BalanceTransfer from './pages/BalanceTransfer';
import HoldingDistributionForm from './pages/HoldingDistributionForm';
import { money } from './pages/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { SubagentActions } from './SubagentActions';
import { AgentFeedback, AgentPager, AgentStatus, agentError, formatAgentDate } from './subagent-shared';

const api = createLinepoolApi();
type DetailTab = 'profile' | 'holdings' | 'transactions';
export function SubagentDetail({ id, revision }: { id: string; revision: number }) {
  const [agent, setAgent] = useState<Subagent | null>(null);
  const [tab, setTab] = useState<DetailTab>('profile');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [notice, setNotice] = useState('');
  const [holdings, setHoldings] = useState<HoldingTransfer[]>([]);
  const [orders, setOrders] = useState<TxOrder[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setAgent(null);
    void api.agentSubagent(id, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setAgent(result.data); })
      .catch(cause => { if (!controller.signal.aborted) setError(agentError(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision, refresh]);
  useEffect(() => {
    if (!agent || tab === 'profile') return;
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryError(''); setHoldings([]); setOrders([]);
    const load = async () => {
      try {
        const result = tab === 'holdings'
          ? await api.agentSubagentHoldings(id, { page, pageSize }, { signal: controller.signal })
          : await api.agentSubagentTransactions(id, { page, pageSize }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.pagination.totalPages && page > result.pagination.totalPages) { setPage(result.pagination.totalPages); return; }
        if (tab === 'holdings') setHoldings(result.data as HoldingTransfer[]);
        else setOrders(result.data as TxOrder[]);
        setTotalItems(result.pagination.totalItems); setTotalPages(result.pagination.totalPages);
      } catch (cause) { if (!controller.signal.aborted) setHistoryError(agentError(cause)); }
      finally { if (!controller.signal.aborted) setHistoryLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [agent, id, tab, page, pageSize]);
  return <section className="agent-panel subagents-page" aria-busy={loading}>
    <Button variant="ghost" className="subagent-back" onClick={() => navigate('/agent/agents' + window.location.search)}><ArrowLeft />返回下级代理</Button>
    {notice && <AgentFeedback>{notice}</AgentFeedback>}
    {error ? <AgentFeedback error>{error}<button className="agent-link" onClick={() => setRefresh(value => value + 1)}>重试</button></AgentFeedback> : loading ? <div className="subagent-state" role="status">正在加载代理资料…</div> : agent && <>
      <div className="agent-panel-heading"><div><p className="subagent-kicker">直属二级代理</p><div className="subagent-title"><h2>{agent.name}</h2><AgentStatus status={agent.status} /></div><p>查看基本资料及你与该代理之间的往来。</p></div><SubagentActions agent={agent} detail onChanged={() => { setNotice('操作已完成'); setRefresh(value => value + 1); }} /></div>
      {agent.status === 'TERMINATED' && <p className="agent-notice warning">该代理已终止。状态处置请联系平台。</p>}
      <nav className="subagent-detail-tabs" aria-label="下级代理详情页签">{([['profile', '基本资料'], ['holdings', '号码往来'], ['transactions', '交易往来']] as const).map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setPage(1); }}>{label}</button>)}{tab === 'holdings' && agent.status === 'ACTIVE' && <Button className="subagent-primary" onClick={() => setTransferOpen(true)}>转交号码</Button>}</nav>
      {tab === 'profile' ? <dl className="subagent-profile"><dt>代理名称</dt><dd>{agent.name}</dd><dt>代理编号</dt><dd className="subagent-id"><code>{agent.id}</code><Button variant="ghost" size="icon-xs" aria-label="复制代理编号" onClick={() => { void navigator.clipboard.writeText(agent.id).then(() => setNotice('代理编号已复制')).catch(() => setNotice('复制失败，请手动复制编号')); }}><Copy /></Button></dd><dt>层级</dt><dd>{agent.level} 级代理</dd><dt>状态</dt><dd><AgentStatus status={agent.status} /></dd><dt>创建时间</dt><dd>{formatAgentDate(agent.createdAt)}</dd><dt>账户余额</dt><dd>{money(agent.balanceMinor ?? 0)} {agent.status === 'ACTIVE' && <Button variant="outline" onClick={() => setBalanceOpen(true)}>转余额给 TA</Button>}</dd></dl> : <>
        <p className="subagent-history-note">{tab === 'holdings' ? '这里记录你转交给该代理的号码。历史记录会保留，当前持有状态会随释放、到期或再次转出更新。' : '仅展示你与该代理之间的交易。号码转交金额为 0，不代表完成计费销售。'}</p>
        {historyError ? <AgentFeedback error>{historyError}<button className="agent-link" onClick={() => setRefresh(value => value + 1)}>重试</button></AgentFeedback> : historyLoading ? <div className="subagent-state" role="status">正在加载往来记录…</div> : tab === 'holdings' ? holdings.length ? <Table className="agent-table"><TableHeader><TableRow>{['号码', '地区', '持有期限', '转交时间', '当前归属'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{holdings.map(holding => <TableRow key={holding.id}><TableCell><code>{holding.phoneNumber}</code></TableCell><TableCell>{holding.regionId}</TableCell><TableCell>{formatAgentDate(holding.startsAt)} → {formatAgentDate(holding.expiresAt)}</TableCell><TableCell>{formatAgentDate(holding.transferredAt)}</TableCell><TableCell><Badge variant="outline">{holding.currentlyHeld ? '该代理持有' : '已不再持有'}</Badge></TableCell></TableRow>)}</TableBody></Table> : <div className="subagent-state">暂无号码往来。转交号码后会在此保留记录。</div> : orders.length ? <Table className="agent-table"><TableHeader><TableRow>{['单号', '类型', '金额', '状态', '时间'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{orders.map(order => <TableRow key={order.id}><TableCell><code>{order.orderNumber}</code></TableCell><TableCell>{order.amountMinor === 0 && order.kind === 'TRANSFER' ? '号码转交' : order.kind === 'TRANSFER' ? '余额转移' : order.kind}</TableCell><TableCell>{(order.amountMinor / 100).toFixed(2)} {order.currency}</TableCell><TableCell>{({ COMPLETED: '已完成', FAILED: '失败', PENDING: '处理中', CANCELLED: '已取消' } as Record<string, string>)[order.status] ?? order.status}</TableCell><TableCell>{formatAgentDate(order.createdAt)}</TableCell></TableRow>)}</TableBody></Table> : <div className="subagent-state">暂无双方交易记录。</div>}
        {!historyError && <AgentPager page={page} pageSize={pageSize} totalItems={totalItems} totalPages={totalPages} busy={historyLoading} onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />}
      </>}
      {transferOpen && agent.parentAgentId && <HoldingDistributionForm agentId={agent.parentAgentId} recipient={agent} onClose={() => setTransferOpen(false)} onComplete={() => { setNotice('号码已转交并完成结算'); setRefresh(value => value + 1); }} />}
      {balanceOpen && agent.parentAgentId && <BalanceTransfer agentId={agent.parentAgentId} recipientId={agent.id} onClose={() => setBalanceOpen(false)} onComplete={() => setRefresh(value => value + 1)} />}
    </>}
  </section>;
}
