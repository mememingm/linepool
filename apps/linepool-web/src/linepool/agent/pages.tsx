import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { AgentAccess } from './access';
import type { AgentPage, AgentRoute } from './navigation';

export type AgentPageProps = {
  access: Extract<AgentAccess, { status: 'active' }>;
  route: AgentRoute;
  address: string;
  revision: number;
};

export const agentPageComponents: Record<AgentPage, ComponentType<AgentPageProps> | LazyExoticComponent<ComponentType<AgentPageProps>>> = {
  dashboard: lazy(() => import('./dashboard/AgentDashboard')),
  agents: lazy(() => import('./pages/AgentsPage')),
  customers: lazy(() => import('./pages/CustomersPage')),
  inventory: lazy(() => import('./pages/InventoryPage')),
  products: lazy(() => import('./pages/ProductsPage')),
  orders: lazy(() => import('./pages/OrdersPage')),
  finance: lazy(() => import('./pages/FinancePage')),
  reports: lazy(() => import('./pages/ReportsPage')),
  settings: lazy(() => import('./pages/SettingsPage')),
};

export const agentFullBleedPages: AgentPage[] = ['dashboard'];
