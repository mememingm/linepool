import type { ReactNode } from 'react';
import { Button } from '../vendor/beautiful/src/components/atoms/Button';
import { Chip } from '../vendor/beautiful/src/components/atoms/Chip';
import { EntityChip } from '../vendor/beautiful/src/components/atoms/EntityChip';
import { StatusPill } from '../vendor/beautiful/src/components/atoms/StatusPill';
import { TextRow } from '../vendor/beautiful/src/components/atoms/TextRow';
import { ValuePill } from '../vendor/beautiful/src/components/atoms/ValuePill';
import ContextCards from '../vendor/beautiful/src/components/primitives/ContextCards';
import LoadingState from '../vendor/beautiful/src/components/primitives/LoadingState';
import { ActionButton } from './components';
import { CopyValue, type BusinessProject, type BusinessPlan, type BusinessNumber, type BusinessSms, type OrderQuoteProps } from './business';

const dateLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date) + ' UTC';
};

export function BeautifulMetrics({ metrics }: { metrics: readonly { label: string; value: number; unit: string }[] }) {
  return <div className="lp-business-stack">{metrics.map(metric => <TextRow key={metric.label} label={metric.label} value={<ValuePill tone="accent">{metric.value.toLocaleString('zh-CN')}</ValuePill>} meta={metric.unit} />)}</div>;
}

/** ContextCards owns the card visuals; the selection action belongs to the host. */
export function BeautifulProjectCard({ project, onSelect }: { project: BusinessProject; onSelect?: (id: string) => void }) {
  const available = project.isActive && project.availableCount > 0;
  const status = !project.isActive ? '暂停服务' : available ? '可用' : '暂无库存';
  return <div className="lp-business-stack">
    <ContextCards labels={{ header: project.countryName, count: status }} chunks={[{
      title: project.name, chars: `${project.minPoints} 积分起`, body: project.description,
      source: `可用号码 ${project.availableCount}`, badge: '号', tone: available ? 'bg-green' : 'bg-ink-3',
    }]} />
    <div><Button type="button" variant="primary" disabled={!available || !onSelect} onClick={() => onSelect?.(project.id)}>选择项目</Button></div>
  </div>;
}

export function BeautifulPlanPicker({ plans, value, quantity = 1, onChange }: { plans: readonly BusinessPlan[]; value: string | null; quantity?: number; onChange: (id: string) => void }) {
  if (!plans.length) return <BeautifulBusinessState kind="empty" title="暂无套餐" description="该项目目前没有可选套餐。" />;
  return <div className="lp-business-stack" role="group" aria-label="选择套餐">{plans.map(plan => <div key={plan.id}>
    <TextRow label={<EntityChip name={plan.name} />} value={<Button type="button" size="sm" aria-pressed={value === plan.id} variant={value === plan.id ? 'primary' : 'secondary'} disabled={!plan.isActive || plan.availableCount < quantity} onClick={() => onChange(plan.id)}>{!plan.isActive ? '已停用' : plan.availableCount < quantity ? '库存不足' : value === plan.id ? '已选择' : '选择'}</Button>} />
    <p className="lp-business-muted">{plan.description}</p>
    <div className="lp-business-row"><ValuePill>{plan.unitPoints} 积分 / 号码</ValuePill><ValuePill>{plan.durationDays} 天</ValuePill><ValuePill>库存 {plan.availableCount}</ValuePill></div>
  </div>)}</div>;
}

export function BeautifulOrderQuote({ plan, quantity, balance, busy = false, error, onQuantityChange, onSubmit }: OrderQuoteProps) {
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 10;
  const total = plan && validQuantity ? plan.unitPoints * quantity : null;
  const issue = !plan ? '请先选择套餐' : !validQuantity ? '数量必须为 1–10 的整数' : !plan.isActive ? '套餐已停用' : plan.availableCount < quantity ? '套餐库存不足' : total !== null && total > balance ? '积分余额不足' : null;
  return <div className="lp-business-stack">
    <TextRow label="当前套餐" value={plan?.name ?? '尚未选择套餐'} />
    <div className="lp-business-row"><label>购买数量 <input className="lp-quantity-input" type="number" min={1} max={10} step={1} value={Number.isFinite(quantity) ? quantity : ''} disabled={busy} onChange={event => onQuantityChange(event.currentTarget.valueAsNumber)} /></label><ValuePill>余额 {balance} 积分</ValuePill></div>
    <div><TextRow label="本次扣除" value={total ?? '—'} meta="积分" /><TextRow label="购买后余额" value={issue || total === null ? '—' : balance - total} meta="积分" /></div>
    {issue && <div role="status"><StatusPill tone="orange">{issue}</StatusPill></div>}
    {error && <p className="lp-business-error" role="alert">{error}</p>}
    <div><ActionButton busy={busy} busyLabel="提交中…" variant="primary" disabled={Boolean(issue) || !onSubmit} onClick={() => { if (!issue && plan) onSubmit?.({ planId: plan.id, quantity }); }}>确认下单</ActionButton></div>
  </div>;
}

export function BeautifulNumberCard({ number, onOpenInbox, onCopy }: { number: BusinessNumber; onOpenInbox?: (id: string) => void; onCopy?: (value: string) => Promise<void> }) {
  return <div className="lp-business-stack">
    <ContextCards labels={{ header: number.project.name, count: number.status === 'ACTIVE' ? '使用中' : '已过期' }} chunks={[{
      title: number.phoneNumber, chars: '', body: `到期时间：${dateLabel(number.expiresAt)}`,
      source: number.status === 'ACTIVE' ? '当前号码可接收短信' : '可查看历史短信', badge: '号', tone: number.status === 'ACTIVE' ? 'bg-green' : 'bg-ink-3',
    }]} />
    <div className="lp-business-row"><CopyValue value={number.phoneNumber} label="复制号码" onCopy={onCopy} /><Button type="button" size="sm" disabled={!onOpenInbox} onClick={() => onOpenInbox?.(number.id)}>查看短信</Button></div>
  </div>;
}

export function BeautifulSmsMessageCard({ message, markingRead = false, readError, onMarkRead, onCopy }: { message: BusinessSms; markingRead?: boolean; readError?: string; onMarkRead?: (id: string) => void; onCopy?: (value: string) => Promise<void> }) {
  return <div className="lp-business-stack">
    <ContextCards labels={{ header: '短信收件箱', count: message.isRead ? '已读' : '未读' }} chunks={[{
      title: message.sender, chars: '', body: message.body,
      source: message.phoneNumber, badge: '信', tone: message.isRead ? 'bg-ink-3' : 'bg-accent',
    }]} />
    <p className="lp-business-muted">接收时间：{dateLabel(message.receivedAt)}</p>
    {message.verificationCode !== null && <div className="lp-business-row"><Chip tone="accent">{message.verificationCode}</Chip><CopyValue value={message.verificationCode} label="复制验证码" onCopy={onCopy} /></div>}
    {!message.isRead && <div><ActionButton size="sm" busy={markingRead} disabled={!onMarkRead} onClick={() => onMarkRead?.(message.id)}>标为已读</ActionButton></div>}
    {readError && <p className="lp-business-error" role="alert">{readError}</p>}
  </div>;
}

export function BeautifulBusinessState({ kind, title, description, onRetry, busy = false }: { kind: 'loading' | 'empty' | 'error'; title?: string; description?: ReactNode; onRetry?: () => void; busy?: boolean }) {
  const labels = { loading: '正在加载', empty: '暂无数据', error: '加载失败' } as const;
  return <div className="lp-business-stack" aria-busy={kind === 'loading' || busy}>
    <div role={kind === 'error' ? 'alert' : 'status'}>{kind === 'loading' ? <LoadingState label={title ?? labels.loading} variant="Dots" /> : <StatusPill tone={kind === 'error' ? 'red' : 'neutral'}>{title ?? labels[kind]}</StatusPill>}{description && <p className="lp-business-muted">{description}</p>}</div>
    {kind === 'error' && onRetry && <div><ActionButton size="sm" busy={busy} onClick={onRetry}>重试</ActionButton></div>}
  </div>;
}
