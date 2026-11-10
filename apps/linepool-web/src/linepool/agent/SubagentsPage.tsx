import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Copy, Plus, Search, Users } from 'lucide-react';
import { navigate } from '../../app/router';
import { createLinepoolApi } from '../api/client';
import { subagentsQuerySchema, type Subagent } from '../api/contracts';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { subagentHref } from './navigation';
import { SubagentActions } from './SubagentActions';
import { AgentFeedback, AgentPager, AgentStatus, agentError, formatAgentDate } from './subagent-shared';
import { SubagentDetail } from './SubagentDetail';
import './Subagents.css';

const api = createLinepoolApi();
export function SubagentsPage({ route, revision, allowed }: { route: string; revision: number; allowed: boolean }) {
  const pathname = route.split('?')[0];
  const id = pathname.split('/')[3];
  if (!allowed) return <section className="agent-panel"><h2>无法访问下级代理管理</h2><p className="agent-muted">仅一级代理可管理直属下级。你可以继续管理自己的客户、库存与交易。</p><Button variant="outline" onClick={() => navigate('/agent')}>返回工作台</Button></section>;
  return id ? <SubagentDetail key={id} id={id} revision={revision} /> : <SubagentList route={route} revision={revision} />;
}

function SubagentList({ route, revision }: { route: string; revision: number }) {
  const params = new URLSearchParams(route.split('?')[1]);
  const parsed = subagentsQuerySchema.safeParse(Object.fromEntries(params));
  const query = parsed.success ? parsed.data : subagentsQuerySchema.parse({});
  const [search, setSearch] = useState(query.search);
  const [data, setData] = useState<Subagent[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const changeQuery = (changes: Partial<typeof query>) => {
    const next = { ...query, ...changes };
    const values = new URLSearchParams({ search: next.search, status: next.status, page: String(next.page), pageSize: String(next.pageSize) });
    navigate(`/agent/agents?${values}`, true);
  };
  useEffect(() => setSearch(query.search), [query.search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData([]);
    void api.agentSubagents(query, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.pagination.totalPages && query.page > result.pagination.totalPages) { changeQuery({ page: result.pagination.totalPages }); return; }
      setData(result.data); setTotalItems(result.pagination.totalItems); setTotalPages(result.pagination.totalPages);
    }).catch(cause => { if (!controller.signal.aborted) setError(agentError(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query.search, query.status, query.page, query.pageSize, revision, refresh]);
  return <section className="agent-panel subagents-page" aria-busy={loading}>
    <div className="agent-panel-heading"><div><p className="subagent-kicker">直属代理</p><h2>下级代理</h2><p>管理直属二级代理的资料、状态与号码往来。</p></div><Button className="subagent-primary" onClick={() => setCreateOpen(true)}><Plus />新增下级代理</Button></div>
    <form className="subagent-filters" onSubmit={event => { event.preventDefault(); changeQuery({ search: search.trim(), page: 1 }); }}>
      <label className="subagent-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索名称或代理编号" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} placeholder="搜索名称 / 代理编号" /></label>
      <select aria-label="筛选代理状态" value={query.status} onChange={event => changeQuery({ search: search.trim(), status: event.target.value as typeof query.status, page: 1 })}>
        <option value="">全部状态</option><option value="ACTIVE">启用</option><option value="SUSPENDED">暂停</option><option value="TERMINATED">终止</option>
      </select><Button type="submit" variant="outline">搜索</Button>
      {(query.search || query.status) && <Button type="button" variant="ghost" onClick={() => { setSearch(''); changeQuery({ search: '', status: '', page: 1 }); }}>清除筛选</Button>}
    </form>
    {notice && <AgentFeedback>{notice}</AgentFeedback>}
    {error ? <AgentFeedback error>{error}<button className="agent-link" onClick={() => setRefresh(value => value + 1)}>重试</button></AgentFeedback> : loading ? <div className="subagent-state" role="status">正在加载下级代理…</div> : data.length ? <Table className="agent-table subagent-table">
      <TableHeader><TableRow>{['代理名称', '代理编号', '状态', '创建时间', '操作'].map(column => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{data.map(agent => <TableRow key={agent.id}><TableCell><span className="subagent-name"><span className="subagent-avatar" aria-hidden="true">{agent.name.slice(0, 1)}</span><strong>{agent.name}</strong></span></TableCell>
        <TableCell><div className="subagent-id"><code title={agent.id}>{agent.id}</code><Button variant="ghost" size="icon-xs" aria-label={`复制 ${agent.name} 的代理编号`} onClick={() => { void navigator.clipboard.writeText(agent.id).then(() => setNotice('代理编号已复制')).catch(() => setNotice('复制失败，请选中编号手动复制')); }}><Copy /></Button></div></TableCell>
        <TableCell><AgentStatus status={agent.status} /></TableCell><TableCell className="subagent-date">{formatAgentDate(agent.createdAt)}</TableCell>
        <TableCell><div className="subagent-row-actions"><Button variant="ghost" size="sm" asChild><a href={subagentHref(agent.id, window.location.search)}>查看<ArrowUpRight /></a></Button><SubagentActions agent={agent} onChanged={() => { setNotice('代理资料已更新'); setRefresh(value => value + 1); }} /></div></TableCell>
      </TableRow>)}</TableBody>
    </Table> : <div className="subagent-state"><Users size={28} aria-hidden="true" /><h3>{query.search || query.status ? '没有匹配的下级代理' : '还没有下级代理'}</h3><p>{query.search || query.status ? '调整名称、编号或状态后重新搜索。' : '绑定已有普通账号，创建你的第一个直属二级代理。'}</p>{!query.search && !query.status && <Button variant="outline" onClick={() => setCreateOpen(true)}>新增下级代理</Button>}</div>}
    {!error && <AgentPager page={query.page} pageSize={query.pageSize} totalItems={totalItems} totalPages={totalPages} busy={loading} onChange={(page, pageSize) => changeQuery({ page, pageSize })} />}
    <CreateSubagentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={agent => navigate(subagentHref(agent.id, window.location.search))} />
  </section>;
}

function CreateSubagentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (agent: Subagent) => void }) {
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const submit = async () => {
    if (inFlight.current) return;
    const payload = { userId: userId.trim(), name: name.trim() };
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await api.agentCreateSubagent({ ...payload, idempotencyKey: request.current.key });
      onOpenChange(false); setUserId(''); setName(''); request.current = null; onCreated(result.data);
    } catch (cause) { setError(agentError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!busy) { onOpenChange(value); setError(''); } }}><DialogContent className="subagent-dialog" showCloseButton={!busy} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>新增下级代理</DialogTitle><DialogDescription>绑定已注册且正常启用的普通账号。请对方在普通工作台「账户设置 → 账户资料 → 用户 ID」复制完整 ID。该账号不能已有代理或客户身份；创建后将成为你的直属二级代理。</DialogDescription></DialogHeader>
    <form className="subagent-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>已有用户 ID<input required autoFocus value={userId} disabled={busy} onChange={event => setUserId(event.target.value)} placeholder="填写目标账号的用户 UUID" /></label>
      <label>代理名称<input required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：华东代理" /></label>
      {error && <div className="subagent-inline-error" role="alert">{error}</div>}
      <div className="subagent-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" className="subagent-primary" disabled={busy || !userId.trim() || !name.trim()}>{busy ? '正在创建…' : '创建代理'}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
