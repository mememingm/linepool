import { useRef, useState } from 'react';
import type { HoldingBatchPreview, HoldingBatchResult, HoldingBatchSelection, OwnerRef } from '@linepool/contracts';
import { workspaceApi as api } from '../../api/query-client';
import { DateText, Facts, Modal, regionName } from '../../admin/primitives';
import AppCombobox from '../../AppCombobox';
import { agentError } from '../subagent-shared';
import type { AgentPageProps } from '../pages';
import { ErrorText, FormFooter, useAgentAction, useChildren, useCustomers } from './shared';

export default function HoldingBatchForm({ access, selection, onClose, onComplete }: {
  access: AgentPageProps['access']; selection: HoldingBatchSelection; onClose: () => void;
  onComplete: (result: HoldingBatchResult) => void;
}) {
  const agentId = access.context.agent.id;
  const canTransfer = access.context.capabilities.transferHoldings;
  const children = useChildren(agentId, canTransfer);
  const customers = useCustomers(agentId);
  const [kind, setKind] = useState<'AGENT' | 'CUSTOMER'>(canTransfer ? 'AGENT' : 'CUSTOMER');
  const [target, setTarget] = useState('');
  const [expiry, setExpiry] = useState('');
  const [preview, setPreview] = useState<HoldingBatchPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState('');
  const previewInFlight = useRef(false);
  const action = useAgentAction(agentId);
  const busy = action.busy || previewBusy;
  const choices = (kind === 'AGENT' ? children.data : customers.data)?.filter(item => item.status === 'ACTIVE') ?? [];
  const targetName = choices.find(item => item.id === target)?.name ?? target;
  const recipient: OwnerRef = kind === 'AGENT' ? { ownerType: 'AGENT', agentId: target } : { ownerType: 'CUSTOMER', customerId: target };
  const valid = !!target && (!expiry || (Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now()));
  return <Modal title="批量划转号码" onClose={onClose} busy={busy}><form className="lp-agent-form" onSubmit={event => {
    event.preventDefault(); if (!valid || busy) return;
    const payload = { selection, recipient, expiresAt: expiry ? new Date(expiry).toISOString() : null };
    if (!preview) {
      if (previewInFlight.current) return;
      previewInFlight.current = true; setPreviewBusy(true); setError('');
      void api.agentHoldingBatchPreview(payload).then(response => setPreview(response.data)).catch(cause => setError(agentError(cause))).finally(() => { previewInFlight.current = false; setPreviewBusy(false); });
      return;
    }
    const request = { ...payload, fingerprint: preview.fingerprint };
    let receipt: HoldingBatchResult | null = null;
    void action.run(async () => { receipt = (await api.agentTransferHoldingBatch({ ...request, idempotencyKey: action.requestKey(request) })).data; },
      () => { if (receipt) onComplete(receipt); }, `已划转 ${preview.count.toLocaleString()} 个号码`);
  }}><div className="lp-admin-dialog-body">
    {preview ? <><Facts rows={[
      ['划转数量', `${preview.count.toLocaleString()} 个号码`], ['接收方', `${kind === 'AGENT' ? '直属下级' : '直属客户'} · ${targetName}`],
      ['选择范围', selection.mode === 'FILTER' ? '当前筛选结果中全部可划转号码（跨页）' : '勾选的号码（跨页）'],
      ['国家', preview.regions.map(item => `${regionName(item.value)} ${item.count.toLocaleString()} 个`).join('、')],
      ['平台', preview.services.map(item => `${item.value} ${item.count.toLocaleString()} 个`).join('、')],
      ['开始方式', '立即开始；尚未生效的号码沿用原开始时间'],
      ['到期方式', expiry ? <DateText value={new Date(expiry).toISOString()} /> : '分别沿用各号码原到期时间（不超过资源到期时间）'],
      ['最早到期', <DateText value={preview.earliestExpiresAt} />], ['结算', '库存划拨（不收款、不扣余额）'],
    ]} /><p className="lp-admin-context">号码示例：{preview.sample.join('、')}{preview.count > preview.sample.length ? '…' : ''}</p>
      <p className="lp-admin-context">确认后将统一划转以上号码。若号码状态或归属发生变化，整批取消，请返回修改并重新核对。提交期间请保持页面打开。</p></> : <fieldset disabled={busy}>
      <p className="lp-admin-context">{selection.mode === 'FILTER' ? '已选择当前筛选结果中全部可划转号码，包含其他页。' : `已勾选 ${selection.holdingIds.length.toLocaleString()} 个号码，可包含不同页。`}单次最多划转 10,000 个号码。</p>
      <label>划转给<select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setTarget(''); }}>
        {canTransfer && <option value="AGENT">直属下级代理</option>}<option value="CUSTOMER">直属客户</option>
      </select></label>
      <label>接收方<AppCombobox aria-label="批量划转接收方" value={target} onValueChange={setTarget} options={choices.map(item => ({ value: item.id, label: item.name }))} placeholder="请选择接收方" searchPlaceholder="搜索接收方" emptyMessage="没有启用的接收方" /></label>
      <ErrorText error={(kind === 'AGENT' ? children.error : customers.error) ? agentError(kind === 'AGENT' ? children.error : customers.error) : ''} />
      <label>统一到期时间（可选）<input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
      <p className="lp-admin-context">留空时，各号码保留原到期时间；填写后，全部使用该时间，且不能超过任一号码或资源的到期时间。长期号码需填写到期时间。</p>
    </fieldset>}
    <ErrorText error={error || action.error} />
  </div><FormFooter busy={busy} onClose={onClose} onBack={preview ? () => { setPreview(null); setError(''); } : undefined} disabled={!valid} label={preview ? `确认划转 ${preview.count.toLocaleString()} 个号码` : '核对数量与接收方'} /></form></Modal>;
}
