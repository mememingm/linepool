<script setup lang="ts">
import type { AssignedNumber, Pagination } from '@linepool/contracts';
import { ElPagination, ElTag } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import DataState from '../components/DataState.vue';
import {
  ApiClientError,
  apiPaginatedRequest,
} from '../services/api-client.js';

type NumberStatus = '' | 'ACTIVE' | 'EXPIRED';

const numbers = ref<AssignedNumber[]>([]);
const selectedStatus = ref<NumberStatus>('');
const pagination = reactive<Pagination>({
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 0,
});
const isLoading = ref(true);
const errorMessage = ref('');
const filters: Array<{ value: NumberStatus; label: string; testId: string }> = [
  { value: '', label: '全部', testId: 'status-all' },
  { value: 'ACTIVE', label: '使用中', testId: 'status-active' },
  { value: 'EXPIRED', label: '已过期', testId: 'status-expired' },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

async function load(page = pagination.page): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  const statusQuery = selectedStatus.value
    ? `&status=${selectedStatus.value}`
    : '';
  try {
    const response = await apiPaginatedRequest<AssignedNumber>(
      `/numbers?page=${page}&pageSize=${pagination.pageSize}${statusQuery}`,
    );
    numbers.value = response.data;
    Object.assign(pagination, response.pagination);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载号码';
  } finally {
    isLoading.value = false;
  }
}

function selectStatus(status: NumberStatus): void {
  if (selectedStatus.value === status) return;
  selectedStatus.value = status;
  void load(1);
}

onMounted(() => load());
</script>

<template>
  <section class="page-section" aria-labelledby="numbers-title">
    <div class="page-heading">
      <p class="eyebrow">NUMBERS / 演示数据</p>
      <h1 id="numbers-title">我的号码</h1>
      <p>查看通过演示订单分配的号码及其有效期。</p>
    </div>

    <div class="activity-toolbar">
      <div class="segmented-control" role="group" aria-label="号码状态">
        <button
          v-for="filter in filters"
          :key="filter.value"
          :data-testid="filter.testId"
          type="button"
          :class="{ active: selectedStatus === filter.value }"
          :aria-pressed="selectedStatus === filter.value"
          @click="selectStatus(filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </div>

    <DataState
      :is-loading="isLoading"
      :error-message="errorMessage"
      :is-empty="numbers.length === 0"
      empty-title="暂无匹配号码"
      empty-description="尝试切换状态，或先从项目市场完成一次演示购买。"
      @retry="load()"
    >
      <div class="activity-list" aria-label="号码列表">
        <article v-for="number in numbers" :key="number.id" class="activity-row">
          <div class="activity-main">
            <div class="activity-title-line">
              <h2 class="numeric-title">{{ number.phoneNumber }}</h2>
              <ElTag :type="number.status === 'ACTIVE' ? 'success' : 'info'" effect="plain">
                {{ number.status === 'ACTIVE' ? '使用中' : '已过期' }}
              </ElTag>
            </div>
            <p>{{ number.project.name }}</p>
          </div>
          <dl class="activity-meta">
            <div>
              <dt>分配日期</dt>
              <dd>{{ formatDate(number.assignedAt) }}</dd>
            </div>
            <div>
              <dt>有效期至</dt>
              <dd>{{ formatDate(number.expiresAt) }}</dd>
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
