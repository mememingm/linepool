import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { gsap, reducedMotion, useGSAP } from './motion';
import { AlertCircle, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Inbox, LoaderCircle, Search, ShieldCheck, Smartphone, X } from 'lucide-react';
import { countries, isActive, statusNames, type Task, type TaskStatus } from './types';
import { platformLogo } from './catalog';

export function ServiceIcon({ service, small = false }: { service: string; small?: boolean }) {
  const logo = platformLogo(service);
  return <span className={`service-icon ${service.toLowerCase().replace(/[^a-z0-9-]/g, '-')} ${small ? 'small' : ''}`}>
    {logo ? <img src={logo} alt="" width={small ? 18 : 24} height={small ? 18 : 24} /> : <Smartphone size={small ? 18 : 24} aria-hidden="true" />}
  </span>;
}
export function Country({ code }: { code: string }) {
  return <span className="country"><img src={`/flags/${code.toLowerCase()}.png`} alt="" width="20" height="14" />{countries[code] ?? code}</span>;
}
export function Status({ status }: { status: TaskStatus }) {
  return <span className={`status ${status.toLowerCase()}`}><span className="status-dot" />{statusNames[status]}</span>;
}
export function DemoBadge() { return <span className="demo-badge"><ShieldCheck size={13} />本地演示</span>; }
export function Spinner() { return <LoaderCircle size={16} className="spin" aria-hidden="true" />; }
export function CopyButton({ value, label, onCopy }: { value: string; label: string; onCopy: (value: string) => Promise<void> }) {
  return <button className="icon-button copy-button" title={label} aria-label={label} onClick={() => void onCopy(value)}><Copy size={15} /></button>;
}
export function SearchField({ value, onChange, placeholder = '搜索服务或任务编号', label = '搜索' }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  return <div className="search-field"><Search size={16} /><input aria-label={label} type="search" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />{value && <button className="icon-button" type="button" aria-label="清空搜索" title="清空搜索" onClick={() => onChange('')}><X size={14} /></button>}</div>;
}
export function Countdown({ task, now }: { task: Task; now: number }) {
  if (!isActive(task)) return <span className="muted">已结束</span>;
  const seconds = Math.max(0, Math.ceil((Date.parse(task.expiresAt) - now) / 1000));
  return <span className={`countdown ${seconds <= 120 ? 'urgent' : ''}`} aria-label={`剩余 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}>{seconds > 0 ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : '正在确认到期'}</span>;
}
export function EmptyState({ title = '暂无匹配记录', description = '试试调整搜索或筛选条件。', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Inbox size={25} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Pagination({ total, page, pageSize = 8, onChange }: { total: number; page: number; pageSize?: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / 共 ${total} 条` : '共 0 条'}</span><div><button className="icon-button" aria-label="上一页" title="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button><span>{page} / {pages}</span><button className="icon-button" aria-label="下一页" title="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button></div></div>;
}

let overlayLayer = 100;
export function ModalDismiss({ children }: { children: ReactNode }) { return <Dialog.Close asChild>{children}</Dialog.Close>; }

// Radix owns focus containment, nested layers, escape handling, and background scroll locking.
export function Modal({ title, children, onClose, drawer = false, busy = false, className = '' }: { title: string; children: ReactNode; onClose: () => void; drawer?: boolean; busy?: boolean; className?: string }) {
  const [layer] = useState(() => { overlayLayer += 2; return overlayLayer; });
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closing = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const { contextSafe } = useGSAP(() => {
    if (!node || !overlay) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: .2, ease: 'power2.out' });
      gsap.fromTo(node, drawer ? { opacity: 0, x: 16 } : { opacity: 0, y: 8, scale: .98 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: .24, ease: 'power2.out', clearProps: 'transform,opacity' });
    });
    return () => media.revert();
  }, { dependencies: [node, overlay], revertOnUpdate: true });
  const close = contextSafe(() => {
    if (busyRef.current || closing.current) return;
    closing.current = true;
    if (!node || !overlay || reducedMotion()) { onClose(); return; }
    gsap.killTweensOf([node, overlay]);
    gsap.timeline({ onComplete: onClose })
      .to(overlay, { opacity: 0, duration: .15 }, 0)
      .to(node, { opacity: 0, ...(drawer ? { x: 12 } : { y: 5, scale: .985 }), duration: .15, ease: 'power1.in' }, 0);
  });
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Overlay ref={setOverlay} className="modal-overlay" style={{ zIndex: layer }} />
      <Dialog.Content ref={setNode} style={{ zIndex: layer + 1 }} aria-describedby={undefined} className={`${drawer ? 'drawer' : 'modal'} ${className}`} data-overlay-content onEscapeKeyDown={event => { if (busyRef.current) event.preventDefault(); }} onInteractOutside={event => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={event => {
        event.preventDefault();
        queueMicrotask(() => {
          const target = returnFocus.current;
          const top = [...document.querySelectorAll<HTMLElement>('[data-overlay-content]')].at(-1);
          if (target?.isConnected && target.getClientRects().length && !target.matches(':disabled') && (!top || top.contains(target))) {
            target.focus({ preventScroll: true });
          } else {
            const fallback = top?.querySelector<HTMLElement>('button:not(:disabled), [href], input:not(:disabled)') ?? document.getElementById('main');
            fallback?.focus({ preventScroll: true });
          }
        });
      }}><header className="modal-header"><Dialog.Title>{title}</Dialog.Title><button className="icon-button" title="关闭" aria-label="关闭" disabled={busy} onClick={close}><X size={20} /></button></header>{children}</Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
export function InlineNotice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <div className={`inline-notice ${warning ? 'warning' : ''}`}><ShieldCheck size={17} /><span>{children}</span></div>;
}
export function Toast({ message, tone = 'success' }: { message: string | null; tone?: 'success' | 'error' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.showPopover();
    return () => { if (ref.current?.matches(':popover-open')) ref.current.hidePopover(); };
  }, [message]);
  useGSAP(() => {
    if (!message || !ref.current) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(ref.current, { opacity: 0, y: 7 }, { opacity: 1, y: 0, duration: .2, ease: 'power2.out', clearProps: 'opacity,transform' });
    });
    return () => media.revert();
  }, { dependencies: [message], revertOnUpdate: true });
  return message ? <div ref={ref} popover="manual" className={`toast ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{message}</span></div> : null;
}
export function tabKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = tabs.findIndex(tab => tab === document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus(); tabs[next]?.click();
}
export function StepMark({ done }: { done: boolean }) { return <span className={`step-mark ${done ? 'done' : ''}`}>{done ? <Check size={13} /> : <span />}</span>; }
