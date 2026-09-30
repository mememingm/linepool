<script setup lang="ts">
import type { Pagination, SmsMessage } from '@linepool/contracts';
import { ElButton, ElPagination, ElTag } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import DataState from '../components/DataState.vue';
import {
  ApiClientError,
  apiPaginatedRequest,
  apiRequest,
} from '../services/api-client.js';

const messages = ref<SmsMessage[]>([]);
const pagination = reactive<Pagination>({
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 0,
});
const isLoading = ref(true);
const errorMessage = ref('');
const updatingId = ref('');

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function load(page = pagination.page): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiPaginatedRequest<SmsMessage>(
      `/inbox?page=${page}&pageSize=${pagination.pageSize}`,
    );
    messages.value = response.data;
    Object.assign(pagination, response.pagination);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载短信';
  } finally {
    isLoading.value = false;
  }
}

async function markRead(message: SmsMessage): Promise<void> {
  updatingId.value = message.id;
  try {
    const updated = await apiRequest<SmsMessage>(`/inbox/${message.id}/read`, {
      method: 'POST',
    });
    messages.value = messages.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法更新短信状态';
  } finally {
    updatingId.value = '';
  }
}

onMounted(() => load());
</script>

<template>
  <section class="page-section" aria-labelledby="inbox-title">
    <div class="page-heading">
      <p class="eyebrow">INBOX / 演示数据</p>
      <h1 id="inbox-title">短信收件箱</h1>
      <p>查看分配到当前账户的演示短信与验证码。</p>
    </div>

    <DataState
      :is-loading="isLoading"
      :error-message="errorMessage"
      :is-empty="messages.length === 0"
      empty-title="暂无短信"
      empty-description="演示号码收到的消息会按时间显示在这里。"
      @retry="load()"
    >
      <div class="activity-list" aria-label="短信列表" aria-live="polite">
        <article
          v-for="message in messages"
          :key="message.id"
          class="activity-row message-row"
          :class="{ unread: !message.isRead }"
        >
          <div class="activity-main message-content">
            <div class="activity-title-line">
              <h2>{{ message.sender }}</h2>
              <ElTag :type="message.isRead ? 'info' : 'primary'" effect="plain">
                {{ message.isRead ? '已读' : '未读' }}
              </ElTag>
            </div>
            <p>{{ message.body }}</p>
            <div class="message-source">
              <span>{{ message.phoneNumber }}</span>
              <span>{{ formatDate(message.receivedAt) }}</span>
            </div>
          </div>
          <div class="message-actions">
            <div v-if="message.verificationCode" class="verification-code">
              <span>验证码</span>
              <strong>{{ message.verificationCode }}</strong>
            </div>
            <ElButton
              v-if="!message.isRead"
              data-testid="mark-read"
              :loading="updatingId === message.id"
              @click="markRead(message)"
            >
              标记已读
            </ElButton>
          </div>
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
