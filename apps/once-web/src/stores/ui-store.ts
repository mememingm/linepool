import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface WizardState {
  step: number;
  country: string;
  region: string;
  term: number;
  number: string;
  agreed: boolean;
}
export const initialWizard: WizardState = {
  step: 1,
  country: "US",
  region: "all",
  term: 0,
  number: "",
  agreed: false,
};
type Theme = "light" | "dark";
type Toast = { id: number; message: string; tone: "success" | "error" };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export interface UIState {
  theme: Theme;
  wizard: WizardState;
  toast: Toast | null;
  storageNotice: string;
  toggleTheme: () => void;
  setWizard: (
    update: WizardState | ((previous: WizardState) => WizardState),
  ) => void;
  notify: (message: string, tone?: "success" | "error") => void;
  dismissToast: (id: number) => void;
  resetSession: () => void;
}
function browserStorage() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
export function createUIStore(storage: Storage | undefined = browserStorage()) {
  let theme: Theme = "light";
  let nextToast = 0;
  try {
    const saved = JSON.parse(
      storage?.getItem("once-preferences-v1") ||
        storage?.getItem("once-new-demo-v1") ||
        "{}",
    );
    if (saved?.theme === "dark") theme = "dark";
  } catch {
    /* Invalid or unavailable preferences use the existing light default. */
  }
  return createStore<UIState>()((set) => ({
    theme,
    wizard: { ...initialWizard },
    toast: null,
    storageNotice: "",
    toggleTheme: () =>
      set((state) => {
        const next: Theme = state.theme === "light" ? "dark" : "light";
        let storageNotice = "";
        try {
          if (!storage) throw new Error("Storage unavailable");
          storage.setItem(
            "once-preferences-v1",
            JSON.stringify({ theme: next }),
          );
        } catch {
          storageNotice =
            "浏览器未能保存更改，当前操作仅保留在此页面，刷新后可能丢失。";
        }
        return { theme: next, storageNotice };
      }),
    setWizard: (update) =>
      set((state) => ({
        wizard: typeof update === "function" ? update(state.wizard) : update,
      })),
    notify: (message, tone = "success") =>
      set({ toast: { id: ++nextToast, message, tone } }),
    dismissToast: (id) =>
      set((state) => (state.toast?.id === id ? { toast: null } : state)),
    resetSession: () => set({ wizard: { ...initialWizard }, toast: null }),
  }));
}
export const uiStore = createUIStore();
export function useUIStore<T>(selector: (state: UIState) => T) {
  return useStore(uiStore, selector);
}
