import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authEvents, queryClient, request } from "../lib/api";
import { authOptions, queryKeys } from "../lib/queries";
import { errorMessage, localDemo, type Account } from "../lib/models";
import { uiStore, useUIStore } from "../stores/ui-store";
import { toast as sonner } from "sonner";
import { Toaster } from "../components/ui/sonner";
interface AppValue {
  account: Account | null | undefined;
  checking: boolean;
  authError: string;
  retryAuth: () => void;
  acceptAccount: (account: Account) => Promise<void>;
  logout: (redirect?: { to: string; returnTo?: string }) => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}
const AppContext = createContext<AppValue | null>(null);
function Appearance() {
  const theme = useUIStore((state) => state.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
}
function Notifications() {
  const toast = useUIStore((state) => state.toast);
  const storageNotice = useUIStore((state) => state.storageNotice);
  useEffect(() => {
    if (!toast) return;
    sonner[toast.tone](toast.message, { id: toast.id, duration: 3600 });
    const timer = setTimeout(
      () => uiStore.getState().dismissToast(toast.id),
      3600,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <>
      {storageNotice && (
        <div className="notice danger storage-notice" role="alert">
          {storageNotice}
        </div>
      )}
      <Toaster position="bottom-right" closeButton richColors />
    </>
  );
}
export function AppProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const auth = useQuery(authOptions());
  const notify = uiStore.getState().notify;
  useEffect(() => {
    const expire = () => {
      void queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(queryKeys.auth(), null);
      uiStore.getState().resetSession();
      notify("登录状态已过期，请重新登录。", "error");
    };
    authEvents.addEventListener("expired", expire);
    return () => authEvents.removeEventListener("expired", expire);
  }, [notify]);
  const acceptAccount = useCallback(async (account: Account) => {
    const previous = queryClient.getQueryData<Account | null>(queryKeys.auth());
    await queryClient.cancelQueries();
    queryClient.clear();
    if (previous && previous.id !== account.id)
      uiStore.getState().resetSession();
    queryClient.setQueryData(queryKeys.auth(), account);
  }, []);
  const logout = useCallback(async (redirect?: { to: string; returnTo?: string }) => {
    if (localDemo()) {
      location.href = "/#/login";
      return;
    }
    try {
      await request("/auth/logout", { method: "POST", body: {} });
      await queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(queryKeys.auth(), null);
      uiStore.getState().resetSession();
      navigate(redirect?.to ?? "/", { state: redirect?.returnTo ? { returnTo: redirect.returnTo } : undefined });
    } catch {
      notify("退出未完成，请检查连接后重试。", "error");
    }
  }, [navigate, notify]);
  const retryAuth = useCallback(() => {
    void auth.refetch();
  }, [auth.refetch]);
  const value = useMemo<AppValue>(
    () => ({
      account: auth.data,
      checking: auth.isPending,
      authError: auth.isError
        ? errorMessage(auth.error, "账户服务暂时无法连接，请稍后重试。")
        : "",
      retryAuth,
      acceptAccount,
      logout,
      notify,
    }),
    [
      auth.data,
      auth.isPending,
      auth.isError,
      auth.error,
      retryAuth,
      acceptAccount,
      logout,
      notify,
    ],
  );
  return (
    <AppContext.Provider value={value}>
      <Appearance />
      {children}
      <Notifications />
    </AppContext.Provider>
  );
}
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider missing");
  return value;
}
