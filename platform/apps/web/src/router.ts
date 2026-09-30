import { createRouter, createWebHistory } from 'vue-router';

import { useSessionStore } from './stores/session.js';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('./layouts/AppShell.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
        { path: 'projects', name: 'projects', component: () => import('./views/ProjectsView.vue') },
        { path: 'projects/:id', name: 'project-detail', component: () => import('./views/ProjectDetailView.vue') },
        { path: 'orders', name: 'orders', component: () => import('./views/OrdersView.vue') },
        { path: 'numbers', name: 'numbers', component: () => import('./views/NumbersView.vue') },
        { path: 'inbox', name: 'inbox', component: () => import('./views/InboxView.vue') },
        { path: 'points', name: 'points', component: () => import('./views/PointsView.vue') },
        { path: 'account', name: 'account', component: () => import('./views/AccountView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.user && !session.isChecking) {
    await session.restore();
  }

  if (!to.meta.public && !session.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && session.isAuthenticated) {
    return { name: 'dashboard' };
  }
  return true;
});
