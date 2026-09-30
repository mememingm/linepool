<script setup lang="ts">
import {
  ChatDotRound,
  Collection,
  House,
  Phone,
  Tickets,
  User,
  Wallet,
} from '@element-plus/icons-vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import PageMotion from '../components/PageMotion.vue';
import { usePreferencesStore } from '../stores/preferences.js';

const route = useRoute();
usePreferencesStore();
const navItems = [
  { name: 'dashboard', label: '首页', icon: House },
  { name: 'projects', label: '项目', icon: Collection },
  { name: 'numbers', label: '号码', icon: Phone },
  { name: 'orders', label: '订单', icon: Tickets },
  { name: 'inbox', label: '短信', icon: ChatDotRound },
  { name: 'points', label: '积分', icon: Wallet },
  { name: 'account', label: '账户', icon: User },
] as const;

const activeName = computed(() => {
  if (route.name === 'project-detail') return 'projects';
  if (route.name === 'order-detail') return 'orders';
  return String(route.name ?? 'dashboard');
});
</script>

<template>
  <div class="app-frame">
    <header class="mobile-header">
      <RouterLink class="brand" :to="{ name: 'dashboard' }">LINEPOOL</RouterLink>
      <div class="mobile-header-actions">
        <span class="demo-mark">演示数据</span>
        <RouterLink
          v-for="item in navItems.slice(5)"
          :key="item.name"
          class="mobile-utility-link"
          :class="{ active: activeName === item.name }"
          :to="{ name: item.name }"
          :aria-label="item.label"
          :title="item.label"
        >
          <component :is="item.icon" aria-hidden="true" />
        </RouterLink>
      </div>
    </header>

    <aside class="side-rail" aria-label="主导航">
      <RouterLink class="brand" :to="{ name: 'dashboard' }">LINEPOOL</RouterLink>
      <p class="brand-caption">个人号码工作台</p>
      <nav class="side-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          class="nav-link"
          :class="{ active: activeName === item.name }"
          :to="{ name: item.name }"
        >
          <component :is="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="rail-footer">
        <span>演示数据</span>
      </div>
    </aside>

    <main class="app-content">
      <RouterView v-slot="{ Component, route: currentRoute }">
        <PageMotion :key="currentRoute.fullPath">
          <component :is="Component" />
        </PageMotion>
      </RouterView>
    </main>

    <nav class="bottom-nav" aria-label="移动端主导航">
      <RouterLink
        v-for="item in navItems.slice(0, 5)"
        :key="item.name"
        class="bottom-link"
        :class="{ active: activeName === item.name }"
        :to="{ name: item.name }"
      >
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
