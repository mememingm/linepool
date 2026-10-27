export const adminPages = ['dashboard', 'users', 'numbers', 'products', 'orders', 'recharges', 'projects', 'receipts', 'agents', 'inventory', 'api-docs', 'webhooks'] as const;
export type AdminPage = (typeof adminPages)[number];
export const adminTitles: Record<AdminPage, string> = {
  dashboard: '管理概览', users: '用户管理', numbers: '号码管理', products: '商品管理', orders: '订单管理', recharges: '充值管理', projects: '平台项目', receipts: '收信记录',
  agents: '代理管理', inventory: '代理库存', 'api-docs': 'API 文档', webhooks: 'Webhook 管理',
};
/** One plain-language line under each page title, written for non-technical operators. */
export const adminDescriptions: Record<AdminPage, string> = {
  dashboard: '今天的经营情况和需要你处理的事情。',
  users: '查看注册用户、积分余额，必要时重置密码或禁用账号。',
  numbers: '卖给普通用户的号码：用户用积分下单后自动分配，也可以在这里手动分配、回收或下架。',
  products: '用户在前台看到的套餐和价格。国家和平台由上游提供，可一键同步。',
  orders: '用户用积分购买号码产生的订单。',
  recharges: '设置充值金额与积分的兑换规则，查看用户充值记录。',
  projects: '号码对应的平台（Google、Telegram、WhatsApp）配置。',
  receipts: '号码收到的短信记录，以及是否已送到用户收件箱。',
  agents: '代理和他们名下的客户。客户是挂在某个代理下面的终端用户。',
  inventory: '专门分给代理的号码池、代理持有的号码和代理余额。与「号码管理」是两套独立的号码。',
  'api-docs': '技术人员对接上游号码平台时参考的接口说明。',
  webhooks: '上游平台推送短信的接收地址和处理情况。',
};
/** Sidebar grouping; the advanced group is collapsed by default. */
export const adminNavGroups: { label: string; pages: AdminPage[]; advanced?: boolean }[] = [
  { label: '日常运营', pages: ['dashboard', 'orders', 'users', 'numbers'] },
  { label: '商品与价格', pages: ['products', 'recharges'] },
  { label: '代理', pages: ['agents', 'inventory'] },
  { label: '高级 · 技术对接', pages: ['projects', 'receipts', 'webhooks', 'api-docs'], advanced: true },
];
export function isAdminPath(path: string) {
  return path === '/admin' || adminPages.slice(1).some(page => path === `/admin/${page}`);
}
export function adminHref(page: AdminPage, filters: Record<string, string> = {}) {
  const query = new URLSearchParams(filters).toString();
  return `${page === 'dashboard' ? '/admin' : `/admin/${page}`}${query ? `?${query}` : ''}`;
}
