import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { ActionButton, DateText, Modal, State } from './primitives';
import { agentError } from '../agent/subagent-shared';
import { SettlementPreview, useSettlementQuote } from '../agent/SettlementPreview';
import { localDateTime } from '../agent/pages/shared';
import AppCombobox from '../AppCombobox';

type Completion = { onClose: () => void; onSuccess: () => void };
export function StockClaimModal({ stock, ...completion }: Completion & { stock: { id: string; phoneNumber: string; resourceExpiresAt: string | null } }) {
  return <AllocationModal {...completion} stockIds={[stock.id]} targetLabel={stock.phoneNumber} resourceExpiry={stock.resourceExpiresAt} />;
}
export function BatchStockClaimModal({ stockIds, ...completion }: Completion & { stockIds: string[] }) {
  return <AllocationModal {...completion} stockIds={stockIds} targetLabel={`已选择 ${stockIds.length} 个号码`} />;
}
export function ResellHoldingModal({ holding, ...completion }: Completion & { holding: { id: string; agentId: string | null; phoneNumber: string; startsAt: string; expiresAt: string | null } }) {
  return <AllocationModal {...completion} holding={holding} targetLabel={holding.phoneNumber} resourceExpiry={holding.expiresAt} />;
}
function AllocationModal({ stockIds, holding, targetLabel, resourceExpiry, onClose, onSuccess }: Completion & {
  stockIds?: string[]; holding?: { id: string; agentId: string | null; startsAt: string }; targetLabel: string; resourceExpiry?: string | null;
}) {
  const agents = useQuery({ queryKey: ['admin-settlement-agents'], queryFn: async ({ signal }) => (await api.agentAgents({ signal })).data }, queryClient);
  const [agentId, setAgentId] = useState('');
  const [startsAt, setStartsAt] = useState(() => localDateTime(new Date(Math.max(Date.now(), Date.parse(holding?.startsAt ?? '') || 0)).toISOString()));
  const [expiresAt, setExpiresAt] = useState(() => localDateTime(resourceExpiry ?? new Date(Date.now() + 30 * 86400000).toISOString()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const validWindow = Number.isFinite(Date.parse(startsAt)) && Date.parse(expiresAt) > Math.max(Date.parse(startsAt), Date.now());
  const window = validWindow ? { startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() } : null;
  const quote = useSettlementQuote(agentId && window ? { operation: holding ? 'RESELL' : 'CLAIM', holdingId: holding?.id, stockIds, agentId, ...window } : null);
  const valid = !!quote.data?.sufficient && !quote.isFetching && !quote.error && !agents.error && !!window;
  async function submit() {
    if (!valid || !window || !quote.data || inFlight.current) return;
    const payload = { agentId, ...window, quoteFingerprint: quote.data.fingerprint };
    const signature = JSON.stringify({ ...payload, stockIds, holdingId: holding?.id });
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (holding) await api.agentResellHolding({ holdingId: holding.id, toAgentId: agentId, ...window, quoteFingerprint: quote.data.fingerprint, idempotencyKey: request.current.key });
      else await api.agentClaimStockBatch({ ...payload, stockIds: stockIds!, idempotencyKey: request.current.key });
      onSuccess();
    } catch (cause) { setError(agentError(cause)); } finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal title={holding ? '转交号码并结算' : '分配号码给一级代理'} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="lp-admin-dialog-body">
    <p className="lp-admin-confirm-target">{targetLabel}</p>
    <State loading={agents.isFetching} error={agents.error ? agentError(agents.error) : ''} retry={() => void agents.refetch()} />
    <fieldset disabled={busy}><label>目标代理<AppCombobox aria-label="目标代理" value={agentId} onValueChange={setAgentId} placeholder="请选择代理" options={(agents.data ?? []).filter(agent => agent.status === 'ACTIVE' && (holding ? agent.parentAgentId === holding.agentId : agent.level === 1)).map(agent => ({ value: agent.id, label: agent.name }))} /></label>
      <label>开始时间<input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
      <label>到期时间<input type="datetime-local" required value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>
    </fieldset>
    <SettlementPreview quote={quote.data} loading={quote.isFetching} error={quote.error} seller={!!holding} />
    {resourceExpiry && <p className="lp-admin-context">号码有效至 <DateText value={resourceExpiry} /></p>}
    <p className="lp-admin-context">确认后按上述金额结算。余额不足时整批取消。释放号码不退还已付货款。</p>
    {error && <p className="lp-admin-error" role="alert">{error}</p>}
  </div><footer><ActionButton onClick={onClose} disabled={busy}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!valid}>确认{holding ? '转交并结算' : '分配并扣款'}</ActionButton></footer></form></Modal>;
}
