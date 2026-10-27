import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy } from 'lucide-react';
import { navigate } from '../../app/router';
import { createLinepoolApi } from '../api/client';
import type { HoldingTransfer, Subagent, TransferableHolding, TxOrder } from '../api/contracts';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
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
  const [transferable, setTransferable] = useState<TransferableHolding[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [selectedHoldingId, setSelectedHoldingId] = useState('');
  const [startsAt, setStartsAt] = useState(() => localDateTime(new Date()));
  const [expiresAt, setExpiresAt] = useState(() => localDateTime(new Date(Date.now() + 30 * 86400000)));
  const [transferBusy, setTransferBusy] = useState(false);
  const transferRequest = useRef<{ signature: string; key: string } | null>(null);
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
  useEffect(() => {
    if (!transferOpen) return;
    const controller = new AbortController();
    setTransferLoading(true); setTransferError('');
    void api.agentTransferableHoldings({}, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setTransferable(result.data);
      setSelectedHoldingId(current => current && result.data.some(item => item.id === current) ? current : result.data[0]?.id ?? '');
    }).catch(cause => { if (!controller.signal.aborted) setTransferError(agentError(cause)); })
      .finally(() => { if (!controller.signal.aborted) setTransferLoading(false); });
    return () => controller.abort();
  }, [transferOpen, revision]);
  const submitTransfer = async () => {
    if (transferBusy || !selectedHoldingId || !agent) return;
    const start = new Date(startsAt); const expiry = new Date(expiresAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(expiry.getTime()) || expiry <= start) {
      setTransferError('请填写有效的转交起止时间，结束时间必须晚于开始时间。');
      return;
    }
    const input = { holdingId: selectedHoldingId, toAgentId: agent.id, startsAt: start.toISOString(), expiresAt: expiry.toISOString() };
    const signature = JSON.stringify(input);
    if (transferRequest.current?.signature !== signature) transferRequest.current = { signature, key: crypto.randomUUID() };
    setTransferBusy(true); setTransferError('');
    try {
      await api.agentResellHolding({ ...input, idempotencyKey: transferRequest.current.key });
      transferRequest.current = null; setTransferOpen(false); setNotice('号码已转交给该代理'); setRefresh(value => value + 1);
    } catch (cause) { setTransferError(agentError(cause)); }
    finally { setTransferBusy(false); }
  };
  return <section className="agent-panel subagents-page" aria-busy={loading}>
    <Button variant="ghost" className="subagent-back" onClick={() => navigate('/agent/agents' + window.location.search)}><ArrowLeft />返回下级代理</Button>
    {notice && <AgentFeedback>{notice}</AgentFeedback>}
    {error ? <AgentFeedback error>{error}<button className="agent-link" onClick={() => setRefresh(value => value + 1)}>重试</button></AgentFeedback> : loading ? <div className="subagent-state" role="status">正在加载代理资料…</div> : agent && <>
      <div className="agent-panel-heading"><div><p className="subagent-kicker">直属二级代理</p><div className="subagent-title"><h2>{agent.name}</h2><AgentStatus status={agent.status} /></div><p>查看基本资料及你与该代理之间的往来。</p></div><SubagentActions agent={agent} detail onChanged={() => { setNotice('操作已完成'); setRefresh(value => value + 1); }} /></div>
      {agent.status === 'TERMINATED' && <p className="agent-notice warning">该代理已终止。状态处置请联系平台。</p>}
      <nav className="subagent-detail-tabs" aria-label="下级代理详情页签">{([['profile', '基本资料'], ['holdings', '号码往来'], ['transactions', '交易往来']] as const).map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setPage(1); }}>{label}</button>)}{tab === 'holdings' && agent.status === 'ACTIVE' && <Button className="subagent-primary" onClick={() => setTransferOpen(true)}>转交号码</Button>}</nav>
      {tab === 'profile' ? <dl className="subagent-profile"><dt>代理名称</dt><dd>{agent.name}</dd><dt>代理编号</dt><dd className="subagent-id"><code>{agent.id}</code><Button variant="ghost" size="icon-xs" aria-label="复制代理编号" onClick={() => { void navigator.clipboard.writeText(agent.id).then(() => setNotice('代理编号已复制')).catch(() => setNotice('复制失败，请手动复制编号')); }}><Copy /></Button></dd><dt>层级</dt><dd>{agent.level} 级代理</dd><dt>状态</dt><dd><AgentStatus status={agent.status} /></dd><dt>创建时间</dt><dd>{formatAgentDate(agent.createdAt)}</dd></dl> : <>
        <p className="subagent-history-note">{tab === 'holdings' ? '这里记录你转交给该代理的号码。历史记录会保留，当前持有状态会随释放、到期或再次转出更新。' : '仅展示你与该代理之间的交易。号码转交金额为 0，不代表完成计费销售。'}</p>
        {historyError ? <AgentFeedback error>{historyError}<button className="agent-link" onClick={() => setRefresh(value => value + 1)}>重试</button></AgentFeedback> : historyLoading ? <div className="subagent-state" role="status">正在加载往来记录…</div> : tab === 'holdings' ? holdings.length ? <Table className="agent-table"><TableHeader><TableRow>{['号码', '地区', '持有期限', '转交时间', '当前归属'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{holdings.map(holding => <TableRow key={holding.id}><TableCell><code>{holding.phoneNumber}</code></TableCell><TableCell>{holding.regionId}</TableCell><TableCell>{formatAgentDate(holding.startsAt)} → {formatAgentDate(holding.expiresAt)}</TableCell><TableCell>{formatAgentDate(holding.transferredAt)}</TableCell><TableCell><Badge variant="outline">{holding.currentlyHeld ? '该代理持有' : '已不再持有'}</Badge></TableCell></TableRow>)}</TableBody></Table> : <div className="subagent-state">暂无号码往来。转交号码后会在此保留记录。</div> : orders.length ? <Table className="agent-table"><TableHeader><TableRow>{['单号', '类型', '金额', '状态', '时间'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{orders.map(order => <TableRow key={order.id}><TableCell><code>{order.orderNumber}</code></TableCell><TableCell>{order.amountMinor === 0 && order.kind === 'TRANSFER' ? '号码转交' : order.kind === 'TRANSFER' ? '余额转移' : order.kind}</TableCell><TableCell>{(order.amountMinor / 100).toFixed(2)} {order.currency}</TableCell><TableCell>{({ COMPLETED: '已完成', FAILED: '失败', PENDING: '处理中', CANCELLED: '已取消' } as Record<string, string>)[order.status] ?? order.status}</TableCell><TableCell>{formatAgentDate(order.createdAt)}</TableCell></TableRow>)}</TableBody></Table> : <div className="subagent-state">暂无双方交易记录。</div>}
        {!historyError && <AgentPager page={page} pageSize={pageSize} totalItems={totalItems} totalPages={totalPages} busy={historyLoading} onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />}
      </>}
      <Dialog open={transferOpen} onOpenChange={value => { if (!transferBusy) { setTransferOpen(value); if (!value) setTransferError(''); } }}><DialogContent className="subagent-dialog" showCloseButton={!transferBusy} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (transferBusy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>转交号码给 {agent.name}</DialogTitle><DialogDescription>只允许转交当前一级代理自己持有、仍在有效期内的本地库存。该操作会结束你的持有记录并创建下级代理的新持有记录。</DialogDescription></DialogHeader>
        <form className="subagent-form" onSubmit={event => { event.preventDefault(); void submitTransfer(); }}>
          <label>选择号码<select required value={selectedHoldingId} disabled={transferBusy || transferLoading} onChange={event => setSelectedHoldingId(event.target.value)}><option value="">{transferLoading ? '正在加载可转交库存…' : transferable.length ? '请选择号码' : '暂无可转交号码'}</option>{transferable.map(item => <option key={item.id} value={item.id}>{item.phoneNumber} · {item.regionId} · {item.service}</option>)}</select></label>
          <label>开始时间<input required type="datetime-local" value={startsAt} disabled={transferBusy} onChange={event => setStartsAt(event.target.value)} /></label>
          <label>结束时间<input required type="datetime-local" value={expiresAt} disabled={transferBusy} onChange={event => setExpiresAt(event.target.value)} /></label>
          {transferError && <div className="subagent-inline-error" role="alert">{transferError}</div>}
          <div className="subagent-form-actions"><Button type="button" variant="outline" disabled={transferBusy} onClick={() => setTransferOpen(false)}>取消</Button><Button type="submit" className="subagent-primary" disabled={transferBusy || transferLoading || !selectedHoldingId}>{transferBusy ? '正在转交…' : '确认转交'}</Button></div>
        </form>
      </DialogContent></Dialog>
    </>}
  </section>;
}
function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
