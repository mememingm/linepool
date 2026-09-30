<script setup lang="ts">
import { Lock, Message } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElInput } from 'element-plus';
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiClientError } from '../services/api-client.js';
import { useSessionStore } from '../stores/session.js';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const form = reactive({ email: '', password: '' });
const isSubmitting = ref(false);
const errorMessage = ref('');

async function submit(): Promise<void> {
  isSubmitting.value = true;
  errorMessage.value = '';
  try {
    await session.login(form);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '登录失败，请稍后重试';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-intro" aria-labelledby="login-title">
      <p class="eyebrow">LINEPOOL / TO C</p>
      <h1 id="login-title">号码服务，清晰掌控。</h1>
      <p class="login-copy">
        浏览项目、模拟购买，并在一个安静的工作台中查看订单、号码、积分与短信。
      </p>
      <ul class="login-points">
        <li><span>01</span> 数据由本地后端与 PostgreSQL 提供</li>
        <li><span>02</span> 下单状态刷新后保持一致</li>
        <li><span>03</span> 所有内容均为演示数据</li>
      </ul>
    </section>

    <section class="login-form-panel" aria-label="演示账号登录">
      <div>
        <p class="section-kicker">欢迎回来</p>
        <h2>登录演示账户</h2>
        <p>请输入本地 seed 配置的专用演示账号。</p>
      </div>
      <form @submit.prevent="submit">
        <label for="email">邮箱</label>
        <ElInput id="email" v-model="form.email" autocomplete="username" size="large">
          <template #prefix><ElIcon><Message /></ElIcon></template>
        </ElInput>
        <label for="password">密码</label>
        <ElInput
          id="password"
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          show-password
          size="large"
        >
          <template #prefix><ElIcon><Lock /></ElIcon></template>
        </ElInput>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <ElButton
          class="submit-button"
          type="primary"
          native-type="submit"
          size="large"
          :loading="isSubmitting"
        >
          进入 LINEPOOL
        </ElButton>
      </form>
      <p class="demo-note">仅用于本地演示，不使用现站或公司真实账号。</p>
    </section>
  </main>
</template>
