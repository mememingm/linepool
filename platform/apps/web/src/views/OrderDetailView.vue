<script setup lang="ts">
import type { OrderDetail } from '@linepool/contracts';
import { ArrowLeft } from '@element-plus/icons-vue';
import { ElIcon, ElTag } from 'element-plus';
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import DataState from '../components/DataState.vue';
import { ApiClientError, apiRequest } from '../services/api-client.js';

const route = useRoute();
const order = ref<OrderDetail | null>(null);
const isLoading = ref(true);
const errorMessage = ref('');

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    order.value = await apiRequest<OrderDetail>(`/orders/${String(route.params.id)}`);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载订单详情';
  } finally {
    isLoading.value = false;
  }
}

watch(() => route.params.id, load, { immediate: true });
</script>

<template>
  <section class="page-section" aria-labelledby="order-detail-title">
    <RouterLink class="back-link" :to="{ name: 'orders' }" aria-label="返回订单列表">
      <ElIcon><ArrowLeft /></ElIcon>
      返回订单列表
    </RouterLink>

    <DataState :is-loading="isLoading" :error-message="errorMessage" @retry="load">
      <template v-if="order">
        <div class="detail-hero order-detail-hero">
          <div class="page-heading">
            <p class="eyebrow">ORDER / 演示数据</p>
            <h1 id="order-detail-title">{{ order.orderNumber }}</h1>
            <p>核对本次演示购买、积分支出和关联号码。</p>
          </div>
          <ElTag :type="order.status === 'COMPLETED' ? 'success' : 'info'" effect="plain">
            {{ order.status === 'COMPLETED' ? '已完成' : '已取消' }}
          </ElTag>
        </div>

        <section class="content-section" aria-labelledby="order-overview-title">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">OVERVIEW</p>
              <h2 id="order-overview-title">订单信息</h2>
            </div>
          </div>
          <dl class="detail-facts">
            <div><dt>项目</dt><dd>{{ order.project.name }}</dd></div>
            <div><dt>套餐</dt><dd>{{ order.plan.name }}</dd></div>
            <div><dt>号码数量</dt><dd>{{ order.quantity }}</dd></div>
            <div><dt>积分支出</dt><dd>{{ order.totalPoints.toLocaleString('zh-CN') }}</dd></div>
            <div><dt>订单状态</dt><dd>{{ order.status === 'COMPLETED' ? '已完成' : '已取消' }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ formatDate(order.createdAt) }}</dd></div>
          </dl>
        </section>

        <section class="content-section" aria-labelledby="order-numbers-title">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">NUMBERS</p>
              <h2 id="order-numbers-title">关联号码</h2>
            </div>
          </div>
          <div v-if="order.numbers.length" class="activity-list activity-list--compact">
            <article v-for="number in order.numbers" :key="number.id" class="activity-row">
              <div class="activity-main">
                <div class="activity-title-line">
                  <h3 class="numeric-title">{{ number.phoneNumber }}</h3>
                  <ElTag :type="number.status === 'ACTIVE' ? 'success' : 'info'" effect="plain">
                    {{ number.status === 'ACTIVE' ? '使用中' : '已过期' }}
                  </ElTag>
                </div>
                <p>{{ number.project.name }}</p>
              </div>
              <dl class="activity-meta">
                <div><dt>分配时间</dt><dd>{{ formatDate(number.assignedAt) }}</dd></div>
                <div><dt>有效期至</dt><dd>{{ formatDate(number.expiresAt) }}</dd></div>
              </dl>
            </article>
          </div>
          <div v-else class="inline-empty" role="status">该订单没有关联号码</div>
        </section>
      </template>
    </DataState>
  </section>
</template>
