export const agentPages = ['dashboard', 'customers', 'inventory', 'pricing', 'balance', 'ledger'] as const;
export type AgentPage = (typeof agentPages)[number];

export function isAgentPath(path: string) {
  return path === '/agent' || agentPages.slice(1).some(page => path === `/agent/${page}`);
}

export function agentHref(page: AgentPage = 'dashboard') {
  return page === 'dashboard' ? '/agent' : `/agent/${page}`;
}
