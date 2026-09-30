<script setup lang="ts">
import type { OrderSummary, Pagination } from '@linepool/contracts';
import { ElPagination, ElTag } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import DataState from '../components/DataState.vue';
import {
  ApiClientError,
  apiPaginatedRequest,
} from '../services/api-client.js';

const orders = ref<OrderSummary[]>([]);
const pagination = reactive<Pagination>({
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 0,
});
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

async function load(page = pagination.page): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiPaginatedRequest<OrderSummary>(
      `/orders?page=${page}&pageSize=${pagination.pageSize}`,
    );
    orders.value = response.data;
    Object.assign(pagination, response.pagination);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载订单';
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <section class="page-section" aria-labelledby="orders-title">
    <div class="page-heading">
      <p class="eyebrow">ORDERS / 演示数据</p>
      <h1 id="orders-title">订单</h1>
      <p>按时间查看已完成的演示购买与积分支出。</p>
    </div>

    <DataState
      :is-loading="isLoading"
      :error-message="errorMessage"
      :is-empty="orders.length === 0"
      empty-title="暂无订单"
      empty-description="从项目市场完成一次演示购买后，订单会显示在这里。"
      @retry="load()"
    >
      <div class="activity-list" aria-label="订单列表">
        <article v-for="order in orders" :key="order.id" class="activity-row">
          <div class="activity-main">
            <div class="activity-title-line">
              <h2>{{ order.project.name }}</h2>
              <ElTag type="success" effect="plain">已完成</ElTag>
            </div>
            <p>{{ order.plan.name }} · {{ order.quantity }} 个号码</p>
            <span>{{ order.orderNumber }}</span>
          </div>
          <dl class="activity-meta">
            <div>
              <dt>积分支出</dt>
              <dd>-{{ order.totalPoints.toLocaleString('zh-CN') }}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{{ formatDate(order.createdAt) }}</dd>
            </div>
          </dl>
        </article>
      </div>

      <ElPagination
        v-if="pagination.totalPages > 1"
        class="page-pagination"
        background
        layout="prev, pager, next"
        :current-page="pagination.page"
        :page-size="pagination.pageSize"
        :total="pagination.totalItems"
        @current-change="load"
      />
    </DataState>
  </section>
</template>
