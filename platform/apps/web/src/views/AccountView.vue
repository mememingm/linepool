<script setup lang="ts">
import type { Account } from '@linepool/contracts';
import { ElButton, ElInput, ElTag } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import DataState from '../components/DataState.vue';
import { validateDemoPassword } from '../services/account-demo-service.js';
import { ApiClientError, apiRequest } from '../services/api-client.js';
import { usePreferencesStore } from '../stores/preferences.js';
import { useSessionStore } from '../stores/session.js';

const router = useRouter();
const session = useSessionStore();
const preferences = usePreferencesStore();
const account = ref<Account | null>(null);
const isLoading = ref(true);
const isLoggingOut = ref(false);
const errorMessage = ref('');
const passwordMessage = ref('');
const passwordError = ref('');
const passwordForm = reactive({ current: '', next: '', confirmation: '' });

const languageLabel = computed(() => preferences.language === 'zh' ? '中文界面' : 'English interface');

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(preferences.language === 'zh' ? 'zh-CN' : 'en-US', {
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

function updateTheme(theme: 'light' | 'dark'): void {
  preferences.setTheme(theme);
}

function updateLanguage(language: 'zh' | 'en'): void {
  preferences.setLanguage(language);
}

function submitPassword(): void {
  passwordMessage.value = '';
  passwordError.value = '';
  const error = validateDemoPassword(
    passwordForm.current,
    passwordForm.next,
    passwordForm.confirmation,
  );
  if (error) {
    passwordError.value = error;
    return;
  }
  passwordMessage.value = '演示密码已更新，本地演示不会改变真实凭据。';
  passwordForm.current = '';
  passwordForm.next = '';
  passwordForm.confirmation = '';
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
      <h1 id="account-title">账户设置</h1>
      <p>管理界面偏好、演示安全能力和当前会话。</p>
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
            <div><dt>显示名称</dt><dd>{{ account.displayName }}</dd></div>
            <div><dt>登录邮箱</dt><dd>{{ account.email }}</dd></div>
            <div><dt>创建日期</dt><dd>{{ formatDate(account.createdAt) }}</dd></div>
          </dl>
        </section>

        <section class="settings-section" aria-labelledby="preferences-title">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">PREFERENCES</p>
              <h2 id="preferences-title">界面偏好</h2>
            </div>
            <span class="settings-current">{{ languageLabel }}</span>
          </div>
          <div class="settings-controls">
            <fieldset class="preference-fieldset">
              <legend>主题</legend>
              <div class="segmented-control" role="group" aria-label="主题">
                <button data-testid="theme-light" type="button" :class="{ active: preferences.theme === 'light' }" :aria-pressed="preferences.theme === 'light'" @click="updateTheme('light')">亮色</button>
                <button data-testid="theme-dark" type="button" :class="{ active: preferences.theme === 'dark' }" :aria-pressed="preferences.theme === 'dark'" @click="updateTheme('dark')">暗色</button>
              </div>
            </fieldset>
            <fieldset class="preference-fieldset">
              <legend>语言框架</legend>
              <div class="segmented-control" role="group" aria-label="界面语言">
                <button data-testid="language-zh" type="button" :class="{ active: preferences.language === 'zh' }" :aria-pressed="preferences.language === 'zh'" @click="updateLanguage('zh')">中文</button>
                <button data-testid="language-en" type="button" :class="{ active: preferences.language === 'en' }" :aria-pressed="preferences.language === 'en'" @click="updateLanguage('en')">English</button>
              </div>
            </fieldset>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="password-title">
          <div class="section-heading-row">
            <div>
              <p class="section-kicker">SECURITY</p>
              <h2 id="password-title">修改演示密码</h2>
              <p class="settings-description">此表单只验证本地演示密码，不会修改真实账户凭据。</p>
            </div>
          </div>
          <form class="settings-form" @submit.prevent="submitPassword">
            <label for="password-current">当前演示密码</label>
            <ElInput id="password-current" v-model="passwordForm.current" data-testid="password-current" type="password" show-password autocomplete="current-password" />
            <label for="password-new">新密码</label>
            <ElInput id="password-new" v-model="passwordForm.next" data-testid="password-new" type="password" show-password autocomplete="new-password" />
            <label for="password-confirm">确认新密码</label>
            <ElInput id="password-confirm" v-model="passwordForm.confirmation" data-testid="password-confirm" type="password" show-password autocomplete="new-password" />
            <p v-if="passwordError" class="form-error" role="alert">{{ passwordError }}</p>
            <p v-if="passwordMessage" role="status" class="form-success">{{ passwordMessage }}</p>
            <ElButton data-testid="password-submit" type="primary" native-type="submit">更新演示密码</ElButton>
          </form>
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
