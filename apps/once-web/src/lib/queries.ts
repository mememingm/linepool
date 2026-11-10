import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { ApiError, request } from "./api";
import {
  leaseModel,
  sourceKey,
  validateSnapshot,
  type Account,
  type PhoneNumber,
  type Snapshot,
  type Term,
} from "./models";

export const workspaceScope = (owner: string) => `${sourceKey()}:${owner}`;
export const queryKeys = {
  auth: () => ["auth", sourceKey()] as const,
  workspace: (scope: string, leaseId = "") =>
    ["state", scope, leaseId] as const,
  workspaces: (scope: string) => ["state", scope] as const,
  inventory: () => ["inventory", sourceKey()] as const,
  plans: () => ["plans", sourceKey()] as const,
};
export function retryTransientRead(failures: number, error: unknown) {
  return (
    failures < 1 &&
    ((error instanceof ApiError && error.status >= 500) ||
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "TimeoutError"))
  );
}
export const authOptions = () =>
  queryOptions({
    queryKey: queryKeys.auth(),
    queryFn: async ({ signal }) => {
      try {
        const account = await request<Account>("/auth/me", { signal });
        if (!account?.id || typeof account.email !== "string")
          throw new Error("账户数据格式不完整。");
        return account;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
export const workspaceOptions = (scope: string, requestedId: string) =>
  queryOptions({
    queryKey: queryKeys.workspace(scope, requestedId),
    queryFn: async ({ signal }) => {
      let value = validateSnapshot(
        await request<Snapshot>(
          `/state${requestedId ? `?leaseId=${encodeURIComponent(requestedId)}` : ""}`,
          { signal },
        ),
        requestedId,
      );
      if (
        !requestedId &&
        value.lease &&
        leaseModel(value.lease).status === "expired"
      ) {
        const active = value.leases.find((item) =>
          ["active", "warning"].includes(leaseModel(item).status),
        );
        if (active)
          value = validateSnapshot(
            await request<Snapshot>(
              `/state?leaseId=${encodeURIComponent(active.id)}`,
              { signal },
            ),
            active.id,
          );
      }
      return value;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: retryTransientRead,
    retryDelay: 500,
  });
export const inventoryOptions = () =>
  queryOptions({
    queryKey: queryKeys.inventory(),
    queryFn: async ({ signal }) => {
      const items = await request<PhoneNumber[]>("/inventory", { signal });
      if (!Array.isArray(items)) throw new Error("库存数据格式不完整。");
      return items;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: retryTransientRead,
    retryDelay: 500,
  });
// The unqualified initial response already contains this lease's complete details.
export function seedResolvedLease(
  client: QueryClient,
  scope: string,
  value: Snapshot,
  updatedAt: number,
) {
  if (!value.lease) return;
  const key = queryKeys.workspace(scope, value.lease.id);
  if ((client.getQueryState(key)?.dataUpdatedAt || 0) < updatedAt)
    client.setQueryData(key, value, { updatedAt });
}
export function markCachedMessagesRead(
  client: QueryClient,
  scope: string,
  leaseId: string,
  messageId = "",
) {
  client.setQueriesData<Snapshot>(
    { queryKey: queryKeys.workspaces(scope) },
    (previous) => {
      if (previous?.lease?.id !== leaseId) return previous;
      let changed = false;
      const messages = previous.messages.map((message) => {
        if (message.isRead || (messageId && message.id !== messageId))
          return message;
        changed = true;
        return { ...message, isRead: true, ...(Object.hasOwn(message, "readAt") ? {readAt: new Date().toISOString()} : {}) };
      });
      return changed ? { ...previous, messages } : previous;
    },
  );
}
export const plansOptions = () =>
  queryOptions({
    queryKey: queryKeys.plans(),
    queryFn: async ({ signal }) => {
      const items = await request<Term[]>("/plans", { signal });
      if (!Array.isArray(items)) throw new Error("套餐数据格式不完整。");
      return items;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: retryTransientRead,
    retryDelay: 500,
  });
export function usePlans(): Term[] {
  return useQuery(plansOptions()).data ?? [];
}
