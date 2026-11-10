import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Inbox, Minus, Plus, Search, ShoppingBag } from 'lucide-react';
import { ActionButton } from '../components';
import { CopyValue } from '../business';
import { StatusPill } from '../../vendor/beautiful/src/components/atoms/StatusPill';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Flag } from '../showcase/shared';
import { createOrderInputSchema, storefrontRegionIds, type Catalog, type CreateOrderInput, type OrderDetail } from '../api/contracts';
import { LinepoolApiError } from '../api/client';
import { apiMessage, type WorkspaceActions, type WorkspaceData } from './workspace-data';
import { shellHref, type ShellRoute } from './navigation';
import { ServiceLabel } from './WorkspaceDetails';
import SelectField from '../SelectField';
import AppSearchInput from '../AppSearchInput';
import PlatformSmsNotice from './PlatformSmsNotice';
import { RechargeButton } from '../wallet/Recharge';
import { saleOffers } from './sale-catalog';
import { receivingModeLabel, receivingTerm, ReceivingStatus, ReceivingWindow } from './ReceivingService';
import './PurchasePage.css';

const draftSchema = z.object({
  service: z.string().max(80), region: z.string().max(8), plan: z.string().max(32),
  receivingMode: z.enum(['ONE_TIME', 'HOSTED']).default('ONE_TIME'),
  quantity: z.number().int().min(1).max(10), areaCode: z.string().regex(/^[2-9]\d{2}$/).optional(),
});
type Draft = z.infer<typeof draftSchema> & { step: number };
const steps = ['选择平台', '国家与区号', '服务期限'];
function readStored(key: string): unknown {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function writeStored(key: string, value: unknown) {
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Same-tab state and idempotency still work when storage is unavailable. */ }
}
function restore(catalog: Catalog, route: ShellRoute, userId: string, pending: CreateOrderInput | null): Draft {
  // Restore selections and unresolved order intent, but always enter at the platform step (zero-based).
  if (pending) return { ...pending, step: 0 };
  const saved = draftSchema.safeParse(readStored(`linepool:purchase-draft:${userId}`));
  const candidate = route.service || route.region || route.plan
    ? { service: route.service, region: route.region, plan: route.plan, receivingMode: 'ONE_TIME' as const, quantity: 1 }
    : saved.success ? saved.data : { service: '', region: '', plan: '', receivingMode: 'ONE_TIME' as const, quantity: 1 };
  const service = catalog.services.find(item => item === candidate.service) ?? '';
  const region = service && catalog.regions.some(item => item.id === storefrontRegionIds[0]) ? storefrontRegionIds[0] : '';
  const candidates = saleOffers(catalog).filter(offer => offer.service === service && offer.region === region);
  const selected = candidates.find(offer => offer.plan === candidate.plan)
    ?? candidates.find(offer => offer.receivingMode === candidate.receivingMode && (offer.receivingMode === 'ONE_TIME' || offer.durationDays === 30))
    ?? candidates.find(offer => offer.receivingMode === candidate.receivingMode) ?? candidates[0];
  const receivingMode = selected?.receivingMode ?? candidate.receivingMode;
  const plans = candidates.filter(offer => offer.receivingMode === receivingMode);
  const plan = selected?.plan ?? '';
  // Area-code selection is exclusive to US numbers, independent of storefront availability.
  const areaCode = new Set(plans.flatMap(offer => offer.areaCodes?.filter(area => area.availableCount > 0).map(area => area.code) ?? [])).size > 1
    && 'areaCode' in candidate && typeof candidate.areaCode === 'string' && candidate.region === 'us'
    && plans.some(offer => offer.areaCodes?.some(area => area.code === candidate.areaCode && area.availableCount > 0)) ? candidate.areaCode : undefined;
  return { service, region, plan, receivingMode, quantity: receivingMode === 'ONE_TIME' ? 1 : candidate.quantity, areaCode, step: 0 };
}
function Link({ href, children }: { href: string; children: ReactNode }) {
  return <a className="lp-shell-view-link" href={href}>{children}<ArrowRight size={15} aria-hidden="true" /></a>;
}

export default function PurchasePage({ data, actions, route }: { data: WorkspaceData; actions: WorkspaceActions; route: ShellRoute }) {
  const p = useDisplayPreferences();
  const owner = data.account.id;
  const [pending, setPending] = useState(() => {
    const parsed = createOrderInputSchema.safeParse(readStored(`linepool:purchase:${owner}`));
    return parsed.success ? parsed.data : null;
  });
  const [draft, setDraft] = useState(() => restore(data.catalog, route, owner, pending));
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const lock = useRef(false);
  const frozen = busy || Boolean(pending) || Boolean(createdOrder);
  const offers = saleOffers(data.catalog).filter(offer => offer.receivingMode === draft.receivingMode);
  const country = data.catalog.regions.find(region => region.id === draft.region);
  const plans = offers.filter(offer => offer.region === draft.region && offer.service === draft.service);
  const offer = plans.find(offer => offer.plan === draft.plan);
  const countryStock = Math.max(0, ...plans.map(plan => plan.availableCount));
  const platforms = (data.catalog.platforms ?? data.catalog.services.map(name => ({ name, slug: name.toLowerCase(), popular: true, available: true })))
    .map(platform => ({ ...platform, available: platform.available && offers.some(offer => offer.service === platform.name && offer.availableCount > 0) }))
    .filter(platform => platform.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(b.available) - Number(a.available) || Number(b.popular) - Number(a.popular));
  const visiblePlatforms = platforms.filter(platform => platform.available || showAll);
  const unavailableCount = platforms.filter(platform => !platform.available).length;
  const areaCodes = [...new Set(plans.flatMap(plan => plan.areaCodes?.filter(area => area.availableCount > 0).map(area => area.code) ?? []))].sort();
  const stock = offer ? draft.areaCode ? offer.areaCodes?.find(area => area.code === draft.areaCode)?.availableCount ?? 0 : offer.availableCount : 0;
  const validQuantity = Number.isInteger(draft.quantity) && draft.quantity >= 1 && draft.quantity <= (draft.receivingMode === 'ONE_TIME' ? 1 : 10);
  const total = offer && validQuantity ? offer.unitPoints * draft.quantity : 0;
  const insufficientPoints = Boolean(offer && validQuantity && total > data.account.pointsBalance);
  const points = (value: number) => `${p.n(value)} ${p.t('积分')}`;
  const quoteError = !country || !offer ? '请选择有效的平台、国家和服务期限' : !validQuantity ? draft.receivingMode === 'ONE_TIME' ? '一次性接码每单仅限 1 个号码' : '数量必须是 1 到 10 的整数'
    : stock < draft.quantity ? draft.areaCode ? '所选区号库存不足，请切换区号或自动分配' : '所选服务库存不足，请重新选择'
    : total > data.account.pointsBalance ? '积分余额不足' : '';
  const allocation = draft.areaCode ? p.t('指定区号 {code}', { code: draft.areaCode }) : p.t('自动分配');

  useEffect(() => {
    if (!pending && !createdOrder) {
      const { service, region, plan, receivingMode, quantity, areaCode } = draft;
      writeStored(`linepool:purchase-draft:${owner}`, { service, region, plan, receivingMode, quantity, areaCode });
    }
  }, [draft, owner, pending, createdOrder]);
  useEffect(() => { stepHeading.current?.focus({ preventScroll: true }); }, [draft.step]);
  function update(value: Partial<Draft>) {
    if (frozen || lock.current) return;
    setDraft(current => {
      const changedProduct = (['service', 'region', 'plan', 'receivingMode'] as const).some(key => value[key] !== undefined && value[key] !== current[key]);
      return { ...current, ...value, ...(changedProduct || (value.receivingMode ?? current.receivingMode) === 'ONE_TIME' ? { quantity: 1 } : {}) };
    });
    setFailure('');
  }
  function selectPlatform(service: string) {
    if (!data.catalog.services.some(item => item === service)) return;
    const candidates = offers.filter(item => item.region === storefrontRegionIds[0] && item.service === service && item.availableCount > 0);
    const selected = candidates.find(item => item.durationDays === 30) ?? candidates[0];
    if (selected) update({ service, region: selected.region, plan: selected.plan, areaCode: undefined, quantity: 1, step: 1 });
  }
  function confirmOrder() {
    if (busy || createdOrder || (!pending && quoteError)) return;
    try {
      const input = pending ?? createOrderInputSchema.parse({ region: draft.region, service: draft.service, plan: draft.plan, receivingMode: draft.receivingMode, quantity: draft.quantity, areaCode: draft.areaCode, idempotencyKey: crypto.randomUUID() });
      void submit(input);
    } catch (error) { setFailure(apiMessage(error, p.locale)); }
  }
  async function submit(input: CreateOrderInput) {
    if (lock.current || createdOrder) return;
    lock.current = true; setBusy(true); setFailure('');
    try {
      setPending(input); writeStored(`linepool:purchase:${owner}`, input);
      const order = await actions.createOrder(input);
      setCreatedOrder(order); setPending(null);
      writeStored(`linepool:purchase:${owner}`, null); writeStored(`linepool:purchase-draft:${owner}`, null);
    } catch (error) {
      setFailure(apiMessage(error, p.locale));
      // A timeout or invalid response can hide a committed order. Never replace that intent.
      if (error instanceof LinepoolApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        setPending(null); writeStored(`linepool:purchase:${owner}`, null);
        if (['INSUFFICIENT_POINTS', 'INSUFFICIENT_STOCK', 'OFFER_NOT_FOUND'].includes(error.code)) await actions.refresh();
      }
    } finally { lock.current = false; setBusy(false); }
  }
  function Facts() {
    return <dl className="lp-shell-view-facts lp-purchase-facts">
      <div><dt>{p.t('平台')}</dt><dd>{draft.service ? <ServiceLabel service={draft.service} /> : '--'}</dd></div>
      <div><dt>{p.t('国家')}</dt><dd>{country ? p.t(country.name) : '--'}</dd></div>
      <div><dt>{p.t('分配方式')}</dt><dd>{allocation}</dd></div>
      <div><dt>{p.t('服务类型')}</dt><dd>{p.t(receivingModeLabel(draft))}</dd></div>
      <div><dt>{p.t('服务期限')}</dt><dd>{offer ? receivingTerm(offer, p) : '--'}</dd></div>
      <div><dt>{p.t('服务数量')}</dt><dd>{validQuantity ? p.n(draft.quantity) : '—'}</dd></div>
      <div><dt>{p.t('单价')}</dt><dd>{offer ? `${p.n(offer.unitPoints)} ${p.t('积分')}` : '--'}</dd></div>
    </dl>;
  }
  if (createdOrder) return <section className="lp-purchase-complete">
    <header><CheckCircle2 size={30} aria-hidden="true" /><div><h2 role="status">{p.t('服务订单已创建')}</h2><p title={createdOrder.orderNumber}>{createdOrder.orderNumber.length > 16 ? `${createdOrder.orderNumber.slice(0, 11)}…${createdOrder.orderNumber.slice(-4)}` : createdOrder.orderNumber}</p><CopyValue labels={p.copyLabels} value={createdOrder.orderNumber} label={p.t('复制订单号')} /></div></header>
    <PlatformSmsNotice />
    {createdOrder.status === 'PROCESSING' && <p role="status">{p.t('订单处理中，尚未交付号码。请到订单记录核对履约结果。')}</p>}
    <dl className="lp-purchase-result-facts"><div><dt>{p.t('平台')}</dt><dd><ServiceLabel service={createdOrder.service} /></dd></div><div><dt>{p.t('国家')}</dt><dd>{p.t(createdOrder.country)}</dd></div><div><dt>{p.t('服务期限')}</dt><dd>{receivingTerm(createdOrder, p)}</dd></div><div><dt>{p.t('分配方式')}</dt><dd>{createdOrder.areaCode ? p.t('指定区号 {code}', { code: createdOrder.areaCode }) : p.t('自动分配')}</dd></div><div><dt>{p.t('订单积分')}</dt><dd>{p.n(createdOrder.totalPoints)}</dd></div></dl>
    <div className="lp-shell-view-table-scroll"><table className="lp-purchase-result-table"><thead><tr><th>{p.t('已分配服务号码')}</th><th>{p.t('服务窗口')}</th><th>{p.t('接码状态')}</th><th>{p.t('操作')}</th></tr></thead><tbody>{createdOrder.numbers.map(number => <tr key={number.allocationId ?? number.id}><td><div className="lp-purchase-number">{number.phoneNumber}<CopyValue labels={p.copyLabels} value={number.phoneNumber} label={p.t('复制号码')} /></div></td><td><ReceivingWindow number={number} /></td><td><ReceivingStatus number={number} /></td><td><Link href={shellHref('inbox', { number: number.id, allocation: number.allocationId, message: number.firstMessageId ?? undefined })}>{p.t(number.receivingStatus === 'SUCCESS' ? '回看首码' : '进入收件箱')}</Link></td></tr>)}</tbody></table></div>
    <footer><Link href={shellHref('orders')}>{p.t('查看订单记录')}</Link><ActionButton onClick={() => { setCreatedOrder(null); setDraft({ service: '', region: '', plan: '', receivingMode: draft.receivingMode, quantity: 1, step: 0 }); }}>{p.t('继续创建服务')}<ArrowRight size={16} /></ActionButton></footer>
  </section>;
  return <div className="lp-purchase-flow">
    <ol className="lp-purchase-steps" aria-label={p.t('服务创建进度')}>{steps.map((label, index) => <li key={label} className={draft.step === index ? 'is-current' : draft.step > index ? 'is-complete' : ''} aria-current={draft.step === index ? 'step' : undefined}><button type="button" disabled={frozen || index >= draft.step} onClick={() => update({ step: index })}><span>{draft.step > index ? <Check size={15} aria-hidden="true" /> : p.n(index + 1)}</span>{p.t(label)}</button></li>)}</ol>
    <PlatformSmsNotice />
    <div className={`lp-purchase-layout${draft.step === 0 && !pending ? ' is-platform-step' : ''}`}>
      <form className="lp-purchase-main" onSubmit={event => { event.preventDefault(); if (draft.step === 2 || pending) confirmOrder(); }}>
        <div className="lp-purchase-heading"><h2 ref={stepHeading} tabIndex={-1}>{p.t(steps[draft.step])}</h2>{draft.step > 0 && <ActionButton size="sm" variant="quiet" disabled={frozen} onClick={() => update({ step: draft.step - 1 })}><ArrowLeft size={15} />{p.t('上一步')}</ActionButton>}</div>
        <fieldset className="lp-purchase-fields" disabled={frozen}>
          {draft.step === 0 && <>
            <div className="lp-purchase-plans" role="radiogroup" aria-label={p.t('接码模式')}>{(['ONE_TIME', 'HOSTED'] as const).map(receivingMode => <label key={receivingMode} className={draft.receivingMode === receivingMode ? 'is-selected' : ''}><input type="radio" name="receiving-mode" value={receivingMode} checked={draft.receivingMode === receivingMode} onChange={() => update({ receivingMode, service: '', region: '', plan: '', areaCode: undefined, quantity: 1, step: 0 })} /><span><strong>{p.t(receivingModeLabel({ receivingMode }))}</strong><small>{p.t(receivingMode === 'ONE_TIME' ? '交付起 15 分钟，仅交付首个有效验证码' : '交付起完整 7 天或 30 天，不自动续期')}</small></span></label>)}</div>
            <AppSearchInput className="lp-purchase-search" placeholder={p.t('搜索平台')} aria-label={p.t('搜索平台')} value={search} onValueChange={setSearch} />
            <div className="lp-purchase-platforms">{visiblePlatforms.map(platform => <button type="button" key={platform.slug} disabled={!platform.available} className={`lp-purchase-platform${draft.service === platform.name ? ' is-selected' : ''}`} aria-label={`${platform.name} · ${p.t(platform.available ? '可选' : '暂不可用')}`} onClick={() => selectPlatform(platform.name)}><ServiceLabel service={platform.name} /><span className="lp-purchase-platform-status">{p.t(platform.available ? '可选' : '暂不可用')}{platform.available && <ArrowRight size={14} aria-hidden="true" />}</span></button>)}</div>
            {!visiblePlatforms.length && <div className="lp-purchase-empty"><Search size={24} /><p>{p.t('没有找到符合条件的平台')}</p></div>}
            {unavailableCount > 0 && <ActionButton variant="quiet" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{p.t(showAll ? '收起暂不可用平台' : '更多平台（暂不可用 · {count}）', { count: p.n(unavailableCount) })}</ActionButton>}
          </>}
          {draft.step === 1 && <><div className="lp-purchase-context"><ServiceLabel service={draft.service} /></div>
            <div className="lp-purchase-region"><span className="lp-purchase-field-label">{p.t('国家')}</span>{country && <div className="lp-purchase-country"><Flag code={country.id} /><span><strong>{p.t(country.name)}</strong><small>{country.english} · {country.prefix}</small></span><StatusPill tone={countryStock ? 'green' : 'neutral'}>{p.t(countryStock ? '可用' : '暂无库存')}</StatusPill></div>}<p>{p.t('目前仅支持美国号码')}</p></div>
            {/* US-only area-code selection. Other regions use automatic allocation. */}
            {draft.region === 'us' && areaCodes.length > 1 && <div className="lp-purchase-allocation" role="radiogroup" aria-labelledby="lp-purchase-allocation-label">
              <span id="lp-purchase-allocation-label" className="lp-purchase-field-label">{p.t('分配方式')}</span>
              <label className={!draft.areaCode ? 'is-selected' : ''}><input type="radio" name="allocation" aria-label={p.t('自动分配')} value="automatic" checked={!draft.areaCode} onChange={() => update({ areaCode: undefined })} /><span><strong>{p.t('自动分配')}</strong><small>{p.t('推荐')}</small></span>{!draft.areaCode && <CheckCircle2 size={20} aria-hidden="true" />}</label>
              <label className={draft.areaCode ? 'is-selected' : ''}><input type="radio" name="allocation" aria-label={p.t('指定区号')} value="area-code" checked={Boolean(draft.areaCode)} disabled={!areaCodes.length} onChange={() => update({ areaCode: areaCodes[0] })} /><span><strong>{p.t('指定区号')}</strong><small>{p.t(areaCodes.length ? '美国区号' : '暂无可用区号')}</small></span></label>
            </div>}
            {areaCodes.length <= 1 && <p className="lp-shell-view-meta">{p.t('自动分配可用号码')}</p>}
            {draft.areaCode && areaCodes.length > 1 && <div className="lp-purchase-area-code"><label className="lp-purchase-field-label" htmlFor="lp-purchase-area-code">{p.t('美国区号')}</label><SelectField id="lp-purchase-area-code" aria-label={p.t('美国区号')} disabled={frozen} value={draft.areaCode} onValueChange={areaCode => update({ areaCode })} options={areaCodes.map(code => ({ value: code, label: `+1 ${code}` }))} /></div>}
            <div className="lp-purchase-next"><ActionButton variant="accent" disabled={!country || !countryStock || Boolean(draft.areaCode && !areaCodes.includes(draft.areaCode))} onClick={() => update({ step: 2 })}>{p.t('选择服务期限')}<ArrowRight size={16} /></ActionButton></div>
          </>}
          {draft.step === 2 && <><div className="lp-purchase-context"><ServiceLabel service={draft.service} />{country && <span><Flag code={country.id} />{p.t(country.name)}</span>}<span>{allocation}</span></div>
            <div className="lp-purchase-capability"><Inbox size={16} aria-hidden="true" /><span>{p.t(receivingModeLabel(draft))}</span></div>
            <div className="lp-purchase-plans" role="radiogroup" aria-label={p.t('服务期限')}>{plans.map(plan => <label className={draft.plan === plan.plan ? 'is-selected' : ''} key={plan.plan}><input type="radio" name="plan" aria-label={receivingTerm(plan, p)} value={plan.plan} checked={draft.plan === plan.plan} onChange={() => update({ plan: plan.plan })} /><span><strong>{receivingTerm(plan, p)}</strong><small>{p.t(plan.name)}</small></span><b>{p.n(plan.unitPoints)}<small>{p.t('积分 / 个')}</small></b></label>)}</div>
            <p className="lp-shell-view-meta">{p.t(draft.receivingMode === 'ONE_TIME' ? '交付起 15 分钟，仅交付首个有效验证码；窗口结束后仍可能核对结果。刷新或登记等待不会重置窗口。' : '托管按完整 168／720 小时计时，沿现有收信能力与限频，不设本地总条数限制，不自动续期。')}</p>
            {draft.receivingMode === 'ONE_TIME' && <p className="lp-shell-view-meta">{p.t('按 PC 实际接收时间判断是否在窗口内；同步到本站的时间不改变结果。')}</p>}
            <p className="lp-shell-view-meta" id="lp-purchase-quantity-hint">{p.t(draft.receivingMode === 'ONE_TIME' ? '一次性接码每单仅限 1 个号码' : '每次最多 10 个')}</p>
            <div className="lp-purchase-quantity"><label htmlFor="lp-purchase-quantity">{p.t('服务数量')}</label><div className="lp-shell-view-stepper"><button type="button" title={p.t('减少数量')} aria-label={p.t('减少数量')} disabled={draft.receivingMode === 'ONE_TIME' || !validQuantity || draft.quantity <= 1} onClick={() => update({ quantity: draft.quantity - 1 })}><Minus size={16} /></button><input id="lp-purchase-quantity" aria-describedby="lp-purchase-quantity-hint" type="number" min="1" max={draft.receivingMode === 'ONE_TIME' ? 1 : 10} step="1" readOnly={draft.receivingMode === 'ONE_TIME'} value={Number.isFinite(draft.quantity) ? draft.quantity : ''} onChange={event => update({ quantity: event.currentTarget.valueAsNumber })} /><button type="button" title={p.t('增加数量')} aria-label={p.t('增加数量')} disabled={draft.receivingMode === 'ONE_TIME' || !validQuantity || draft.quantity >= Math.min(10, stock)} onClick={() => update({ quantity: draft.quantity + 1 })}><Plus size={16} /></button></div><span>{p.t('可用库存 {count}', { count: p.n(stock) })}</span></div>
          </>}
        </fieldset>
      </form>
      {(draft.step > 0 || pending) && <aside className="lp-purchase-summary" aria-label={p.t('订单摘要')}><h2>{p.t('订单摘要')}</h2><Facts /><div className="lp-shell-view-total"><span>{p.t('合计')}</span><strong>{offer && validQuantity ? points(total) : '—'}</strong></div><dl className="lp-shell-view-facts"><div><dt>{p.t('可用余额')}</dt><dd>{p.n(data.account.pointsBalance)} {p.t('积分')}</dd></div><div><dt>{p.t('下单后余额')}</dt><dd>{!quoteError ? p.n(data.account.pointsBalance - total) : '--'}</dd></div></dl>
        {(draft.step === 2 || pending) && <><ActionButton variant="accent" disabled={busy || (!pending && Boolean(quoteError))} onClick={confirmOrder}><ShoppingBag size={16} />{p.t(busy ? '正在提交…' : pending ? '重试并确认订单' : '确认支付 {points} 积分', { points: p.n(total) })}</ActionButton>{!pending && quoteError && !insufficientPoints && <p className="lp-shell-view-error" role="status">{p.t(quoteError)}</p>}</>}
        {insufficientPoints && !pending && <div className="lp-purchase-balance-warning"><p className="lp-shell-view-error" role="status">{p.t('积分余额不足')}</p><RechargeButton fromCheckout /></div>}
        {pending && !busy && <div className="lp-purchase-pending" role="status"><p>{p.t('服务订单结果待确认，请重试原订单或查看订单记录，不要重新创建服务。')}</p><Link href={shellHref('orders')}>{p.t('查看订单记录')}</Link></div>}
        {failure && <p className="lp-shell-view-error" role="alert">{failure}</p>}
      </aside>}
    </div>
  </div>;
}
