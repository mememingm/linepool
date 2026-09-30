<script setup lang="ts">
import type { Account } from '@linepool/contracts';
import { ElButton, ElTag } from 'element-plus';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import DataState from '../components/DataState.vue';
import { ApiClientError, apiRequest } from '../services/api-client.js';
import { useSessionStore } from '../stores/session.js';

const router = useRouter();
const session = useSessionStore();
const account = ref<Account | null>(null);
const isLoading = ref(true);
const isLoggingOut = ref(false);
const errorMessage = ref('');

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    account.value = await apiRequest<Account>('/account');
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载账户资料';
  } finally {
    isLoading.value = false;
  }
}

async function logout(): Promise<void> {
  isLoggingOut.value = true;
  errorMessage.value = '';
  try {
    await session.logout();
    await router.replace({ name: 'login' });
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '退出失败，请稍后重试';
  } finally {
    isLoggingOut.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="page-section" aria-labelledby="account-title">
    <div class="page-heading">
      <p class="eyebrow">ACCOUNT / 演示数据</p>
      <h1 id="account-title">账户</h1>
      <p>查看当前演示账户的公开资料与会话状态。</p>
    </div>

    <DataState :is-loading="isLoading" :error-message="errorMessage" @retry="load">
      <template v-if="account">
        <section class="account-section" aria-labelledby="profile-title">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">PROFILE</p>
              <h2 id="profile-title">账户资料</h2>
            </div>
            <ElTag v-if="account.isDemo" type="info" effect="plain">演示账户</ElTag>
          </div>

          <dl class="account-list">
            <div>
              <dt>显示名称</dt>
              <dd>{{ account.displayName }}</dd>
            </div>
            <div>
              <dt>登录邮箱</dt>
              <dd>{{ account.email }}</dd>
            </div>
            <div>
              <dt>创建日期</dt>
              <dd>{{ formatDate(account.createdAt) }}</dd>
            </div>
          </dl>
        </section>

        <section class="account-actions" aria-labelledby="session-title">
          <div>
            <p class="section-kicker">SESSION</p>
            <h2 id="session-title">当前会话</h2>
            <p>退出后需要重新输入本地演示账户凭据。</p>
          </div>
          <ElButton :loading="isLoggingOut" @click="logout">安全退出</ElButton>
        </section>
      </template>
    </DataState>
  </section>
</template>
