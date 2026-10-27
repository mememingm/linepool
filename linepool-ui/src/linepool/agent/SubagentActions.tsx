import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, ArrowRightLeft, Pause, Play } from 'lucide-react';
import { createLinepoolApi } from '../api/client';
import type { Subagent, TransferableHolding } from '../api/contracts';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { agentError, formatAgentDate } from './subagent-shared';
import { HoldingDurationField, useHoldingDuration, type HoldingWindow } from './HoldingDurationField';

const api = createLinepoolApi();
export function SubagentActions({ agent, onChanged, detail = false }: { agent: Subagent; onChanged: () => void; detail?: boolean }) {
  const [action, setAction] = useState<'rename' | 'status' | 'transfer' | null>(null);
  const [name, setName] = useState(agent.name);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const open = (next: typeof action) => { setError(''); setName(agent.name); setReason(''); setAction(next); };
  const suspended = agent.status === 'SUSPENDED';
  const title = action === 'rename' ? '编辑代理名称' : action === 'transfer' ? '转交号码' : suspended ? '恢复下级代理' : '暂停下级代理';
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (action === 'rename') await api.agentRenameSubagent(agent.id, { name: name.trim() });
      else await api.agentSubagentStatus(agent.id, { status: suspended ? 'ACTIVE' : 'SUSPENDED', reason: reason.trim() });
      setAction(null); onChanged();
    } catch (cause) { setError(agentError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <>
    {detail ? <div className="subagent-detail-actions">
      <Button variant="outline" onClick={() => open('rename')}><Pencil />编辑名称</Button>
      {agent.status !== 'TERMINATED' && <Button variant="outline" onClick={() => open('status')}>{suspended ? <Play /> : <Pause />}{suspended ? '恢复代理' : '暂停代理'}</Button>}
      {agent.status === 'ACTIVE' && <Button className="subagent-primary" onClick={() => open('transfer')}><ArrowRightLeft />转交号码</Button>}
    </div> : <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`管理 ${agent.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => open('rename')}>编辑名称</DropdownMenuItem>
        {agent.status !== 'TERMINATED' && <DropdownMenuItem onSelect={() => open('status')}>{suspended ? '恢复代理' : '暂停代理'}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>}
    <Dialog open={action !== null} onOpenChange={value => { if (!value && !busy) setAction(null); }}>
      <DialogContent className="subagent-dialog" showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>
          {action === 'rename' ? '仅修改展示名称，账号绑定与层级归属保持不变。' : action === 'transfer' ? `从自己的可转交库存选择号码，接收方固定为 ${agent.name}。` : suspended ? '恢复代理工作台访问。用户账号自身被禁用时仍无法登录。' : '暂停将撤销该代理的登录会话并阻止后续登录。号码、余额和历史记录继续保留。'}
        </DialogDescription></DialogHeader>
        {action === 'transfer' ? <HoldingTransferForm agent={agent} onBusy={setBusy} onDone={() => { setAction(null); onChanged(); }} onCancel={() => setAction(null)} /> :
          <form className="subagent-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
            <p className="subagent-target">{agent.name}<code>{agent.id}</code></p>
            {action === 'rename' ? <label>代理名称<input required maxLength={120} autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label> :
              <label>操作原因<textarea required minLength={3} maxLength={500} autoFocus value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="请填写原因，将记录到操作审计" /></label>}
            {error && <div className="subagent-inline-error" role="alert">{error}</div>}
            <div className="subagent-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>取消</Button>
              <Button type="submit" className="subagent-primary" disabled={busy || (action === 'rename' ? !name.trim() : reason.trim().length < 3)}>{busy ? '正在提交…' : '确认' + (action === 'rename' ? '保存' : suspended ? '恢复' : '暂停')}</Button></div>
          </form>}
      </DialogContent>
    </Dialog>
  </>;
}

function HoldingTransferForm({ agent, onBusy, onDone, onCancel }: { agent: Subagent; onBusy: (busy: boolean) => void; onDone: () => void; onCancel: () => void }) {
  const [holdings, setHoldings] = useState<TransferableHolding[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [confirmed, setConfirmed] = useState<HoldingWindow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setHoldings([]); setSelectedId(''); setConfirmed(null);
    const timer = window.setTimeout(() => {
      void api.agentTransferableHoldings({ search }, { signal: controller.signal }).then(result => setHoldings(result.data))
        .catch(cause => { if (!controller.signal.aborted) setError(agentError(cause)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, revision]);
  const selected = holdings.find(holding => holding.id === selectedId);
  const duration = useHoldingDuration(selected);
  const valid = !!selected && (confirmed ? Date.parse(confirmed.expiresAt) > Date.now() : duration.window.valid);
  const submit = async () => {
    if (!selected || !valid || inFlight.current) return;
    if (!confirmed) { const window = duration.resolveWindow(); if (window.valid) setConfirmed(window); return; }
    const payload = { holdingId: selected.id, toAgentId: agent.id, startsAt: confirmed.startsAt, expiresAt: confirmed.expiresAt };
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); onBusy(true); setError('');
    try { await api.agentResellHolding({ ...payload, idempotencyKey: request.current.key }); onDone(); }
    catch (cause) { setError(agentError(cause)); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  };
  return <form className="subagent-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {confirmed ? <div className="subagent-transfer-confirm"><strong>核对转交信息</strong><dl><dt>号码</dt><dd>{selected?.phoneNumber}</dd><dt>接收代理</dt><dd>{agent.name}</dd><dt>开始时间</dt><dd>确认后立即生效</dd><dt>到期时间</dt><dd>{formatAgentDate(confirmed.expiresAt)}</dd></dl><p>完成后号码将退出你的可售库存。本次转交金额为 0，不产生扣款或结算。</p></div> : <>
      <label>搜索自己的号码<input value={search} maxLength={64} onChange={event => setSearch(event.target.value)} placeholder="输入号码进行搜索" /></label>
      {loading ? <p role="status">正在加载可转交号码…</p> : holdings.length ? <label>可转交号码<select required value={selectedId} onChange={event => {
        setSelectedId(event.target.value); setConfirmed(null);
      }}><option value="">请选择号码</option>{holdings.map(item => <option key={item.id} value={item.id}>{item.phoneNumber} · {item.service}</option>)}</select></label> : <p className="agent-muted">{search ? '没有匹配的可转交号码。' : '当前没有可转交号码。'}</p>}
      {selected && <HoldingDurationField holding={selected} state={duration} hintClassName="agent-muted" />}
      <p className="agent-muted">列表最多显示 200 个号码，可输入号码缩小范围。</p>
    </>}
    {error && <div className="subagent-inline-error" role="alert">{error}{!confirmed && <button type="button" className="agent-link" onClick={() => setRevision(value => value + 1)}>刷新列表</button>}</div>}
    <div className="subagent-form-actions">{confirmed && <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmed(null)}>返回修改</Button>}<Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button type="submit" className="subagent-primary" disabled={busy || loading || !valid}>{busy ? '正在转交…' : confirmed ? '确认转交' : '核对转交信息'}</Button></div>
  </form>;
}
