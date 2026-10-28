import { useRef, useState } from 'react';
import { MoreHorizontal, Pencil, ArrowRightLeft, Pause, Play } from 'lucide-react';
import { createLinepoolApi } from '../api/client';
import type { Subagent } from '../api/contracts';
import { Button } from '../ui/button';
import { Modal } from '../admin/primitives';
import HoldingDistributionForm from './pages/HoldingDistributionForm';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { agentError } from './subagent-shared';

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
    {action === 'transfer' && agent.parentAgentId && <HoldingDistributionForm agentId={agent.parentAgentId} recipient={agent} onClose={() => setAction(null)} onComplete={onChanged} />}
    {action && action !== 'transfer' && <Modal title={title} onClose={() => setAction(null)} busy={busy}>
      <p className="lp-admin-context">{action === 'rename' ? '仅修改展示名称，账号绑定与层级归属保持不变。' : suspended ? '恢复代理工作台访问。用户账号自身被禁用时仍无法登录。' : '暂停将撤销该代理的登录会话并阻止后续登录。号码、余额和历史记录继续保留。'}</p>
      <form className="subagent-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p className="subagent-target">{agent.name}<code>{agent.id}</code></p>
        {action === 'rename' ? <label>代理名称<input required maxLength={120} autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label> : <label>操作原因<textarea required minLength={3} maxLength={500} autoFocus value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="请填写原因，将记录到操作审计" /></label>}
        {error && <div className="subagent-inline-error" role="alert">{error}</div>}
        <div className="subagent-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>取消</Button><Button type="submit" className="subagent-primary" disabled={busy || (action === 'rename' ? !name.trim() : reason.trim().length < 3)}>{busy ? '正在提交…' : '确认' + (action === 'rename' ? '保存' : suspended ? '恢复' : '暂停')}</Button></div>
      </form>
    </Modal>}
  </>;
}
