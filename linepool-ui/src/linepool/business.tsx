import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../vendor/beautiful/src/components/atoms/Button';
import { StatusPill } from '../vendor/beautiful/src/components/atoms/StatusPill';
import { Chip } from '../vendor/beautiful/src/components/atoms/Chip';
import { ValuePill } from '../vendor/beautiful/src/components/atoms/ValuePill';
import { MagicCard } from '../vendor/magic/src/components/ui/magic-card';
import { ActionButton } from './components';

/** Structural subsets of packages/contracts; the host owns fetching and validation. */
export type BusinessProject = { id: string; name: string; countryName: string; description: string; availableCount: number; minPoints: number; isActive: boolean };
export type BusinessPlan = { id: string; name: string; description: string; unitPoints: number; durationDays: number; availableCount: number; isActive: boolean };
export type BusinessNumber = { id: string; phoneNumber: string; project: { name: string }; status: 'ACTIVE' | 'EXPIRED'; expiresAt: string };
export type BusinessSms = { id: string; phoneNumber: string; sender: string; body: string; verificationCode: string | null; receivedAt: string; isRead: boolean };
export type BusinessLedgerEntry = { id: string; type: 'SEED_CREDIT' | 'ORDER_DEBIT' | 'ADJUSTMENT'; delta: number; balanceAfter: number; description: string; createdAt: string };
const dateLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date) + ' UTC';
};

function Surface({ children }: { children: ReactNode }) {
  return <MagicCard className="rounded-xl"><div className="lp-business-content">{children}</div></MagicCard>;
}

export function ProjectCard({ project, onSelect }: { project: BusinessProject; onSelect?: (id: string) => void }) {
  const available = project.isActive && project.availableCount > 0;
  return <Surface><div className="lp-business-row"><ValuePill>{project.countryName}</ValuePill><StatusPill tone={available ? 'green' : 'neutral'}>{!project.isActive ? '暂停服务' : available ? '可用' : '暂无库存'}</StatusPill></div><h3 className="lp-business-title">{project.name}</h3><p className="lp-business-muted">{project.description}</p><dl className="lp-business-facts"><div><dt>可用号码</dt><dd>{project.availableCount}</dd></div><div><dt>起步积分</dt><dd>{project.minPoints} 积分</dd></div></dl><Button type="button" variant="primary" disabled={!available || !onSelect} onClick={() => onSelect?.(project.id)}>选择项目</Button></Surface>;
}

export function PlanPicker({ plans, value, quantity = 1, onChange }: { plans: readonly BusinessPlan[]; value: string | null; quantity?: number; onChange: (id: string) => void }) {
  if (!plans.length) return <BusinessState kind="empty" title="暂无套餐" description="该项目目前没有可选套餐。" />;
  return <div className="lp-business-stack" role="group" aria-label="选择套餐">{plans.map(plan => <div key={plan.id} className="lp-business-row lp-plan-row"><div><strong>{plan.name}</strong><p className="lp-business-muted">{plan.description}</p><div className="lp-business-row"><ValuePill>{plan.unitPoints} 积分 / 号码</ValuePill><ValuePill>{plan.durationDays} 天</ValuePill><ValuePill>库存 {plan.availableCount}</ValuePill></div></div><Button type="button" aria-pressed={value === plan.id} variant={value === plan.id ? 'primary' : 'secondary'} disabled={!plan.isActive || plan.availableCount < quantity} onClick={() => onChange(plan.id)}>{!plan.isActive ? '已停用' : plan.availableCount < quantity ? '库存不足' : value === plan.id ? '已选择' : '选择'}</Button></div>)}</div>;
}

export type OrderQuoteProps = { plan: BusinessPlan | null; quantity: number; balance: number; busy?: boolean; error?: string; onQuantityChange: (quantity: number) => void; onSubmit?: (selection: { planId: string; quantity: number }) => void };
export function OrderQuote({ plan, quantity, balance, busy = false, error, onQuantityChange, onSubmit }: OrderQuoteProps) {
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 10;
  const total = plan && validQuantity ? plan.unitPoints * quantity : null;
  const issue = !plan ? '请先选择套餐' : !validQuantity ? '数量必须为 1–10 的整数' : !plan.isActive ? '套餐已停用' : plan.availableCount < quantity ? '套餐库存不足' : total !== null && total > balance ? '积分余额不足' : null;
  return <Surface><h3 className="lp-business-title">确认费用</h3><p className="lp-business-muted">{plan?.name ?? '尚未选择套餐'} · 最多购买 10 个号码</p><div className="lp-business-row"><label>购买数量 <input className="lp-quantity-input" type="number" min={1} max={10} step={1} value={quantity} disabled={busy} onChange={event => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onQuantityChange(next); }} /></label><ValuePill>余额 {balance} 积分</ValuePill></div><dl className="lp-business-facts"><div><dt>本次扣除</dt><dd>{total ?? '—'} 积分</dd></div><div><dt>购买后余额</dt><dd>{issue || total === null ? '—' : balance - total} 积分</dd></div></dl>{issue && <p className="lp-business-muted" role="status">{issue}</p>}{error && <p className="lp-business-error" role="alert">{error}</p>}<ActionButton busy={busy} variant="primary" disabled={Boolean(issue) || !onSubmit} onClick={() => { if (!issue && plan) onSubmit?.({ planId: plan.id, quantity }); }}>确认下单</ActionButton></Surface>;
}

/** Copy occurs only after a click. Errors are surfaced; no fabricated success. */
export function CopyValue({ value, label = '复制', onCopy, onCopied, inline = false, labels }: { value: string; label?: string; onCopy?: (value: string) => Promise<void>; onCopied?: () => void; inline?: boolean; labels?: { busy?: string; done?: string; error?: string; success?: string } }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setState('idle'); return () => { generation.current++; }; }, [value, onCopy]);
  async function copy() {
    const current = ++generation.current;
    setState('busy');
    try {
      if (onCopy) await onCopy(value);
      else {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
      }
      if (current === generation.current) { setState('done'); onCopied?.(); }
    } catch { if (current === generation.current) setState('error'); }
  }
  return <span className={`lp-copy-control${inline ? ' is-inline' : ''}`}>{inline ? <button type="button" className="lp-copy-value-text" aria-label={label} title={label} disabled={state === 'busy'} aria-busy={state === 'busy'} onClick={() => void copy()}>{value}</button> : <ActionButton size="sm" busy={state === 'busy'} busyLabel={labels?.busy ?? '复制中…'} onClick={() => void copy()}>{state === 'done' ? labels?.done ?? '已复制' : label}</ActionButton>}<span className={state === 'error' ? 'lp-business-error' : 'lp-business-muted'} role="status">{state === 'error' ? labels?.error ?? '复制失败，请手动复制' : state === 'done' ? labels?.success ?? '复制成功' : ''}</span></span>;
}

export function NumberCard({ number, onOpenInbox, onCopy }: { number: BusinessNumber; onOpenInbox?: (id: string) => void; onCopy?: (value: string) => Promise<void> }) {
  return <Surface><div className="lp-business-row"><strong>{number.project.name}</strong><StatusPill tone={number.status === 'ACTIVE' ? 'green' : 'neutral'}>{number.status === 'ACTIVE' ? '使用中' : '已过期'}</StatusPill></div><p className="lp-business-number">{number.phoneNumber}</p><p className="lp-business-muted">到期时间：{dateLabel(number.expiresAt)}</p><div className="lp-business-row"><CopyValue value={number.phoneNumber} label="复制号码" onCopy={onCopy} /><Button type="button" size="sm" disabled={!onOpenInbox} onClick={() => onOpenInbox?.(number.id)}>查看短信</Button></div></Surface>;
}

export function SmsMessageCard({ message, markingRead = false, readError, onMarkRead, onCopy }: { message: BusinessSms; markingRead?: boolean; readError?: string; onMarkRead?: (id: string) => void; onCopy?: (value: string) => Promise<void> }) {
  return <Surface><div className="lp-business-row"><strong>{message.sender}</strong><StatusPill tone={message.isRead ? 'neutral' : 'accent'}>{message.isRead ? '已读' : '未读'}</StatusPill></div><p className="lp-business-muted">{message.phoneNumber} · {dateLabel(message.receivedAt)}</p><p className="lp-sms-body">{message.body}</p>{message.verificationCode !== null && <div className="lp-business-row"><Chip tone="accent">{message.verificationCode}</Chip><CopyValue value={message.verificationCode} label="复制验证码" onCopy={onCopy} /></div>}{!message.isRead && <div className="lp-business-row"><ActionButton size="sm" busy={markingRead} disabled={!onMarkRead} onClick={() => onMarkRead?.(message.id)}>标为已读</ActionButton></div>}{readError && <p className="lp-business-error" role="alert">{readError}</p>}</Surface>;
}

const ledgerLabels = { SEED_CREDIT: '初始积分', ORDER_DEBIT: '订单扣除', ADJUSTMENT: '积分调整' } as const;
export function PointsLedgerRow({ entry }: { entry: BusinessLedgerEntry }) {
  return <div className="lp-ledger-row"><div><div className="lp-business-row"><strong>{entry.description}</strong><ValuePill>{ledgerLabels[entry.type]}</ValuePill></div><p className="lp-business-muted">{dateLabel(entry.createdAt)}</p></div><div className="lp-ledger-amount"><StatusPill dot={false} tone={entry.delta > 0 ? 'green' : entry.delta < 0 ? 'red' : 'neutral'}>{entry.delta > 0 ? '+' : ''}{entry.delta} 积分</StatusPill><p className="lp-business-muted">余额 {entry.balanceAfter}</p></div></div>;
}

export function PaginationBar({ page, totalPages, totalItems, busy = false, onChange }: { page: number; totalPages: number; totalItems: number; busy?: boolean; onChange: (page: number) => void }) {
  const valid = Number.isInteger(page) && page >= 1 && Number.isInteger(totalPages) && totalPages >= 0 && (totalPages === 0 ? page === 1 : page <= totalPages);
  return <nav className="lp-business-row lp-pagination" aria-label="列表分页"><span className="lp-business-muted">共 {totalItems} 条 · {totalPages === 0 ? '暂无页面' : `第 ${page} / ${totalPages} 页`}</span><div className="lp-business-row"><Button type="button" size="sm" disabled={busy || !valid || page <= 1 || totalPages === 0} onClick={() => onChange(page - 1)}>上一页</Button><Button type="button" size="sm" disabled={busy || !valid || page >= totalPages} onClick={() => onChange(page + 1)}>下一页</Button></div></nav>;
}

export function BusinessState({ kind, title, description, onRetry, busy = false }: { kind: 'loading' | 'empty' | 'error'; title?: string; description?: string; onRetry?: () => void; busy?: boolean }) {
  const labels = { loading: '正在加载', empty: '暂无数据', error: '加载失败' } as const;
  return <div className="lp-business-state" aria-busy={kind === 'loading' || busy}><div role={kind === 'error' ? 'alert' : 'status'}><StatusPill tone={kind === 'error' ? 'red' : 'neutral'}>{title ?? labels[kind]}</StatusPill>{description && <p className="lp-business-muted">{description}</p>}</div>{kind === 'error' && onRetry && <ActionButton size="sm" busy={busy} onClick={onRetry}>重试</ActionButton>}</div>;
}
