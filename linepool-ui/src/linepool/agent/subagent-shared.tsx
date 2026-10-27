import type { ReactNode } from 'react';
import { z } from 'zod';
import { LinepoolApiError } from '../api/client';
import { Badge } from '../ui/badge';
import { ActionButton } from '../admin/primitives';

export function agentError(cause: unknown): string {
  if (cause instanceof z.ZodError) return '请检查输入：用户 ID 须为有效 UUID，名称为 1–120 字，操作原因不能为空。';
  if (cause instanceof LinepoolApiError) {
    const messages: Record<string, string> = {
      UNAUTHENTICATED: '登录已失效，请重新登录。', ACCOUNT_DISABLED: '用户账号已被禁用。',
      AGENT_REQUIRED: '当前账号不是代理，无法访问代理工作台。', NOT_ENROLLED: '当前账号尚未绑定代理身份。',
      ACTOR_NOT_ACTIVE: '当前代理已暂停或终止，请联系平台。', AGENT_NOT_ACTIVE: '目标代理已暂停或终止，请先核对代理状态。',
      PARENT_AGENT_NOT_ACTIVE: '上级代理已暂停或终止。', SUBAGENT_MANAGEMENT_REQUIRED: '仅一级代理可管理直属下级。',
      SUBAGENT_NOT_FOUND: '未找到该直属下级，或你无权访问。', OWNER_NOT_VISIBLE: '该对象不在你的管理范围内。',
      AGENT_STATUS_FORBIDDEN: '终止代理及恢复已终止代理需由平台处理。', MAX_AGENT_LEVEL: '二级代理不能再创建下级。',
      USER_NOT_FOUND: '未找到该用户，请确认目标账号已注册。', USER_NOT_ELIGIBLE: '请绑定正常启用的普通账号。',
      USER_ALREADY_ENROLLED: '该账号已经绑定代理或客户，请核对用户 ID。',
      IDEMPOTENCY_CONFLICT: '请求内容与之前的操作不一致，请核对后重新操作。',
      HOLDING_NOT_FOUND: '该号码已转交或退出库存，请刷新可转交列表。', HOLDING_NOT_ACTIVE: '该号码已不在可转交状态。',
      HOLDING_NOT_AVAILABLE: '该号码已到期或资源不可用，请重新选择。', HOLDING_WINDOW_EXCEEDED: '转交期限不能超过原号码或资源的到期时间。',
      HOLDING_WINDOW_INVALID: '转交开始时间不能早于原持有开始时间。', INVALID_HOLDING_WINDOW: '请填写有效的转交期限。',
      BATCH_TOO_LARGE: '筛选结果超过 10,000 个可划转号码，请按国家、平台或号码缩小范围后分批划转。',
      BATCH_EMPTY: '当前范围没有可划转号码，请调整筛选条件。',
      BATCH_SELECTION_CHANGED: '核对后库存发生变化，整批未划转。请返回修改，重新核对数量后确认。',
      BATCH_EXPIRY_REQUIRED: '所选号码包含长期号码，请填写统一到期时间后重试。',
      CUSTOMER_NOT_FOUND: '未找到可接收的直属客户。', CUSTOMER_NOT_ACTIVE: '目标客户已暂停或终止。',
      RESALE_SCOPE_INVALID: '号码只能转交给直属下级。', ADMIN_REQUIRED: '该操作仅平台管理员可执行。',
      REQUEST_TIMEOUT: '请求超时，结果尚未确认。请保留当前表单并重试，重试会复用原请求编号。',
      NETWORK_ERROR: '网络连接失败，请保留当前表单后重试。', INVALID_INPUT: '输入不符合要求，请检查后重试。',
      RATE_LIMITED: '操作过于频繁，请稍后重试。',
    };
    return messages[cause.code] ?? (cause.status === 403 ? '你没有执行此操作的权限。' : '请求未完成，请稍后重试。');
  }
  return '操作未完成，请稍后重试。';
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
