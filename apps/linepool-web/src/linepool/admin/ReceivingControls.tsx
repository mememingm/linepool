import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import { type PlatformCodeRule, type ReceivingReviewView } from '../api/contracts';
import { useAdminPlatforms } from './PlatformsPage';
import { LinepoolApiError } from '../api/client';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { apiFailureMessage } from '../i18n/api-errors';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import SelectField from '../SelectField';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { ActionButton, Badge, DateText, Facts, Modal, State } from './primitives';

function failureMessage(cause: unknown) {
  if (cause instanceof LinepoolApiError) return apiFailureMessage(cause.code, cause.status);
  return cause instanceof z.ZodError ? '请检查发送者、完整短信模板、验证码长度和操作原因。' : '操作失败，请重试。';
}

function CodeRuleForm({ platformId, initial, onSaved }: { platformId: string; initial: PlatformCodeRule | null; onSaved: () => Promise<unknown> }) {
  const p = useDisplayPreferences();
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [senders, setSenders] = useState(initial?.rule.senderAllowlist.join('\n') ?? '');
  const [keywords, setKeywords] = useState(initial?.rule.bodyKeywords?.join('\n') ?? '');
  const [prefix, setPrefix] = useState(initial?.rule.bodyPrefix ?? '');
  const [suffix, setSuffix] = useState(initial?.rule.bodySuffix ?? '');
  const [length, setLength] = useState(initial?.rule.codeLength ?? 6);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api.adminSavePlatformCodeRule(platformId, {
        enabled, rule: { senderAllowlist: senders.split(/\r?\n/).map(value => value.trim()).filter(Boolean), bodyKeywords: keywords.split(/\r?\n/).map(value => value.trim()).filter(Boolean), bodyPrefix: prefix, bodySuffix: suffix, codeLength: length }, reason,
      });
      await onSaved();
      toast.success(p.t('平台验证码规则已保存。'));
    } catch (cause) { setError(p.t(failureMessage(cause))); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset className="lp-admin-form-grid" disabled={busy}>
      <p className="lp-admin-context lp-admin-span">{p.t('先确认短信属于所购平台，再按精确发送者和完整文本模板识别首码。未启用规则的一次性商品不能购买。')}</p>
      <label className="lp-admin-span">{p.t('允许的发送者（每行一个）')}<Textarea required rows={3} maxLength={4200} value={senders} onChange={event => setSenders(event.target.value)} /></label>
      <label className="lp-admin-span">{p.t('正文关键词（每行一个，可留空）')}<Textarea rows={3} maxLength={1200} value={keywords} onChange={event => setKeywords(event.target.value)} /><small>{p.t('托管接码按发送者或正文关键词识别平台；一次性接码仍要求精确发送者和完整模板。')}</small></label>
      <label className="lp-admin-span">{p.t('验证码前文本（保留空格）')}<Textarea rows={2} maxLength={4000} value={prefix} onChange={event => setPrefix(event.target.value)} /></label>
      <label className="lp-admin-span">{p.t('验证码后文本（保留空格）')}<Textarea rows={2} maxLength={4000} value={suffix} onChange={event => setSuffix(event.target.value)} /></label>
      <label>{p.t('验证码位数')}<Input type="number" required min={4} max={8} step={1} value={length} onChange={event => setLength(Number(event.target.value))} /></label>
      <p className="lp-admin-context lp-admin-span">{p.t('整条短信须等于前文本＋指定位数数字＋后文本。发送者忽略大小写；模板中的空格会保留。')}</p>
      <label className="lp-admin-checkbox lp-admin-span"><Checkbox checked={enabled} onCheckedChange={value => setEnabled(value === true)} />{p.t('启用此平台的首码识别规则')}</label>
      <label className="lp-admin-span">{p.t('操作原因')}<Textarea required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {error && <p className="lp-admin-error lp-admin-span" role="alert">{error}</p>}
      <div className="lp-admin-actions lp-admin-span"><ActionButton type="submit" variant="accent" busy={busy}>{p.t('保存验证码规则')}</ActionButton></div>
    </fieldset>
  </form>;
}

export function PlatformRuleSettings() {
  const p = useDisplayPreferences();
  const platforms = useAdminPlatforms();
  const [chosen, setPlatformId] = useState('');
  const platformId = chosen || platforms.data?.[0]?.id || '';
  const rule = useQuery({ queryKey: ['admin-platform-code-rule', platformId], queryFn: ({ signal }) => api.adminPlatformCodeRule(platformId, { signal }), staleTime: 0, enabled: Boolean(platformId) }, queryClient);
  return <details className="lp-admin-tech"><summary>{p.t('平台验证码识别规则')}</summary>
    <label>{p.t('平台')}<SelectField aria-label={p.t('选择验证码规则平台')} value={platformId} onValueChange={setPlatformId} options={(platforms.data ?? []).map(platform => ({ value: platform.id, label: platform.name }))} /></label>
    {!platformId && !platforms.isPending && <p className="lp-admin-context">{p.t('请先在平台管理中新增平台。')}</p>}
    {platformId && <State loading={rule.isPending} error={rule.error ? p.t(failureMessage(rule.error)) : ''} retry={() => void rule.refetch()} />}
    {rule.data && <CodeRuleForm key={`${platformId}:${rule.data.data?.version ?? 0}`} platformId={platformId} initial={rule.data.data} onSaved={() => rule.refetch()} />}
  </details>;
}

function ReviewForm({ view, onReviewed, busy, setBusy }: { view: ReceivingReviewView; onReviewed: () => void; busy: boolean; setBusy: (value: boolean) => void }) {
  const p = useDisplayPreferences();
  const [reference, setReference] = useState('');
  const [reviewedAt, setReviewedAt] = useState('');
  const [reason, setReason] = useState('');
  const [complete, setComplete] = useState(false);
  const [noCode, setNoCode] = useState(false);
  const [error, setError] = useState('');
  const scope = view.scope;
  const canConfirm = view.receivingStatus === 'WAITING' && !view.blockers.length && Date.parse(scope.windowEnd) <= Date.now();
  async function confirm() {
    if (busy || !canConfirm || !complete || !noCode || !reviewedAt) return;
    setBusy(true); setError('');
    try {
      await api.adminConfirmReceivingReview(scope.allocationId, {
        localEvidenceDigest: view.localEvidenceDigest,
        source: scope.provider === 'pingcode' ? 'EXTERNAL_PC_REVIEW' : 'MOCK_SOURCE_REVIEW', sourceReference: reference,
        reviewedAt: new Date(reviewedAt).toISOString(), scope, completeWindowReviewed: true, noValidCodeConfirmed: true, reason,
      });
      toast.success(p.t('窗口核对结果已保存。'));
      onReviewed();
    } catch (cause) { setError(p.t(failureMessage(cause))); }
    finally { setBusy(false); }
  }
  return <><Facts rows={[
    [p.t('号码'), scope.phoneNumber], [p.t('平台'), scope.platformId], [p.t('来源'), scope.provider === 'pingcode' ? 'PC' : p.t('模拟来源')],
    [p.t('连接 ID'), scope.connectionId], [p.t('上游号码 ID'), scope.externalNumberId], [p.t('PC 项目 ID'), scope.externalProjectId],
    [p.t('订单编号'), scope.orderId], [p.t('窗口开始'), <DateText value={scope.windowStart} />], [p.t('窗口截止'), <DateText value={scope.windowEnd} />],
    [p.t('接码结果'), <Badge value={view.receivingStatus === 'WAITING' && Date.parse(scope.windowEnd) <= Date.now() ? 'RECEIVING_REVIEWING' : `RECEIVING_${view.receivingStatus}`} />], [p.t('首码记录'), view.firstMessageId ?? '—'],
  ]} />
    <p className="lp-admin-context">{p.t('此处只展示本地候选记录。必须另行核对来源中的完整接收时间窗口；本地无记录不能证明上游没有验证码。')}</p>
    <details className="lp-admin-tech"><summary>{p.t('本地候选与归属证据')}</summary><pre className="lp-admin-json">{JSON.stringify({ events: view.localEvents, receipts: view.localReceipts, conflicts: view.localConflicts }, null, 2)}</pre></details>
    {view.blockers.length > 0 && <div role="alert" className="lp-admin-warning"><p>{p.t('请先处理以下未决记录，再重新读取窗口证据。')}</p><ul>{view.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
    {view.receivingStatus === 'WAITING' && <form onSubmit={event => { event.preventDefault(); void confirm(); }}>
      <fieldset className="lp-admin-form-grid" disabled={busy || !canConfirm}>
        <label className="lp-admin-span">{p.t('来源核对引用')}<Textarea required minLength={3} maxLength={1000} value={reference} onChange={event => setReference(event.target.value)} /></label>
        <label>{p.t('实际核对时间')}<Input required type="datetime-local" value={reviewedAt} onChange={event => setReviewedAt(event.target.value)} /></label>
        <label className="lp-admin-span">{p.t('操作原因')}<Textarea required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label className="lp-admin-checkbox lp-admin-span"><Checkbox checked={complete} onCheckedChange={value => setComplete(value === true)} />{p.t('我已核对上述连接、号码和平台的完整接收时间窗口。')}</label>
        <label className="lp-admin-checkbox lp-admin-span"><Checkbox checked={noCode} onCheckedChange={value => setNoCode(value === true)} />{p.t('完整窗口内确认没有符合本订单规则的有效验证码。')}</label>
        <p className="lp-admin-warning lp-admin-span">{p.t('确认后将判定失败、全额释放冻结积分并恢复该组合销售资格。不能确认完整时应继续等待。')}</p>
        {error && <p className="lp-admin-error lp-admin-span" role="alert">{error}</p>}
        <div className="lp-admin-actions lp-admin-span"><ActionButton type="submit" variant="accent" busy={busy} disabled={!complete || !noCode || !reference.trim() || !reason.trim() || !reviewedAt}>{p.t('确认完整核对无有效码')}</ActionButton></div>
      </fieldset>
      {!canConfirm && !view.blockers.length && <p className="lp-admin-context">{p.t('原15分钟窗口尚未结束，暂不能确认失败。')}</p>}
    </form>}
  </>;
}

export function ReceivingReviewModal({ allocationId, onClose, onReviewed }: { allocationId: string; onClose: () => void; onReviewed: () => void }) {
  const p = useDisplayPreferences();
  const [busy, setBusy] = useState(false);
  const view = useQuery({ queryKey: ['admin-receiving-review', allocationId], queryFn: ({ signal }) => api.adminReceivingReview(allocationId, { signal }), staleTime: 0, refetchOnWindowFocus: !busy }, queryClient);
  return <Modal title={p.t('一次性接码窗口核对')} variant="drawer" busy={busy} onClose={onClose}><div className="lp-admin-dialog-body">
    <State loading={view.isFetching} error={view.error ? p.t(failureMessage(view.error)) : ''} retry={() => void view.refetch()} />
    {view.data && !view.error && !view.isFetching && <ReviewForm key={view.data.data.localEvidenceDigest} view={view.data.data} onReviewed={onReviewed} busy={busy} setBusy={setBusy} />}
    <ActionButton onClick={() => void view.refetch()} disabled={busy || view.isFetching}>{p.t('重新读取窗口证据')}</ActionButton>
  </div></Modal>;
}
