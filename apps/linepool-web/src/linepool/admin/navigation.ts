export const adminPages = ['dashboard', 'users', 'numbers', 'platforms', 'products', 'orders', 'recharges', 'projects', 'receipts', 'agents', 'inventory', 'connections', 'api-docs', 'webhooks'] as const;
export type AdminPage = (typeof adminPages)[number];
export const adminTitles: Record<AdminPage, string> = {
  dashboard: '管理概览', users: '用户管理', numbers: '号码管理', platforms: '平台管理', products: '商品管理', orders: '订单管理', recharges: '充值管理', projects: '平台项目', receipts: '收信记录',
  agents: '历史代理与客户', inventory: '历史分销记录', connections: 'PC 连接', 'api-docs': 'API 文档', webhooks: 'Webhook 管理',
};
/** One plain-language line under each page title, written for non-technical operators. */
export const adminDescriptions: Record<AdminPage, string> = {
  dashboard: '今天的经营情况和需要你处理的事情。',
  users: '查看注册用户、积分余额，必要时重置密码或禁用账号。',
  numbers: '卖给普通用户的号码：用户用积分下单后自动分配，也可以在这里手动分配、回收或下架。',
  platforms: '用户在前台可选的平台（如 Telegram）。由你新增、改名或停用。',
  products: '各店铺在前台出售的商品。价格由店铺自己设置，管理员可在需要时下架。',
  orders: '用户用积分购买号码产生的订单。',
  recharges: '设置充值金额与积分的兑换规则，查看用户充值记录。',
  projects: '号码对应的平台项目，包括按平台管理自动生成的本地项目。',
  receipts: '号码收到的短信记录，以及是否已送到用户收件箱。',
  agents: '受保护的历史代理与客户资料。当前代理通过 PinClode 登录自己的连接。',
  inventory: '只读查看历史库存、持有、余额、价格与交易，保留原始记录。',
  connections: '本站自营与代理 PC 连接、授权期限、同步状态及自营授权入口。',
  'api-docs': '技术人员对接上游号码平台时参考的接口说明。',
  webhooks: '上游平台推送短信的接收地址和处理情况。',
};
/** Sidebar grouping; the advanced group is collapsed by default. */
export const adminNavGroups: { label: string; pages: AdminPage[]; advanced?: boolean }[] = [
  { label: '日常运营', pages: ['dashboard', 'orders', 'users', 'numbers'] },
  { label: '商品与价格', pages: ['platforms', 'products', 'recharges'] },
  { label: '连接与历史', pages: ['connections', 'agents', 'inventory'] },
  { label: '高级 · 技术对接', pages: ['projects', 'receipts', 'webhooks', 'api-docs'], advanced: true },
];
export function isAdminPath(path: string) {
  return path === '/admin' || adminPages.slice(1).some(page => path === `/admin/${page}`);
}
export function adminHref(page: AdminPage, filters: Record<string, string> = {}) {
  const query = new URLSearchParams(filters).toString();
  return `${page === 'dashboard' ? '/admin' : `/admin/${page}`}${query ? `?${query}` : ''}`;
}
