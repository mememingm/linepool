import { useRef, useState } from 'react';
import type { Agent, HoldingBatchPreview, HoldingBatchResult, HoldingBatchSelection } from '@linepool/contracts';
import { createLinepoolApi } from '../api/client';
import { agentError } from '../agent/subagent-shared';
import AppCombobox from '../AppCombobox';
import { Input } from '../ui/input';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { ActionButton, DateText, Facts, Modal, regionName } from './primitives';

const api = createLinepoolApi();

export default function AdminHoldingBatchModal({ selection, sourceAgentId, agents, onClose, onComplete }: {
  selection: HoldingBatchSelection;
  sourceAgentId: string;
  agents: Agent[];
  onClose: () => void;
  onComplete: (result: HoldingBatchResult) => void;
}) {
  const p = useDisplayPreferences();
  const [targetId, setTargetId] = useState('');
  const [expiry, setExpiry] = useState('');
  const [preview, setPreview] = useState<HoldingBatchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const requestKey = useRef<{ payload: string; key: string } | null>(null);
  const choices = agents.filter(agent => agent.status === 'ACTIVE' && agent.parentAgentId === sourceAgentId);
  const sourceName = agents.find(agent => agent.id === sourceAgentId)?.name ?? sourceAgentId;
  const targetName = choices.find(agent => agent.id === targetId)?.name ?? '';
  const valid = choices.some(agent => agent.id === targetId) && (!expiry || (Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now()));
  const money = (amount: number) => `$${(amount / 100).toFixed(2)}`;

  async function submit() {
    if (!valid || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const input = { selection, recipient: { ownerType: 'AGENT' as const, agentId: targetId }, expiresAt: expiry ? new Date(expiry).toISOString() : null };
      if (!preview) {
        setPreview((await api.agentHoldingBatchPreview(input)).data);
      } else {
        const payload = { ...input, fingerprint: preview.fingerprint };
        const serialized = JSON.stringify(payload);
        if (requestKey.current?.payload !== serialized) requestKey.current = { payload: serialized, key: crypto.randomUUID() };
        const response = await api.agentTransferHoldingBatch({ ...payload, idempotencyKey: requestKey.current.key });
        onComplete(response.data);
      }
    } catch (cause) {
      setError(agentError(cause));
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  return <Modal title={p.t('批量转给其他代理')} onClose={onClose} busy={busy}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="lp-admin-dialog-body">
        {preview ? <>
          <Facts rows={[
            [p.t('转交数量'), `${preview.count.toLocaleString()} ${p.t('个号码')}`],
            [p.t('持有代理'), sourceName],
            [p.t('目标代理'), targetName],
            [p.t('选择范围'), selection.mode === 'FILTER' ? p.t('当前筛选结果中全部可转交号码（跨页）') : p.t('已勾选的号码（跨页）')],
            [p.t('国家'), preview.regions.map(item => `${regionName(item.value)} × ${item.count.toLocaleString()}`).join('、')],
            [p.t('平台'), preview.services.map(item => `${item.value} × ${item.count.toLocaleString()}`).join('、')],
            [p.t('到期方式'), expiry ? <DateText value={new Date(expiry).toISOString()} /> : p.t('各号码保留原到期时间，不超过资源到期时间')],
            [p.t('最早到期'), <DateText value={preview.earliestExpiresAt} />],
            [p.t('结算金额'), money(preview.settlement.amountMinor)],
            [p.t('目标代理余额'), money(preview.settlement.buyerBalanceMinor)],
          ]} />
          <p className="lp-admin-context">{p.t('号码示例')}：{preview.sample.join('、')}{preview.count > preview.sample.length ? '…' : ''}</p>
          {!preview.settlement.sufficient && <p role="alert" className="lp-admin-error">{p.t('目标代理余额不足，请先充值或调整价格后重新核对。')}</p>}
          <p className="lp-admin-context">{p.t('确认后整批转交并按现有价格规则结算。若号码归属、状态或价格发生变化，整批取消，需要重新核对。')}</p>
        </> : <fieldset disabled={busy} className="lp-admin-form-grid">
          <p className="lp-admin-context">{selection.mode === 'FILTER' ? p.t('已选择该持有代理在当前筛选结果中全部可转交号码，包含其他页。') : `${p.t('已勾选')} ${selection.holdingIds.length.toLocaleString()} ${p.t('个号码（可跨页）')}`} {p.t('每批最多 10,000 个号码。')}</p>
          <label>{p.t('持有代理')}<Input readOnly value={sourceName} /></label>
          <label>{p.t('目标代理')}<AppCombobox aria-label={p.t('批量转交目标代理')} value={targetId} onValueChange={setTargetId}
            options={choices.map(agent => ({ value: agent.id, label: agent.name }))} placeholder={p.t('请选择目标代理')}
            searchPlaceholder={p.t('搜索代理')} emptyMessage={p.t('没有可接收的直属下级代理')} /></label>
          <label>{p.t('统一到期时间（可选）')}<Input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
          <p className="lp-admin-context">{p.t('留空时分别沿用原到期时间；填写后不能超过任一号码或资源的到期时间。长期号码需填写到期时间。')}</p>
          {!choices.length && <p role="alert" className="lp-admin-error">{p.t('当前持有代理没有启用的直属下级，暂时无法转交。')}</p>}
        </fieldset>}
        {error && <p role="alert" className="lp-admin-error">{error}</p>}
      </div>
      <footer>
        <ActionButton onClick={onClose} disabled={busy}>{p.t('取消')}</ActionButton>
        {preview && <ActionButton disabled={busy} onClick={() => { setPreview(null); setError(''); }}>{p.t('返回修改')}</ActionButton>}
        <ActionButton type="submit" variant="accent" busy={busy} disabled={!valid || (preview !== null && !preview.settlement.sufficient)}>
          {preview ? `${p.t('确认转交')} ${preview.count.toLocaleString()} ${p.t('个号码')}` : p.t('核对数量与结算')}
        </ActionButton>
      </footer>
    </form>
  </Modal>;
}
