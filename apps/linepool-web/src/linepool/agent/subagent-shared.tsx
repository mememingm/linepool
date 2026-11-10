import type { ReactNode } from 'react';
import { z } from 'zod';
import { LinepoolApiError } from '../api/client';
import { Badge } from '../ui/badge';
import { ActionButton, regionName } from '../admin/primitives';
import { apiFailureMessage } from '../i18n/api-errors';
import { languageStore, type Locale } from '../preferences/store';

export function agentError(cause: unknown, locale: Locale = languageStore.getSnapshot()): string {
  if (cause instanceof z.ZodError) return locale === 'en-US' ? 'Please check the required fields, values and action reason.' : '请检查必填内容、数值范围和操作原因。';
  if (cause instanceof LinepoolApiError) {
    if (cause.code === 'INSUFFICIENT_BALANCE') {
      const amounts = z.object({ requiredMinor: z.number(), balanceMinor: z.number() }).safeParse(cause.details);
      if (amounts.success) {
        const required = (amounts.data.requiredMinor / 100).toFixed(2);
        const balance = (amounts.data.balanceMinor / 100).toFixed(2);
        return locale === 'en-US' ? `Insufficient balance: USD ${required} required, USD ${balance} available. Please contact your parent agent or the platform to add funds.` : `余额不足：需要 USD ${required}，当前 USD ${balance}。请联系上级或平台充值。`;
      }
    }
    if (cause.code === 'PRICE_NOT_SET') {
      const target = z.object({ service: z.string(), regionId: z.string() }).safeParse(cause.details);
      if (target.success) return locale === 'en-US' ? `No price is set for ${target.data.service} / ${target.data.regionId.toUpperCase()}. Please configure it in Products and Pricing.` : `还没有设置 ${target.data.service} / ${regionName(target.data.regionId)} 的价格，请先在“商品与价格”中设置。`;
    }
    return apiFailureMessage(cause.code, cause.status, locale);
  }
  return locale === 'en-US' ? 'The action could not be completed. Please try again later.' : '操作未完成，请稍后重试。';
}

export function formatAgentDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}
export function AgentStatus({ status }: { status: string }) {
  const label = status === 'ACTIVE' ? '启用' : status === 'SUSPENDED' ? '暂停' : '终止';
  return <Badge variant="outline" className={`subagent-status status-${status.toLowerCase()}`}><span aria-hidden="true" />{label}</Badge>;
}
export function AgentFeedback({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`agent-notice ${error ? 'warning' : 'success'}`} role={error ? 'alert' : 'status'}>{children}</div>;
}
export function AgentPager({ page, pageSize, totalItems, totalPages, busy, onChange }: {
  page: number; pageSize: number; totalItems: number; totalPages: number; busy: boolean;
  onChange: (page: number, pageSize: number) => void;
}) {
  return <nav className="lp-agent-pager subagent-pagination" aria-label="列表分页">
    <span>共 {totalItems} 条</span>
    <label>每页 <select aria-label="每页条数" value={pageSize} disabled={busy} onChange={event => onChange(1, Number(event.target.value))}>
      {[5, 10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}
    </select> 条</label>
    <span aria-live="polite">第 {totalPages ? page : 0} / {totalPages} 页</span>
    <ActionButton size="sm" disabled={busy || page <= 1} onClick={() => onChange(page - 1, pageSize)}>上一页</ActionButton>
    <ActionButton size="sm" disabled={busy || page >= totalPages} onClick={() => onChange(page + 1, pageSize)}>下一页</ActionButton>
  </nav>;
}
