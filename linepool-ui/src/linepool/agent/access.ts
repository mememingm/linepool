import { useQuery } from '@tanstack/react-query';
import type { AgentContext, User } from '../api/contracts';
import { LinepoolApiError } from '../api/client';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { agentTier, type AgentTier } from './navigation';
import { agentError } from './subagent-shared';

/** Backend codes meaning "this user has no agent center": hide the entry rather than erroring. */
const notEnrolledCodes = ['AGENT_REQUIRED', 'NOT_ENROLLED'];
/** Enrolled, but the agent is SUSPENDED or TERMINATED: show the entry with an explanation. */
const inactiveCodes = ['ACTOR_NOT_ACTIVE'];

export type AgentAccess =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'none' }
  | { status: 'inactive'; message: string }
  | { status: 'error'; message: string }
  | { status: 'active'; user: User; context: AgentContext; tier: AgentTier };

/** Cache keys for agent-center data. Always scope by agent so switching accounts never reuses rows. */
export function agentQueryKey(agentId: string, ...parts: unknown[]) {
  return ['agent', agentId, ...parts] as const;
}
export function agentContextQueryKey(userId: string) {
  return ['agent-context', userId] as const;
}

function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: ({ signal }) => api.me({ signal }) }, queryClient);
}
function useAgentContextQuery(userId: string | undefined) {
  return useQuery({
    queryKey: agentContextQueryKey(userId ?? ''),
    queryFn: async ({ signal }) => (await api.agentContext({ signal })).data,
    enabled: Boolean(userId),
  }, queryClient);
}

function classify(user: User | undefined, context: AgentContext | undefined, cause: unknown, pending: boolean): AgentAccess {
  if (cause instanceof LinepoolApiError && cause.status === 401) return { status: 'signed-out' };
  if (cause instanceof LinepoolApiError && cause.status === 403) {
    if (notEnrolledCodes.includes(cause.code)) return { status: 'none' };
    if (inactiveCodes.includes(cause.code)) return { status: 'inactive', message: agentError(cause) };
  }
  if (cause) return { status: 'error', message: agentError(cause) };
  if (pending || !user || !context) return { status: 'loading' };
  if (context.agent.status !== 'ACTIVE') return { status: 'inactive', message: '当前代理已暂停或终止，请联系平台。' };
  return { status: 'active', user, context, tier: agentTier(context) };
}

/** Full session + agent identity, used by the agent center itself. */
export function useAgentAccess() {
  const session = useSession();
  const user = session.data?.data;
  const context = useAgentContextQuery(user?.id);
  const access = classify(user, context.data, session.error ?? context.error, session.isPending || (Boolean(user) && context.isPending));
  return { access, retry: () => void (session.error ? session.refetch() : context.refetch()) };
}

export type AgentEntry = { visible: false } | { visible: true; disabledReason: string | null };
/** Whether the ordinary workspace shows the 代理中心 entry. Never blocks or errors the workspace. */
export function useAgentEntry(userId: string | undefined): AgentEntry {
  const context = useAgentContextQuery(userId);
  const access = classify(undefined, undefined, context.error, false);
  if (access.status === 'inactive') return { visible: true, disabledReason: access.message };
  if (!context.data) return { visible: false };
  return context.data.agent.status === 'ACTIVE' ? { visible: true, disabledReason: null } : { visible: true, disabledReason: '当前代理已暂停或终止，请联系平台。' };
}
