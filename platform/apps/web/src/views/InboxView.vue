<script setup lang="ts">
import type { SmsMessage } from '@linepool/contracts';
import { Refresh } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElInput, ElPagination, ElTag } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import DataState from '../components/DataState.vue';
import { ApiClientError, apiRequest } from '../services/api-client.js';
import {
  filterDemoMessages,
  loadDemoInboxWorkspace,
  markAllDemoMessagesRead,
  type DemoInboxFilters,
  type DemoInboxRecord,
} from '../services/demo-inbox-service.js';

const AUTO_REFRESH_MS = 30_000;
const pageSize = 10;
const messages = ref<DemoInboxRecord[]>([]);
const page = ref(1);
const isLoading = ref(true);
const isRefreshing = ref(false);
const isMarkingAll = ref(false);
const updatingId = ref('');
const errorMessage = ref('');
const actionError = ref('');
const autoRefresh = ref(false);
const filters = reactive<DemoInboxFilters>({
  readStatus: '',
  projectId: '',
  phoneNumberId: '',
  keyword: '',
});
let refreshTimer: number | undefined;

const filteredMessages = computed(() => filterDemoMessages(messages.value, filters));
const visibleMessages = computed(() => {
  const start = (page.value - 1) * pageSize;
  return filteredMessages.value.slice(start, start + pageSize);
});
const unreadMessages = computed(() =>
  filteredMessages.value.filter((message) => !message.isRead));
const projectOptions = computed(() => {
  const projects = messages.value.flatMap((message) => message.project ? [message.project] : []);
  return [...new Map(projects.map((project) => [project.id, project])).values()];
});
const numberOptions = computed(() => {
  const available = filters.projectId
    ? messages.value.filter((message) => message.project?.id === filters.projectId)
    : messages.value;
  return [...new Map(available.map((message) => [message.phoneNumberId, {
    id: message.phoneNumberId,
    phoneNumber: message.phoneNumber,
  }])).values()];
});

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function load(initial = false): Promise<void> {
  if (initial) isLoading.value = true;
  else isRefreshing.value = true;
  errorMessage.value = '';
  actionError.value = '';
  try {
    messages.value = await loadDemoInboxWorkspace();
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载短信';
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
}

async function markRead(message: DemoInboxRecord): Promise<void> {
  updatingId.value = message.id;
  actionError.value = '';
  try {
    const updated = await apiRequest<SmsMessage>(`/inbox/${message.id}/read`, {
      method: 'POST',
    });
    messages.value = messages.value.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item);
  } catch (error) {
    actionError.value =
      error instanceof ApiClientError ? error.message : '无法更新短信状态';
  } finally {
    updatingId.value = '';
  }
}

async function markAllRead(): Promise<void> {
  if (!unreadMessages.value.length) return;
  isMarkingAll.value = true;
  actionError.value = '';
  try {
    const updated = await markAllDemoMessagesRead(unreadMessages.value);
    const updatedById = new Map(updated.map((message) => [message.id, message]));
    messages.value = messages.value.map((message) => {
      const next = updatedById.get(message.id);
      return next ? { ...message, ...next } : message;
    });
  } catch (error) {
    actionError.value =
      error instanceof ApiClientError ? error.message : '无法批量更新短信状态';
  } finally {
    isMarkingAll.value = false;
  }
}

function configureAutoRefresh(enabled: boolean): void {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
  refreshTimer = enabled
    ? window.setInterval(() => void load(false), AUTO_REFRESH_MS)
    : undefined;
}

watch(autoRefresh, configureAutoRefresh);
watch(
  () => [filters.readStatus, filters.projectId, filters.phoneNumberId, filters.keyword],
  () => {
    page.value = 1;
    if (filters.projectId
      && !numberOptions.value.some((number) => number.id === filters.phoneNumberId)) {
      filters.phoneNumberId = '';
    }
  },
);

onMounted(() => load(true));
onBeforeUnmount(() => {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
});
</script>

<template>
  <section class="page-section" aria-labelledby="inbox-title">
    <div class="page-heading page-heading-with-action">
      <div>
        <p class="eyebrow">INBOX / 演示数据</p>
        <h1 id="inbox-title">短信收件箱</h1>
        <p>筛选当前账户的演示短信，并按需刷新读取状态。</p>
      </div>
      <div class="heading-actions">
        <label class="toggle-control">
          <input
            v-model="autoRefresh"
            data-testid="auto-refresh"
            type="checkbox"
            role="switch"
            :aria-checked="autoRefresh"
          >
          <span>自动刷新</span>
        </label>
        <ElButton data-testid="refresh-inbox" :loading="isRefreshing" @click="load(false)">
          <ElIcon><Refresh /></ElIcon>
          手动刷新
        </ElButton>
      </div>
    </div>

    <div class="filter-panel inbox-filter-panel" aria-label="短信筛选">
      <label class="filter-field filter-field--search">
        <span>关键词</span>
        <ElInput v-model="filters.keyword" type="search" clearable placeholder="发送方、正文或验证码" />
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
        <span>号码</span>
        <select v-model="filters.phoneNumberId" class="native-select">
          <option value="">全部号码</option>
          <option v-for="number in numberOptions" :key="number.id" :value="number.id">
            {{ number.phoneNumber }}
          </option>
        </select>
      </label>
    </div>

    <div class="activity-toolbar activity-toolbar--split inbox-toolbar">
      <div class="segmented-control" role="group" aria-label="阅读状态">
        <button type="button" :class="{ active: filters.readStatus === '' }" :aria-pressed="filters.readStatus === ''" @click="filters.readStatus = ''">全部</button>
        <button type="button" :class="{ active: filters.readStatus === 'UNREAD' }" :aria-pressed="filters.readStatus === 'UNREAD'" @click="filters.readStatus = 'UNREAD'">未读</button>
        <button type="button" :class="{ active: filters.readStatus === 'READ' }" :aria-pressed="filters.readStatus === 'READ'" @click="filters.readStatus = 'READ'">已读</button>
      </div>
      <ElButton
        data-testid="mark-all-read"
        :disabled="unreadMessages.length === 0"
        :loading="isMarkingAll"
        @click="markAllRead"
      >
        全部已读
      </ElButton>
    </div>

    <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>

    <DataState
      :is-loading="isLoading"
      :error-message="errorMessage"
      :is-empty="filteredMessages.length === 0"
      empty-title="暂无匹配短信"
      empty-description="尝试调整筛选条件，演示号码收到的消息会显示在这里。"
      @retry="load(true)"
    >
      <div class="activity-list" aria-label="短信列表" aria-live="polite">
        <article
          v-for="message in visibleMessages"
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
              <span>{{ message.project?.name ?? '未知项目' }}</span>
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
        v-if="filteredMessages.length > pageSize"
        class="page-pagination"
        background
        layout="prev, pager, next"
        :current-page="page"
        :page-size="pageSize"
        :total="filteredMessages.length"
        @current-change="page = $event"
      />
    </DataState>
  </section>
</template>
