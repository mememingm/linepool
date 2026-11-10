import { useOutletContext } from "react-router-dom";
import type { ActionTarget } from "./actions";
import type { DetailTarget } from "./details";
import type { AdminNumber, AdminPlan, AdminQuery, AdminSettings } from "./types";

/** Editing forms, as opposed to the single-purpose confirmations in ActionTarget. */
export type FormTarget =
  | { kind: "plan"; plan: AdminPlan | null }
  | { kind: "number"; number: AdminNumber | null }
  | { kind: "import" }
  | { kind: "settings"; settings: AdminSettings };

/** What the admin layout hands each page: URL filters plus the shared drawer and dialogs. */
export interface AdminPageContext {
  input: AdminQuery;
  update: (key: string, value: string) => void;
  openDetail: (target: DetailTarget) => void;
  openAction: (target: ActionTarget) => void;
  openForm: (target: FormTarget) => void;
}
export const useAdminPage = () => useOutletContext<AdminPageContext>();
