import type { PcAuthStartInput, PcConnection, PcMessage } from "@linepool/contracts";
import { request } from "./api";

export const pcStatus: Record<PcConnection["status"], string> = {
  ACTIVE: "已授权", UNAUTHORIZED: "尚未授权", REFRESHING: "正在续期",
  UNKNOWN: "授权结果待核对", REAUTH_REQUIRED: "需要重新登录",
};
export const pcCapability = { SMS_CODE: "验证码接收", NUMBER_LEASE: "号码租赁", SEND_SMS: "短信发送" };
export type PcMessagePage = { data: PcMessage[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
export function pcFractionDigits(currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export async function startPcAuth(purpose: PcAuthStartInput["purpose"]) {
  const result = await request<{ authorizeUrl: string }>("/pc/auth/start", { method: "POST", body: { purpose } });
  window.location.assign(result.authorizeUrl);
}
export function pcAuthError(code: string) {
  const messages: Record<string, string> = {
    PC_APP_NOT_ENABLED: "这个 PinClode 账号尚未开通本站应用，请在 PinClode 开通后重试。",
    APPLICATION_NOT_ENABLED: "这个 PinClode 账号尚未开通本站应用。",
    PC_APPLICATION_NOT_ENABLED: "这个 PinClode 账号尚未开通 ONCE 应用，请在 PinClode 开通后重试。",
    PC_IDENTITY_MISMATCH: "重新授权需要使用原来的 PinClode 账号。",
    IDENTITY_MISMATCH: "重新授权需要使用原来的 PinClode 账号。",
    PC_AUTH_EXPIRED: "授权已过期，请重新发起登录。",
    PC_AUTH_STATE_INVALID: "授权会话无效，请从本站重新登录。",
    PC_STATE_INVALID: "授权会话已过期、已使用或不属于当前浏览器，请从 ONCE 重新发起登录。",
  };
  return messages[code] ?? `PinClode 登录未完成（${code}），请重新发起登录。`;
}
