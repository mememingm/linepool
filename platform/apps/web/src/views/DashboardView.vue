<script setup lang="ts">
import type { Dashboard } from '@linepool/contracts';
import { ArrowRight } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElTag } from 'element-plus';
import { onMounted, ref } from 'vue';

import DataState from '../components/DataState.vue';
import { ApiClientError, apiRequest } from '../services/api-client.js';
import { useSessionStore } from '../stores/session.js';

const session = useSessionStore();
const dashboard = ref<Dashboard | null>(null);
const isLoading = ref(true);
const errorMessage = ref('');

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    dashboard.value = await apiRequest<Dashboard>('/dashboard');
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载首页数据';
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="page-section dashboard-page" aria-labelledby="dashboard-title">
    <div class="page-heading heading-row">
      <div>
        <p class="eyebrow">LINEPOOL / 演示数据</p>
        <h1 id="dashboard-title">你好，{{ session.user?.displayName }}</h1>
        <p>这里是你的号码服务摘要。</p>
      </div>
      <ElButton type="primary" @click="$router.push({ name: 'projects' })">
        浏览项目
        <ElIcon class="el-icon--right"><ArrowRight /></ElIcon>
      </ElButton>
    </div>

    <DataState :is-loading="isLoading" :error-message="errorMessage" @retry="load">
      <template v-if="dashboard">
        <div class="balance-band">
          <div>
            <span>可用积分</span>
            <strong>{{ dashboard.pointsBalance.toLocaleString('zh-CN') }}</strong>
          </div>
          <p>所有购买均为本地 mock 流程，不发生真实支付。</p>
        </div>

        <section class="content-section" aria-labelledby="recommended-title">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">PROJECTS</p>
              <h2 id="recommended-title">可用项目</h2>
            </div>
            <RouterLink class="text-link" :to="{ name: 'projects' }">查看全部</RouterLink>
          </div>
          <div class="project-grid">
            <RouterLink
              v-for="project in dashboard.availableProjects"
              :key="project.id"
              class="project-card"
              :to="{ name: 'project-detail', params: { id: project.id } }"
            >
              <div class="project-card-top">
                <span class="country-code">{{ project.countryCode }}</span>
                <ElTag effect="plain" type="info">库存 {{ project.availableCount }}</ElTag>
              </div>
              <h3>{{ project.name }}</h3>
              <p>{{ project.description }}</p>
              <div class="project-meta">
                <span>起价</span>
                <strong>{{ project.minPoints.toLocaleString('zh-CN') }} 积分</strong>
              </div>
            </RouterLink>
          </div>
        </section>

        <section class="content-section" aria-labelledby="recent-orders-title">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">ORDERS</p>
              <h2 id="recent-orders-title">最近订单</h2>
            </div>
            <RouterLink class="text-link" :to="{ name: 'orders' }">查看全部</RouterLink>
          </div>
          <div v-if="dashboard.recentOrders.length" class="simple-list">
            <div v-for="order in dashboard.recentOrders" :key="order.id" class="simple-list-row">
              <div>
                <strong>{{ order.project.name }}</strong>
                <span>{{ order.plan.name }} · {{ order.quantity }} 个号码</span>
              </div>
              <div class="row-tail">
                <strong>-{{ order.totalPoints.toLocaleString('zh-CN') }}</strong>
                <span>{{ formatDate(order.createdAt) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="inline-empty">暂无订单</div>
        </section>
      </template>
    </DataState>
  </section>
</template>
