<script setup lang="ts">
import { ElButton, ElInput, ElPagination, ElTag } from 'element-plus';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import DataState from '../components/DataState.vue';
import { ApiClientError } from '../services/api-client.js';
import {
  createDemoRandomNumber,
  filterDemoNumbers,
  loadDemoNumberWorkspace,
  summarizeDemoNumbers,
  type DemoNumberFilters,
  type DemoNumberRecord,
  type DemoNumberWorkspace,
  type DemoRandomNumberResult,
} from '../services/demo-number-service.js';

const pageSize = 10;
const workspace = ref<DemoNumberWorkspace | null>(null);
const page = ref(1);
const isLoading = ref(true);
const errorMessage = ref('');
const randomError = ref('');
const randomResult = ref<DemoRandomNumberResult | null>(null);
const filters = reactive<DemoNumberFilters>({
  query: '',
  projectId: '',
  planId: '',
  status: '',
});
const statuses: Array<{
  value: DemoNumberFilters['status'];
  label: string;
  testId: string;
}> = [
  { value: '', label: '全部', testId: 'status-all' },
  { value: 'ACTIVE', label: '使用中', testId: 'status-active' },
  { value: 'EXPIRED', label: '已过期', testId: 'status-expired' },
];

const records = computed(() => workspace.value?.records ?? []);
const filteredRecords = computed(() => filterDemoNumbers(records.value, filters));
const visibleRecords = computed(() => {
  const start = (page.value - 1) * pageSize;
  return filteredRecords.value.slice(start, start + pageSize);
});
const summary = computed(() => summarizeDemoNumbers(records.value));
const projectOptions = computed(() => {
  const unique = new Map(records.value.map((record) => [record.project.id, record.project]));
  return [...unique.values()];
});
const planOptions = computed(() => {
  const available = filters.projectId
    ? records.value.filter((record) => record.project.id === filters.projectId)
    : records.value;
  const unique = new Map(available.map((record) => [record.plan.id, record.plan]));
  return [...unique.values()].filter((plan) => plan.id);
});

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status: DemoNumberRecord['status']): string {
  return {
    ACTIVE: '使用中',
    EXPIRED: '已过期',
  }[status];
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    workspace.value = await loadDemoNumberWorkspace();
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载号码';
  } finally {
    isLoading.value = false;
  }
}

function selectStatus(status: DemoNumberFilters['status']): void {
  filters.status = status;
}

function requestRandomNumber(): void {
  randomError.value = '';
  randomResult.value = null;
  try {
    randomResult.value = createDemoRandomNumber(
      workspace.value?.projects ?? [],
      filters.projectId,
    );
  } catch (error) {
    randomError.value = error instanceof Error ? error.message : '无法生成演示号码';
  }
}

watch(
  () => [filters.query, filters.projectId, filters.planId, filters.status],
  () => {
    page.value = 1;
    if (filters.projectId && !planOptions.value.some((plan) => plan.id === filters.planId)) {
      filters.planId = '';
    }
  },
);

onMounted(load);
</script>

<template>
  <section class="page-section" aria-labelledby="numbers-title">
    <div class="page-heading page-heading-with-action">
      <div>
        <p class="eyebrow">NUMBERS / 演示数据</p>
        <h1 id="numbers-title">我的号码</h1>
        <p>搜索、筛选并查看通过演示订单分配的号码。</p>
      </div>
      <ElButton data-testid="random-number" type="primary" @click="requestRandomNumber">
        随机取码
      </ElButton>
    </div>

    <div v-if="randomResult" data-testid="random-result" class="demo-result" role="status">
      <div>
        <strong>演示随机结果</strong>
        <span>{{ randomResult.project.name }} · {{ randomResult.phoneNumber }}</span>
      </div>
      <p>该号码来自本地 mock service，不占用库存、不创建订单，也不会产生真实费用。</p>
    </div>
    <p v-if="randomError" class="form-error" role="alert">{{ randomError }}</p>

    <dl class="summary-strip" aria-label="号码摘要">
      <div><dt>全部</dt><dd>{{ summary.total }}</dd></div>
      <div><dt>使用中</dt><dd>{{ summary.active }}</dd></div>
      <div><dt>已过期</dt><dd>{{ summary.expired }}</dd></div>
    </dl>

    <div class="filter-panel" aria-label="号码筛选">
      <label class="filter-field filter-field--search">
        <span>搜索号码</span>
        <ElInput v-model="filters.query" type="search" clearable placeholder="号码、项目或套餐" />
      </label>
      <label class="filter-field">
        <span>项目</span>
        <select v-model="filters.projectId" class="native-select">
          <option value="">全部项目</option>
          <option v-for="project in projectOptions" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label class="filter-field">
        <span>套餐</span>
        <select v-model="filters.planId" class="native-select">
          <option value="">全部套餐</option>
          <option v-for="plan in planOptions" :key="plan.id" :value="plan.id">
            {{ plan.name }}
          </option>
        </select>
      </label>
    </div>

    <div class="activity-toolbar activity-toolbar--split">
      <div class="segmented-control" role="group" aria-label="号码状态">
        <button
          v-for="status in statuses"
          :key="status.value"
          :data-testid="status.testId"
          type="button"
          :class="{ active: filters.status === status.value }"
          :aria-pressed="filters.status === status.value"
          @click="selectStatus(status.value)"
        >
          {{ status.label }}
        </button>
      </div>
      <span class="result-count">{{ filteredRecords.length }} 个结果</span>
    </div>

    <DataState
      :is-loading="isLoading"
      :error-message="errorMessage"
      :is-empty="filteredRecords.length === 0"
      empty-title="暂无匹配号码"
      empty-description="尝试调整搜索或筛选条件，或先从项目市场完成一次演示购买。"
      @retry="load"
    >
      <div class="activity-list" aria-label="号码列表">
        <article v-for="number in visibleRecords" :key="number.id" class="activity-row">
          <div class="activity-main">
            <div class="activity-title-line">
              <h2 class="numeric-title">{{ number.phoneNumber }}</h2>
              <ElTag :type="number.status === 'ACTIVE' ? 'success' : 'info'" effect="plain">
                {{ statusLabel(number.status) }}
              </ElTag>
            </div>
            <p>{{ number.project.name }} · {{ number.plan.name }}</p>
            <RouterLink
              class="inline-record-link"
              :to="{ name: 'order-detail', params: { id: number.orderId } }"
            >
              查看来源订单
            </RouterLink>
          </div>
          <dl class="activity-meta">
            <div><dt>分配日期</dt><dd>{{ formatDate(number.assignedAt) }}</dd></div>
            <div><dt>有效期至</dt><dd>{{ formatDate(number.expiresAt) }}</dd></div>
          </dl>
        </article>
      </div>

      <ElPagination
        v-if="filteredRecords.length > pageSize"
        class="page-pagination"
        background
        layout="prev, pager, next"
        :current-page="page"
        :page-size="pageSize"
        :total="filteredRecords.length"
        @current-change="page = $event"
      />
    </DataState>
  </section>
</template>
