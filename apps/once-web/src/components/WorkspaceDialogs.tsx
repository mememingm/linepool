import { useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useWorkspace, useWorkspaceUI } from "../app/WorkspaceProvider";
import { canRenew, formatDate, formatMoney, localDemo } from "../lib/models";
import { usePlans } from "../lib/queries";
import { usePointAccount, formatPoints, planPoints } from "../lib/points";
import { Icon } from "./ui";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "./ui/drawer";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Label } from "./ui/label";
import { useIsMobile } from "../hooks/use-mobile";

export function WorkspaceDialogs() {
  const { data, closeRenew, setScenesOpen, busy, confirmRenew, resetDemo } = useWorkspace();
  const terms = usePlans();
  const wallet = usePointAccount();
  const renewOpen = useWorkspaceUI(state => state.renewOpen), scenesOpen = useWorkspaceUI(state => state.scenesOpen);
  const renewDays = useWorkspaceUI(state => state.renewDays), setRenewDays = useWorkspaceUI(state => state.setRenewDays);
  const renewBase = useWorkspaceUI(state => state.renewBase), renewError = useWorkspaceUI(state => state.renewError);
  const returnFocus = useRef<HTMLElement | null>(null);
  const mobile = useIsMobile();
  const closeScenes = () => setScenesOpen(false);
  const lease = data?.lease, chosen = terms.find(term => term.days === renewDays);
  const valid = Boolean(data && canRenew(data) && chosen && Number.isFinite(renewBase) && renewBase > 0);
  const sceneContent = localDemo() && <div className="modal-body"><div className="scene-options">
    {Object.entries(window.OnceMock!.scenes).map(([id, label]) => <Button variant="outline" key={id} data-scene={id} aria-pressed={window.OnceMock!.scene === id} onClick={() => resetDemo(id)}>{label}</Button>)}
  </div><Button variant="outline" className="reset-demo" onClick={() => resetDemo(window.OnceMock!.scene)}><Icon name="refresh-cw" />重置当前场景</Button></div>;
  return <>
    <Dialog open={renewOpen} onOpenChange={open => { if (!open && !busy) closeRenew(); }}>
      <DialogContent className="once-dialog subscription-renew-dialog" showCloseButton={!busy}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); document.querySelector<HTMLButtonElement>('[data-action="renew"]:not(:disabled)')?.focus(); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
        onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>同号续费</DialogTitle>
          <DialogDescription>选择租期，新到期日从当前到期日顺延。</DialogDescription>
        </DialogHeader>
        {lease && <form className="subscription-renew-form" onSubmit={event => { event.preventDefault(); void confirmRenew(); }} aria-busy={busy}>
          <div className="modal-body">
            <dl className="subscription-renew-current">
              <div><dt>当前号码</dt><dd>{lease.number}</dd></div>
              <div><dt>当前到期日期</dt><dd>{formatDate(lease.expiresAt)}</dd></div>
            </dl>
            <fieldset className="subscription-renew-fieldset" disabled={busy}>
              <legend id="subscription-renew-label">选择续费租期</legend>
              <RadioGroup className="subscription-renew-options" value={String(renewDays)} onValueChange={value => setRenewDays(Number(value))} disabled={busy}
                aria-labelledby="subscription-renew-label" aria-describedby={renewError ? "subscription-renew-error" : "subscription-renew-hint"} aria-invalid={Boolean(renewError)} required>
                {terms.map(term => <Label key={term.days} htmlFor={`renew-term-${term.days}`} className={`subscription-renew-option ${term.days === renewDays ? "selected" : ""}`}>
                  <RadioGroupItem id={`renew-term-${term.days}`} value={String(term.days)} data-renew={term.days} />
                  <span><strong>{term.days} 天</strong><small>{term.label}</small></span>
                  <b>{localDemo() ? formatMoney(term.price, lease.currency) : formatPoints(planPoints(term))}</b>
                </Label>)}
              </RadioGroup>
            </fieldset>
            <dl className="subscription-renew-summary">
              <div><dt>预计续费后到期</dt><dd>{chosen ? formatDate(renewBase + chosen.days * 86400000) : "请选择租期"}</dd></div>
              <div className="subscription-renew-total"><dt>应付积分</dt><dd>{chosen ? localDemo() ? formatMoney(chosen.price, lease.currency) : formatPoints(planPoints(chosen)) : "—"}</dd></div>
              {!localDemo() && <div><dt>可用积分</dt><dd>{wallet.data ? formatPoints(wallet.data.availablePoints) : "正在读取…"}</dd></div>}
            </dl>
            <p id="subscription-renew-hint" className="subscription-renew-hint">提交时冻结积分，续费成功才扣除，明确失败会解冻。站内续租不会延长 PinClode 的资源到期时间，所选租期必须在已确认的资源期限内。</p>
            {renewError && <p className="subscription-renew-error" id="subscription-renew-error" role="alert"><Icon name="triangle-alert" />{renewError}</p>}
          </div>
          <div className="modal-foot">
            <Button type="button" variant="outline" onClick={closeRenew} disabled={busy}>取消</Button>
            <Button type="submit" data-action="confirm-renew" disabled={busy || !valid}>{busy && <LoaderCircle className="subscription-loading" size={16} aria-hidden="true" />}{busy ? "提交中…" : !localDemo() && chosen && wallet.data && wallet.data.availablePoints < planPoints(chosen) ? "充值后返回确认" : "确认续费"}</Button>
          </div>
        </form>}
      </DialogContent>
    </Dialog>
    {mobile ? <Drawer open={scenesOpen} onOpenChange={value => { if (!value) closeScenes(); }} shouldScaleBackground={false}>
      <DrawerContent className="once-dialog"><DrawerHeader><DrawerTitle>场景设置</DrawerTitle><DrawerDescription>切换场景将重置当前场景中的记录。</DrawerDescription></DrawerHeader>{sceneContent}<Button className="drawer-dismiss" variant="ghost" onClick={closeScenes}>关闭</Button></DrawerContent>
    </Drawer> : <Dialog open={scenesOpen} onOpenChange={value => { if (!value) closeScenes(); }}>
      <DialogContent className="once-dialog"><DialogHeader><DialogTitle>场景设置</DialogTitle><DialogDescription>切换场景将重置当前场景中的记录。</DialogDescription></DialogHeader>{sceneContent}</DialogContent>
    </Dialog>}
  </>;
}
