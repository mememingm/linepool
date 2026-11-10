import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsFetching, useMutation, useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  completeOperation,
  operationKey,
  queryClient,
  request,
} from "../lib/api";
import {
  markCachedMessagesRead,
  queryKeys,
  seedResolvedLease,
  usePlans,
  workspaceOptions,
  workspaceScope,
} from "../lib/queries";
import {
  canRenew,
  errorMessage,
  localDemo,
  messagesForView,
  savedSelection,
  selectionKey,
  type MutationResult,
  type Snapshot,
} from "../lib/models";
import {
  createWorkspaceStore,
  type WorkspaceUIState,
} from "../stores/workspace-store";
import { useApp } from "./AppProvider";
import { usePointAccount, planPoints, pointKeys } from "../lib/points";
interface WorkspaceValue {
  data?: Snapshot;
  selectedId: string;
  requestedId: string;
  messages: ReturnType<typeof messagesForView>;
  loading: boolean;
  switching: boolean;
  error: string;
  refresh: () => Promise<void>;
  selectLease: (id: string) => void;
  readMessages: (id?: string) => Promise<void>;
  simulate: () => Promise<void>;
  reconcile: (id: string) => Promise<void>;
  busy: boolean;
  openRenew: (days?: number) => void;
  closeRenew: () => void;
  confirmRenew: () => Promise<void>;
  setScenesOpen: (open: boolean) => void;
  resetDemo: (scene: string) => void;
}
const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const WorkspaceUIContext = createContext<ReturnType<
  typeof createWorkspaceStore
> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { account, notify } = useApp();
  const terms = usePlans();
  const wallet = usePointAccount();
  const owner = account!.id,
    scope = workspaceScope(owner);
  const location = useLocation(),
    navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedId = params.get("leaseId") || savedSelection(owner);
  const [uiStore] = useState(createWorkspaceStore);
  const { closeRenew, setScenesOpen, reset } = uiStore.getState();
  const dialogOpen = useStore(
    uiStore,
    (state) => state.renewOpen || state.scenesOpen,
  );
  const lastGood = useRef<Snapshot | undefined>(undefined);
  const { mutateAsync, isPending: busy } = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const snapshot = useQuery({
    ...workspaceOptions(scope, requestedId),
    refetchInterval: (query) =>
      !busy && !dialogOpen && query.state.data?.bills.some(order => ["PENDING", "PROCESSING", "UNCERTAIN"].includes(order.status))
        ? 30_000
        : false,
    refetchIntervalInBackground: false,
  });
  const data = snapshot.data || lastGood.current;
  useEffect(() => {
    if (!snapshot.data) return;
    lastGood.current = snapshot.data;
    const id = snapshot.data.lease?.id || "";
    if (!requestedId)
      seedResolvedLease(
        queryClient,
        scope,
        snapshot.data,
        snapshot.dataUpdatedAt,
      );
    try {
      localStorage.setItem(selectionKey(owner), id);
    } catch {
      /* Keep the route selection when storage is unavailable. */
    }
    if (
      id &&
      !params.has("leaseId") &&
      ["/app/numbers", "/app/inbox", "/app/send", "/app/messages"].includes(location.pathname)
    ) {
      setParams(
        (previous) => {
          previous.set("leaseId", id);
          return previous;
        },
        { replace: true },
      );
    }
  }, [
    snapshot.data,
    snapshot.dataUpdatedAt,
    requestedId,
    scope,
    owner,
    location.pathname,
    params,
    setParams,
  ]);
  useEffect(() => {
    reset();
  }, [location.pathname, requestedId, reset]);
  const selectedId = data?.lease?.id || "";
  const switching = Boolean(requestedId && data && requestedId !== selectedId);
  const messages = useMemo(
    () => (data ? messagesForView(data) : []),
    [data],
  );
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.workspaces(scope),
      refetchType: "active",
    });
    await queryClient.invalidateQueries({queryKey: ["sms-chat", scope]});
    await queryClient.invalidateQueries({ queryKey: ["once-orders", owner] });
  }, [scope, owner]);
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      await mutateAsync(action).catch(() => undefined);
    },
    [busy, mutateAsync],
  );
  const selectLease = useCallback(
    (id: string) => {
      if (busy) return;
      const next = new URLSearchParams();
      next.set("leaseId", id);
      if (location.pathname === "/app/send" || params.has("compose"))
        next.set("compose", params.get("compose") === "mms" ? "mms" : "sms");
      navigate(`${location.pathname}?${next}`);
    },
    [busy, location.pathname, params, navigate],
  );
  const readMessages = useCallback(
    async (messageId = "") => {
      if (!data?.lease || switching) return;
      const leaseId = data.lease.id;
      try {
        if (localDemo()) await window.OnceMock!.markRead(leaseId, messageId);
        else {
          const ids = messages.filter(message => !messageId || message.id === messageId).map(message => message.id);
          for (let index = 0; index < ids.length; index += 200)
            await request(`/leases/${leaseId}/chat/read`, {method: "POST", body: {ids: ids.slice(index, index + 200)}});
          await queryClient.invalidateQueries({queryKey: ["sms-chat", scope, leaseId]});
        }
        markCachedMessagesRead(queryClient, scope, leaseId, messageId);
      } catch (error) {
        notify(errorMessage(error, "已读状态保存失败。"), "error");
      }
    },
    [data, switching, owner, messages, scope, notify],
  );
  const openRenew = useCallback(
    (days?: number) => {
      if (!data || !canRenew(data) || switching || busy) return;
      uiStore
        .getState()
        .openRenew(days ?? data.lease!.term, Math.max(Date.now(), Date.parse(data.lease!.expiresAt)));
    },
    [data, switching, busy, uiStore],
  );
  const confirmRenew = useCallback(
    () =>
      run(async () => {
        const { renewDays, renewBase, setRenewError } = uiStore.getState();
        setRenewError("");
        const chosen = terms.find(term => term.days === renewDays);
        const rechargeForRenew = async () => {
          if (!data?.lease || !chosen?.version) throw new Error("请重新确认续费报价。");
          const intent = await request<{ id: string }>("/points/intents", { method: "POST", body: { kind: "RENEW", leaseId: data.lease.id, term: renewDays, quoteVersion: chosen.version } });
          closeRenew(); navigate(`/app/points?intent=${encodeURIComponent(intent.id)}`);
        };
        try {
          if (!data || !canRenew(data) || switching)
            throw new Error("当前号码已释放、归档或租期待确认，暂不能续费。");
          if (!terms.some(term => term.days === renewDays) || !Number.isFinite(renewBase) || renewBase <= 0)
            throw new Error("请选择有效的续费套餐，并确认当前到期日期。");
          if (!localDemo() && !chosen?.version) throw new Error("续费报价尚未加载。");
          if (!localDemo() && wallet.data && chosen && wallet.data.availablePoints < planPoints(chosen)) { await rechargeForRenew(); return; }
          const signature = `renew:${data.lease!.id}:${renewDays}:${chosen?.version}:${data.lease!.expiresAt}`;
          const result = await request<MutationResult & { status?: string }>(
            `/leases/${encodeURIComponent(data.lease!.id)}/renew`,
            {
              method: "POST",
              headers: { "Idempotency-Key": operationKey(owner, signature) },
              body: { term: renewDays, ...(!localDemo() ? { quoteVersion: chosen?.version } : {}) },
            },
          );
          if (["DEMO_CONFIRMED", "CONFIRMED", "COMPLETED", "FAILED"].includes(result.status)) completeOperation(owner, signature);
          if (result.status === "FAILED") { await refresh(); await queryClient.invalidateQueries({ queryKey: pointKeys.all(owner) }); throw new Error("续费未完成，请查看订单与积分解冻记录。"); }
          closeRenew();
          await refresh();
          await queryClient.invalidateQueries({ queryKey: pointKeys.all(owner) });
          notify(["DEMO_CONFIRMED", "CONFIRMED", "COMPLETED"].includes(result.status ?? "") ? `同号续费已确认，站内租期增加 ${renewDays} 天。` : "订单正在处理，请在订单页查看结果。");
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "INSUFFICIENT_POINTS") { await rechargeForRenew(); return; }
          setRenewError(errorMessage(error));
          throw error;
        }
      }),
    [run, data, switching, closeRenew, uiStore, owner, refresh, notify, terms, wallet.data, navigate],
  );
  const simulate = useCallback(
    () => run(async () => {
      if (!data?.lease?.demo || data.lease.historicalOnly || switching) throw new Error("当前号码不支持模拟收信。");
      await request(`/leases/${encodeURIComponent(data.lease.id)}/demo-message`, { method: "POST", body: {} });
      await refresh();
      notify("模拟收信请求已完成，请查看消息记录。");
    }),
    [run, data, switching, refresh, notify],
  );
  const reconcile = useCallback(
    (id: string) =>
      run(async () => {
        if (!data) return;
        const path = `/purchases/${encodeURIComponent(id)}`;
        let result = await request<{ status: string; leaseId?: string }>(path);
        if (["PENDING", "PROCESSING", "UNCERTAIN"].includes(result.status))
          result = await request(`${path}/check`, { method: "POST", body: {} });
        await refresh();
        notify(
          ["DEMO_CONFIRMED", "CONFIRMED", "COMPLETED"].includes(result.status)
            ? "交付已确认，租约已保存。"
            : result.status === "FAILED"
              ? "交付失败，请稍后重试。"
              : "结果尚未确认，请稍后核对。",
        );
      }),
    [run, data, refresh, notify],
  );
  const resetDemo = useCallback(
    (scene: string) => {
      if (!localDemo() || busy) return;
      try {
        window.OnceMock!.reset(scene);
        const url = new URL(window.location.href);
        url.searchParams.set("scenario", scene);
        url.hash = "/app/numbers";
        window.location.assign(url.href);
        window.location.reload();
      } catch (error) {
        notify(errorMessage(error), "error");
      }
    },
    [busy, notify],
  );
  const loading = !data && snapshot.isPending;
  const error = snapshot.isError ? errorMessage(snapshot.error) : "";
  const value = useMemo<WorkspaceValue>(
    () => ({
      data,
      selectedId,
      requestedId,
      messages,
      loading,
      switching,
      error,
      refresh,
      selectLease,
      readMessages,
      simulate,
      reconcile,
      busy,
      openRenew,
      closeRenew,
      confirmRenew,
      setScenesOpen,
      resetDemo,
    }),
    [
      data,
      selectedId,
      requestedId,
      messages,
      loading,
      switching,
      error,
      refresh,
      selectLease,
      readMessages,
      simulate,
      reconcile,
      busy,
      openRenew,
      closeRenew,
      confirmRenew,
      setScenesOpen,
      resetDemo,
    ],
  );
  return (
    <WorkspaceUIContext.Provider value={uiStore}>
      <WorkspaceContext.Provider value={value}>
        {children}
      </WorkspaceContext.Provider>
    </WorkspaceUIContext.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider missing");
  return value;
}
export function useWorkspaceUI<T>(selector: (state: WorkspaceUIState) => T) {
  const store = useContext(WorkspaceUIContext);
  if (!store) throw new Error("WorkspaceProvider missing");
  return useStore(store, selector);
}
export function useWorkspaceRefreshing() {
  const { account } = useApp();
  const { requestedId } = useWorkspace();
  return (
    useIsFetching({
      queryKey: queryKeys.workspace(workspaceScope(account!.id), requestedId),
      exact: true,
    }) > 0
  );
}
