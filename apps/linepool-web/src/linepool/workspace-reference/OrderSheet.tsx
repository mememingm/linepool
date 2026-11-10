import { useEffect, useState, type RefObject } from 'react';
import { ArrowRight, Smartphone, X } from 'lucide-react';
import type { Order, OrderDetail } from '../api/contracts';
import { CopyValue } from '../business';
import { fulfillmentDisplay } from '../components';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Flag } from '../showcase/shared';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { ServiceLabel } from './WorkspaceDetails';
import { shellHref } from './navigation';
import { apiMessage, type WorkspaceActions } from './workspace-data';
import { receivingModeLabel, receivingTerm, ReceivingStatus, ReceivingWindow } from './ReceivingService';
import './OrderSheet.css';

function OrderBadge({ order }: { order: Order }) {
  const p = useDisplayPreferences();
  return <Badge variant="outline" className="lp-order-badge" data-status={order.status}>{p.t(order.status === 'COMPLETED' ? '号码已交付' : fulfillmentDisplay[order.status].label)}</Badge>;
}

export function OrderRow({ order, onSelect }: { order: Order; onSelect: (order: Order, trigger: HTMLButtonElement) => void }) {
  const p = useDisplayPreferences();
  return <SheetTrigger asChild>
    <Button type="button" variant="outline" className="lp-order-row" onClick={event => onSelect(order, event.currentTarget)}>
      <span className="lp-order-row-service"><Flag code={order.region} /><span><strong>{p.t('{region}服务号码', { region: p.t(order.country) })}</strong><small>{receivingTerm(order, p)} · {p.n(order.quantity)} {p.t('个')}{order.receivingMode === 'ONE_TIME' && order.receivingStatus ? ` · ${p.t(order.receivingStatus === 'SUCCESS' ? '接码成功' : order.receivingStatus === 'FAILED' ? '确认失败，积分已全退' : '等待接码／核对中')}` : ''}</small></span></span>
      <span className="lp-order-row-payment"><strong>{p.n(order.totalPoints)} {p.t('积分')}</strong><time dateTime={order.createdAt}>{p.date(order.createdAt)}</time></span>
      <OrderBadge order={order} />
      <ArrowRight size={17} aria-hidden="true" className="lp-order-row-arrow" />
    </Button>
  </SheetTrigger>;
}

export default function OrderSheet({ order, open, actions, triggerRef }: { order: Order | null; open: boolean; actions: WorkspaceActions; triggerRef: RefObject<HTMLButtonElement | null> }) {
  const p = useDisplayPreferences();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Ignore obsolete responses when a panel closes or another order is selected.
  useEffect(() => {
    if (!open || !order) return;
    let active = true;
    setDetail(null); setError(''); setBusy(true);
    void actions.order(order.id).then(result => { if (active) setDetail(result); })
      .catch(failure => { if (active) setError(apiMessage(failure)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, order?.id, actions.order, attempt]);

  if (!order) return null;
  const currentDetail = detail?.id === order.id ? detail : null;
  const displayOrder = currentDetail ?? order;
  return <SheetContent className="lp-order-sheet" overlayClassName="lp-order-sheet-overlay" side="right" showCloseButton={false} lang={p.locale}
    onCloseAutoFocus={event => {
      // One Sheet serves all rows; return to the row that actually opened it, without scrolling.
      event.preventDefault();
      triggerRef.current?.focus({ preventScroll: true });
    }}>
    <SheetHeader className="lp-order-sheet-header">
      <SheetTitle>{p.t('订单详情')}</SheetTitle>
      <SheetClose asChild><Button type="button" variant="ghost" size="icon" className="lp-order-sheet-close" aria-label={p.t('关闭')}><X size={19} aria-hidden="true" /></Button></SheetClose>
      <SheetDescription>{p.t('订单编号')}</SheetDescription>
      <div className="lp-order-sheet-reference">
        <TooltipProvider delayDuration={350}><Tooltip><TooltipTrigger asChild><code tabIndex={0}>{displayOrder.orderNumber}</code></TooltipTrigger><TooltipContent side="bottom" sideOffset={8} className="lp-order-number-tooltip">{displayOrder.orderNumber}</TooltipContent></Tooltip></TooltipProvider>
        <CopyValue labels={p.copyLabels} value={displayOrder.orderNumber} label={p.t('复制订单号')} />
      </div>
    </SheetHeader>
    <div className="lp-order-sheet-body" key={order.id} tabIndex={0} role="region" aria-label={p.t('订单详情')}>
      <section className="lp-order-sheet-section" aria-labelledby="lp-order-overview-title">
        <h3 id="lp-order-overview-title">{p.t('订单概览')}</h3>
        <dl className="lp-order-sheet-facts">
          <div><dt>{p.t('服务名称')}</dt><dd>{p.t('{region}服务号码', { region: p.t(displayOrder.country) })}</dd></div>
          <div><dt>{p.t('套餐名称')}</dt><dd>{p.t(displayOrder.planName)}</dd></div>
          <div><dt>{p.t('订单状态')}</dt><dd><OrderBadge order={displayOrder} /></dd></div>
          <div><dt>{p.t('下单时间')}</dt><dd><time dateTime={displayOrder.createdAt}>{p.date(displayOrder.createdAt)}</time></dd></div>
        </dl>
      </section>
      <Separator className="lp-order-sheet-separator" />
      <section className="lp-order-sheet-section" aria-labelledby="lp-order-service-title">
        <h3 id="lp-order-service-title">{p.t('服务信息')}</h3>
        <dl className="lp-order-sheet-facts">
          <div><dt>{p.t('平台')}</dt><dd><ServiceLabel service={displayOrder.service} /></dd></div>
          <div><dt>{p.t('服务类型')}</dt><dd>{p.t(receivingModeLabel(displayOrder))}</dd></div>
          <div><dt>{p.t('服务期限')}</dt><dd>{receivingTerm(displayOrder, p)}</dd></div>
          <div><dt>{p.t('分配方式')}</dt><dd>{displayOrder.areaCode ? p.t('指定区号 {code}', { code: displayOrder.areaCode }) : p.t('自动分配')}</dd></div>
          <div><dt>{p.t('服务数量')}</dt><dd>{p.n(displayOrder.quantity)} {p.t('个')}</dd></div>
        </dl>
      </section>
      <Separator className="lp-order-sheet-separator" />
      <section className="lp-order-sheet-section" aria-labelledby="lp-order-numbers-title" aria-busy={busy}>
        <h3 id="lp-order-numbers-title">{p.t('服务号码')}</h3>
        {busy && <p className="lp-order-sheet-muted" role="status">{p.t('正在加载号码…')}</p>}
        {error && <div className="lp-order-sheet-error" role="alert"><p>{p.t(error)}</p><Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>{p.t('重试')}</Button></div>}
        {currentDetail && !currentDetail.numbers.length && !busy && !error && <p className="lp-order-sheet-muted" role="status">{p.t('此订单暂无关联号码')}</p>}
        {!busy && !error && <ul className="lp-order-sheet-numbers">{currentDetail?.numbers.map(number => <li key={number.allocationId ?? number.id}>
          <span><Smartphone size={16} aria-hidden="true" />{number.phoneNumber}<CopyValue labels={p.copyLabels} value={number.phoneNumber} label={p.t('复制号码')} /></span>
          <Button asChild variant="ghost"><a href={shellHref('inbox', { number: number.id, allocation: number.allocationId, message: number.firstMessageId ?? undefined })}>{p.t(number.receivingStatus === 'SUCCESS' ? '回看首码' : '收件箱')}<ArrowRight size={15} aria-hidden="true" /></a></Button>
          <dl className="lp-order-sheet-facts lp-order-receiving"><div><dt>{p.t('服务窗口')}</dt><dd><ReceivingWindow number={number} /></dd></div><div><dt>{p.t('接码状态')}</dt><dd><ReceivingStatus number={number} /></dd></div></dl>
        </li>)}</ul>}
      </section>
      <Separator className="lp-order-sheet-separator" />
      <section className="lp-order-sheet-section" aria-labelledby="lp-order-payment-title">
        <h3 id="lp-order-payment-title">{p.t('费用信息')}</h3>
        <dl className="lp-order-sheet-facts">
          <div><dt>{p.t('单价')}</dt><dd>{p.n(displayOrder.unitPoints)} {p.t('积分')}</dd></div>
          <div><dt>{p.t('扣除积分')}</dt><dd className="lp-order-sheet-points">{p.n(displayOrder.totalPoints)} {p.t('积分')}</dd></div>
        </dl>
      </section>
    </div>
  </SheetContent>;
}
