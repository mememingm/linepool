<script setup lang="ts">
import type { Pagination, PointLedgerEntry, PointsResponse } from '@linepool/contracts';
import { ElButton, ElPagination, ElTag } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import DataState from '../components/DataState.vue';
import {
  ApiClientError,
  apiEnvelopeRequest,
} from '../services/api-client.js';

const balance = ref(0);
const entries = ref<PointLedgerEntry[]>([]);
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

function typeLabel(type: PointLedgerEntry['type']): string {
  return {
    SEED_CREDIT: '初始积分',
    ORDER_DEBIT: '订单扣减',
    ADJUSTMENT: '余额调整',
  }[type];
}

async function load(page = pagination.page): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiEnvelopeRequest<PointsResponse>(
      `/points?page=${page}&pageSize=${pagination.pageSize}`,
    );
    balance.value = response.data.balance;
    entries.value = response.data.entries;
    Object.assign(pagination, response.pagination);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载积分记录';
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <section class="page-section" aria-labelledby="points-title">
    <div class="page-heading">
      <p class="eyebrow">POINTS / 演示数据</p>
      <h1 id="points-title">积分</h1>
      <p>核对当前余额与每一笔演示积分变化。</p>
    </div>

    <DataState :is-loading="isLoading" :error-message="errorMessage" @retry="load()">
      <div class="balance-band compact-balance">
        <div>
          <span>当前可用</span>
          <strong>{{ balance.toLocaleString('zh-CN') }}</strong>
        </div>
        <p>积分余额由后端事务维护，完成购买后会自动更新。</p>
      </div>

      <section class="content-section" aria-labelledby="ledger-title">
        <div class="section-heading-row">
          <div>
            <p class="section-kicker">LEDGER</p>
            <h2 id="ledger-title">积分流水</h2>
          </div>
          <ElButton disabled title="真实充值接口待提供">充值（待提供）</ElButton>
        </div>

        <div v-if="entries.length" class="activity-list activity-list--compact">
          <article v-for="entry in entries" :key="entry.id" class="activity-row">
            <div class="activity-main">
              <div class="activity-title-line">
                <h3>{{ entry.description }}</h3>
                <ElTag effect="plain" type="info">{{ typeLabel(entry.type) }}</ElTag>
              </div>
              <span>{{ formatDate(entry.createdAt) }}</span>
              <RouterLink
                v-if="entry.type === 'ORDER_DEBIT' && entry.referenceId"
                class="inline-record-link"
                :to="{ name: 'order-detail', params: { id: entry.referenceId } }"
              >
                查看关联订单
              </RouterLink>
            </div>
            <dl class="activity-meta">
              <div>
                <dt>变动</dt>
                <dd :class="entry.delta > 0 ? 'positive-value' : ''">
                  {{ entry.delta > 0 ? '+' : '' }}{{ entry.delta.toLocaleString('zh-CN') }}
                </dd>
              </div>
              <div>
                <dt>余额</dt>
                <dd>{{ entry.balanceAfter.toLocaleString('zh-CN') }}</dd>
              </div>
            </dl>
          </article>
        </div>
        <div v-else class="inline-empty" role="status">暂无积分流水</div>
      </section>

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
