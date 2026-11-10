import { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import type { PcPlan, PcPlanInput } from '../../api/contracts';
import { workspaceApi as api } from '../../api/query-client';
import { Card } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { ActionButton, Modal, Table } from '../../admin/primitives';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { pcCapabilityLabels, pcError } from '../pc-components';
import { PcEmpty, PcFeedback, type PcPageProps } from './shared';

const price = (plan: Pick<PcPlan, 'amountMinor' | 'currency'>) => `${plan.currency} ${(plan.amountMinor / 100).toFixed(2)}`;

function PlanEditor({ plan, onClose, onSaved, allowSmsCode }: { plan: PcPlan | null; onClose: () => void; onSaved: () => void; allowSmsCode: boolean }) {
  const p = useDisplayPreferences();
  const [name, setName] = useState(plan?.name ?? '');
  const [durationDays, setDays] = useState(String(plan?.durationDays ?? 30));
  const [amountMinor, setAmount] = useState(String(plan?.amountMinor ?? 0));
  const [currency, setCurrency] = useState(plan?.currency ?? 'USD');
  const [enabled, setEnabled] = useState(plan?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    const input: PcPlanInput = { name, durationDays: Number(durationDays), amountMinor: Number(amountMinor), currency, capability: plan?.capability ?? 'SMS_CODE', enabled };
    try { await api.pcSavePlan(input, plan?.id); onSaved(); }
    catch (cause) { setError(pcError(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={p.t(plan ? '编辑套餐' : '新增套餐')} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void save(); }}><div className="lp-admin-dialog-body"><fieldset className="lp-admin-form-grid lp-pc-form" disabled={busy}>
    <label className="lp-admin-span">{p.t('套餐名称')}<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>{p.t('使用天数')}<Input type="number" required min={1} max={3650} step={1} value={durationDays} onChange={event => setDays(event.target.value)} /></label>
    <label>{p.t('币种')}<Input required pattern="[A-Z]{3}" maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label>
    <label className="lp-admin-span">{p.t('价格（最小货币单位）')}<Input type="number" required min={0} max={Number.MAX_SAFE_INTEGER} step={1} value={amountMinor} onChange={event => setAmount(event.target.value)} /><small>{p.t('例如 USD 的 100 表示 1 美元。价格仅作为你的套餐配置。')}</small></label>
    <p className="lp-admin-context lp-admin-span">{p.t(pcCapabilityLabels[plan?.capability ?? 'SMS_CODE'])}</p>
    <label className="lp-admin-checkbox lp-admin-span"><Checkbox checked={enabled} onCheckedChange={value => setEnabled(value === true)} />{p.t('启用套餐')}</label>
    {!allowSmsCode && <p className="lp-admin-warning lp-admin-span">{p.t('请先启用连接的短信验证码能力，再启用套餐。')}</p>}
    {error && <p className="lp-admin-error lp-admin-span" role="alert">{error}</p>}
  </fieldset></div><footer><ActionButton onClick={onClose} disabled={busy}>{p.t('取消')}</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={enabled && !allowSmsCode}>{p.t('保存套餐')}</ActionButton></footer></form></Modal>;
}

export default function PricingPage({ session, connection, refetch }: PcPageProps & { refetch: () => Promise<unknown> }) {
  const p = useDisplayPreferences();
  const [editor, setEditor] = useState<PcPlan | null | undefined>();
  const [archive, setArchive] = useState<PcPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const plans = session.plans;
  const enabled = plans.filter(plan => plan.enabled);
  const supported = connection.capabilities.includes('SMS_CODE');
  async function archivePlan() {
    if (!archive || busy) return;
    setBusy(true); setError('');
    try { await api.pcArchivePlan(archive.id); setArchive(null); await refetch(); setNotice(p.t('套餐已停用，历史记录已保留')); }
    catch (cause) { setError(pcError(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <PcFeedback error={archive ? '' : error} notice={notice} />
    <div className="lp-agent-account-summary">
      <div><span>{p.t('已启用套餐')}</span><strong>{p.n(enabled.length)}</strong></div>
      <div><span>{p.t('已停用套餐')}</span><strong>{p.n(plans.length - enabled.length)}</strong></div>
      <div><span>{p.t('最低启用价格')}</span><strong>{enabled.length ? price(enabled.reduce((low, plan) => plan.amountMinor < low.amountMinor ? plan : low)) : '—'}</strong></div>
      <ActionButton variant="accent" disabled={!supported} onClick={() => { setNotice(''); setEditor(null); }}><Plus size={16} />{p.t('新增套餐')}</ActionButton>
    </div>
    <Card className="lp-admin-section lp-agent-page-card"><div className="lp-admin-section-heading"><div><h2>{p.t('我的套餐')}</h2><p className="lp-admin-context">{p.t('为自己的业务配置套餐和价格，收款由你在站外完成。')}</p></div></div>
      {plans.length ? <Table label="PC 套餐配置" columns={[p.t('套餐'), p.t('能力'), p.t('天数'), p.t('价格'), p.t('状态'), '']}>{plans.map(plan => <tr key={plan.id}>
        <td><strong>{plan.name}</strong></td><td>{p.t(pcCapabilityLabels[plan.capability])}</td><td className="lp-admin-numeric">{plan.durationDays}</td><td className="lp-admin-numeric">{price(plan)}</td>
        <td><span className="lp-admin-status lp-pc-status" data-tone={plan.enabled ? 'success' : 'warning'}>{p.t(plan.enabled ? '启用' : '停用')}</span></td>
        <td><div className="lp-agent-row-actions"><ActionButton size="sm" onClick={() => { setNotice(''); setEditor(plan); }}>{p.t('编辑')}</ActionButton>{plan.enabled && <ActionButton size="sm" disabled={busy} onClick={() => { setError(''); setArchive(plan); }}>{p.t('停用')}</ActionButton>}</div></td>
      </tr>)}</Table> : <PcEmpty icon={Settings2} title="还没有套餐" action={supported ? <ActionButton variant="accent" onClick={() => setEditor(null)}><Plus size={16} />{p.t('新增套餐')}</ActionButton> : undefined}>
        {p.t(supported ? '新增第一个套餐，设置使用天数和价格。' : '当前 PC 连接不支持短信验证码。')}
      </PcEmpty>}
    </Card>
    {editor !== undefined && <PlanEditor key={editor?.id ?? 'new'} plan={editor} allowSmsCode={connection.enabledCapabilities.includes('SMS_CODE')} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); void refetch(); setNotice(p.t('套餐已保存')); }} />}
    {archive && <Modal title={p.t('停用套餐')} variant="confirmation" busy={busy} onClose={() => setArchive(null)}><div className="lp-admin-dialog-body"><p>{archive.name}</p><p className="lp-admin-context">{p.t('停用套餐会保留历史配置和账单。')}</p>{error && <p className="lp-admin-error" role="alert">{error}</p>}</div><footer><ActionButton disabled={busy} onClick={() => setArchive(null)}>{p.t('取消')}</ActionButton><ActionButton variant="accent" busy={busy} onClick={() => void archivePlan()}>{p.t('确认停用')}</ActionButton></footer></Modal>}
  </>;
}
