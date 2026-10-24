export const adminPages = ['dashboard', 'users', 'numbers', 'products', 'orders', 'recharges', 'projects', 'receipts', 'agents', 'inventory'] as const;
export type AdminPage = (typeof adminPages)[number];
export const adminTitles: Record<AdminPage, string> = {
  dashboard: '管理概览', users: '用户管理', numbers: '号码管理', products: '商品管理', orders: '订单管理', recharges: '充值管理', projects: '平台项目', receipts: '收信记录',
  agents: '代理管理', inventory: '代理库存',
};
export function isAdminPath(path: string) {
  return path === '/admin' || adminPages.slice(1).some(page => path === `/admin/${page}`);
}
export function adminHref(page: AdminPage, filters: Record<string, string> = {}) {
  const query = new URLSearchParams(filters).toString();
  return `${page === 'dashboard' ? '/admin' : `/admin/${page}`}${query ? `?${query}` : ''}`;
}
