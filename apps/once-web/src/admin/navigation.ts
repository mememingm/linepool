import {
  ClipboardList, KeyRound, Tag, Wallet, Plug, LayoutDashboard, MessageSquareText, ScrollText, Smartphone, Users, Webhook,
  type LucideIcon,
} from "lucide-react";

export const adminPages = ["overview", "users", "numbers", "plans", "points", "leases", "orders", "messages", "integrations", "webhooks", "audit"] as const;
export type AdminPage = (typeof adminPages)[number];
export const adminTitles: Record<AdminPage, string> = {
  overview: "管理概览", users: "用户管理", numbers: "号码库存", plans: "套餐与价格", points: "积分与退款", leases: "租约管理",
  orders: "订单管理", messages: "短信记录", integrations: "上游接入", webhooks: "Webhook 事件", audit: "操作日志",
};
/** One plain-language line under each page title, written for operators rather than engineers. */
export const adminDescriptions: Record<AdminPage, string> = {
  overview: "今天的经营情况，以及需要你处理的事情。",
  users: "查看注册用户和他们的号码、订单；必要时重置密码或禁用账号。",
  numbers: "号码池里的全部号码。可以新增、批量导入，手动分配给用户，或释放 / 暂停售卖。",
  plans: "用户在首页、选号页和续费时看到的租期与价格。改价只影响之后的新订单。",
  points: "查看本站积分余额与充值，处理消费退积分和异常；历史现金退款只供查看。",
  leases: "用户租用号码的记录。可以给租约延期补偿，或提前回收号码。",
  orders: "租赁、续费和管理员手动开通产生的订单。",
  messages: "所有号码收到和发出的短信，用来排查用户反馈的收发问题。",
  integrations: "管理本站自营与代理连接，授权自营账号，并查看后台同步结果。",
  webhooks: "查看本地收件箱的归属、冲突与处理记录，重新处理可重试事件。",
  audit: "管理员做过的每一次修改：谁、什么时候、为什么。",
};
export const adminIcons: Record<AdminPage, LucideIcon> = {
  overview: LayoutDashboard, users: Users, numbers: Smartphone, plans: Tag, points: Wallet, leases: KeyRound, orders: ClipboardList,
  messages: MessageSquareText, integrations: Plug, webhooks: Webhook, audit: ScrollText,
};
export const adminNavGroups: { label: string; pages: AdminPage[] }[] = [
  { label: "日常运营", pages: ["overview", "users", "leases", "orders", "points"] },
  { label: "号码与商品", pages: ["numbers", "plans", "messages"] },
  { label: "技术与审计", pages: ["integrations", "webhooks", "audit"] },
];
export function adminHref(page: AdminPage, filters: Record<string, string> = {}) {
  const query = new URLSearchParams(filters).toString();
  return `/admin/${page}${query ? `?${query}` : ""}`;
}
export const auditLabels: Record<string, string> = {
  INTEGRATION_CONFIG_UPDATED: "修改上游配置", INTEGRATION_CHECK: "检查上游连接", INTEGRATION_SYNC: "同步上游号码",
  ADMIN_BOOTSTRAP: "授予管理员权限",
  POINTS_REFUND_APPROVED: "批准现金退款", POINTS_REFUND_REJECTED: "拒绝现金退款", POINTS_COMPENSATION_ADJUSTED: "调整补偿积分",
  ORDER_POINTS_REFUNDED: "退回消费积分", POINTS_RULES_UPDATED: "修改充值规则", POINTS_RECONCILED: "账户对账",
  UNCREDITED_RETURN_REQUESTED: "退回未入账款项", POINTS_EXCEPTION_RESOLVED: "记录异常核对结果",
  USER_STATUS: "修改用户状态", USER_PASSWORD_RESET: "重置用户密码", NUMBER_ASSIGN: "手动分配号码",
  NUMBER_HOLD: "暂停 / 恢复号码", NUMBER_RELEASE: "释放号码", NUMBER_CREATE: "新增号码", NUMBER_UPDATE: "编辑号码", NUMBER_DELETE: "删除号码",
  LEASE_END: "回收租约", LEASE_EXTEND: "租约延期", ONCE_PLAN_SAVE: "保存套餐", PLAN_CREATE: "新建套餐", PLAN_UPDATE: "编辑套餐", SETTINGS_UPDATE: "修改到期规则", WEBHOOK_RETRY: "重新处理事件",
};
