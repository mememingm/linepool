import { createStore } from "zustand/vanilla";

export interface WorkspaceUIState {
  renewOpen: boolean;
  renewDays: number;
  renewBase: number;
  renewError: string;
  setRenewError: (error: string) => void;
  scenesOpen: boolean;
  openRenew: (days: number, expiresAt: number) => void;
  closeRenew: () => void;
  setRenewDays: (days: number) => void;
  setScenesOpen: (open: boolean) => void;
  reset: () => void;
}
const initialState = {
  renewOpen: false,
  renewDays: 7,
  renewBase: 0,
  renewError: "",
  scenesOpen: false,
};
export function createWorkspaceStore() {
  return createStore<WorkspaceUIState>()((set) => ({
    ...initialState,
    openRenew: (days, renewBase) =>
      set({ renewOpen: true, renewDays: days === 30 ? 30 : 7, renewBase, renewError: "" }),
    closeRenew: () => set({ renewOpen: false }),
    setRenewError: (renewError) => set({ renewError }),
    setRenewDays: (days) => set({ renewDays: days === 30 ? 30 : 7, renewError: "" }),
    setScenesOpen: (scenesOpen) => set({ scenesOpen }),
    reset: () => set(initialState),
  }));
}
