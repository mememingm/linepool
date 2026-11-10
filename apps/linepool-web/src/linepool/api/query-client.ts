import { QueryClient } from '@tanstack/react-query';
import type { User } from './contracts';
import { createLinepoolApi } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: false, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

export const workspaceApi = createLinepoolApi();
// Keep focus/refetch management alive across route changes; the cache is cleared explicitly on logout/401.
queryClient.mount();

/** Seed the session and warm the first workspace queries before navigation. */
export async function primeWorkspace(user: User): Promise<void> {
  queryClient.setQueryData(['session'], { data: user });
  if (user.role === 'ADMIN' || user.authKind === 'PINCLODE') return;
  const key = (resource: string) => ['workspace', user.id, resource] as const;
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: key('account'),
      queryFn: async ({ signal }) => (await workspaceApi.account({ signal })).data,
    }),
    queryClient.prefetchQuery({
      queryKey: key('catalog'),
      queryFn: async ({ signal }) => (await workspaceApi.catalog({ signal })).data,
    }),
    queryClient.prefetchQuery({
      queryKey: [...key('dashboard'), 'overview'],
      queryFn: async ({ signal }) => (await workspaceApi.dashboardOverview({ signal })).data,
    }),
  ]);
}
