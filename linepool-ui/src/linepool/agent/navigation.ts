import type { AgentContext } from '../api/contracts';

/** Agent center routes. The layout mirrors /admin; tiers differ only by menu and data scope. */
export const agentPages = ['dashboard', 'agents', 'customers', 'inventory', 'products', 'orders', 'finance', 'reports', 'settings'] as const;
export type AgentPage = (typeof agentPages)[number];

/** PARTNER = 合作伙伴代理（一级，平台直签）; SUBAGENT = 下级代理（二级）. */
export type AgentTier = 'PARTNER' | 'SUBAGENT';
export const agentTierLabels: Record<AgentTier, string> = { PARTNER: '合作伙伴代理', SUBAGENT: '下级代理' };

export function agentTier(context: AgentContext): AgentTier {
  return context.agent.level === 1 ? 'PARTNER' : 'SUBAGENT';
}

const partnerTitles: Record<AgentPage, string> = {
  dashboard: '代理概览', agents: '代理管理', customers: '客户管理', inventory: '库存管理', products: '商品与价格',
  orders: '订单管理', finance: '财务流水', reports: '数据报表', settings: '代理设置',
};
const subagentTitles: Record<AgentPage, string> = {
  ...partnerTitles, inventory: '我的库存', orders: '我的订单', finance: '我的财务',
};
export function agentPageTitle(page: AgentPage, tier: AgentTier) {
  return (tier === 'PARTNER' ? partnerTitles : subagentTitles)[page];
}

/** Pages an agent may open. `agents` follows the backend capability, not just the level. */
export function agentAllowedPages(context: AgentContext): AgentPage[] {
  return agentPages.filter(page => page !== 'agents' || context.capabilities.manageSubagents);
}
export type AgentMenuGroup = { label: string; pages: AgentPage[] };
export function agentMenu(context: AgentContext): AgentMenuGroup[] {
  const allowed = new Set(agentAllowedPages(context));
  const groups: AgentMenuGroup[] = [
    { label: '代理中心', pages: ['dashboard', 'agents', 'customers', 'inventory', 'products', 'orders', 'finance', 'reports'] },
    { label: '设置', pages: ['settings'] },
  ];
  return groups.map(group => ({ ...group, pages: group.pages.filter(page => allowed.has(page)) })).filter(group => group.pages.length);
}

export type AgentRoute = { page: AgentPage; subagentId: string | null };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Paths from the retired tabbed agent workspace, kept so old links still land somewhere sensible. */
const legacyPages: Record<string, AgentPage> = { subagents: 'agents', pricing: 'products', balance: 'finance', ledger: 'finance' };

export function parseAgentPath(path: string): AgentRoute | null {
  if (path === '/agent') return { page: 'dashboard', subagentId: null };
  const [, root, segment, id, ...rest] = path.split('/');
  if (root !== 'agent' || !segment || rest.length) return null;
  const page = legacyPages[segment] ?? segment;
  if (!(agentPages as readonly string[]).includes(page)) return null;
  if (id === undefined) return { page: page as AgentPage, subagentId: null };
  return page === 'agents' && uuidPattern.test(id) ? { page: 'agents', subagentId: id.toLowerCase() } : null;
}
export function isAgentPath(path: string) {
  return parseAgentPath(path) !== null;
}
/** Canonical address for a legacy agent path, or null when the path is already canonical. */
export function canonicalAgentPath(path: string): string | null {
  const segment = path.split('/')[2];
  if (!segment || !legacyPages[segment]) return null;
  const route = parseAgentPath(path);
  return route ? (route.subagentId ? subagentHref(route.subagentId) : agentHref(route.page)) : null;
}

export function agentHref(page: AgentPage = 'dashboard', filters: Record<string, string> = {}) {
  const query = new URLSearchParams(filters).toString();
  return `${page === 'dashboard' ? '/agent' : `/agent/${page}`}${query ? `?${query}` : ''}`;
}
export function subagentHref(id: string, search = '') {
  return `/agent/agents/${encodeURIComponent(id)}${search}`;
}
