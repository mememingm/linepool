<script setup lang="ts">
import type { OrderDetail, Plan, ProjectDetail } from '@linepool/contracts';
import { ArrowLeft } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElInputNumber, ElMessage, ElTag } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useRouter } from 'vue-router';

import DataState from '../components/DataState.vue';
import { ApiClientError, apiRequest } from '../services/api-client.js';
import { useSessionStore } from '../stores/session.js';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const project = ref<ProjectDetail | null>(null);
const selectedPlanId = ref('');
const quantity = ref(1);
const isLoading = ref(true);
const errorMessage = ref('');
const purchaseError = ref('');
const isPurchasing = ref(false);
const idempotencyKey = ref(crypto.randomUUID());

const selectedPlan = computed<Plan | undefined>(() =>
  project.value?.plans.find((plan) => plan.id === selectedPlanId.value),
);
const totalPoints = computed(() => (selectedPlan.value?.unitPoints ?? 0) * quantity.value);
const maxQuantity = computed(() => Math.min(10, selectedPlan.value?.availableCount ?? 1));

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    project.value = await apiRequest<ProjectDetail>(`/projects/${String(route.params.id)}`);
    selectedPlanId.value = project.value.plans[0]?.id ?? '';
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载项目详情';
  } finally {
    isLoading.value = false;
  }
}

async function purchase(): Promise<void> {
  const plan = selectedPlan.value;
  if (!project.value || !plan) return;
  isPurchasing.value = true;
  purchaseError.value = '';
  try {
    const order = await apiRequest<OrderDetail>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.value.id,
        planId: plan.id,
        quantity: quantity.value,
        idempotencyKey: idempotencyKey.value,
      }),
    });
    await session.restore(true);
    ElMessage.success(`订单 ${order.orderNumber} 已完成`);
    idempotencyKey.value = crypto.randomUUID();
    await router.push({ name: 'orders', query: { created: order.orderNumber } });
  } catch (error) {
    purchaseError.value =
      error instanceof ApiClientError ? error.message : '下单失败，请稍后重试';
  } finally {
    isPurchasing.value = false;
  }
}

watch(() => route.params.id, load, { immediate: true });
watch([selectedPlanId, quantity], () => {
  idempotencyKey.value = crypto.randomUUID();
  purchaseError.value = '';
});
</script>

<template>
  <section class="page-section" aria-labelledby="project-title">
    <RouterLink class="back-link" :to="{ name: 'projects' }" aria-label="返回项目市场">
      <ElIcon><ArrowLeft /></ElIcon>
      返回项目市场
    </RouterLink>

    <DataState :is-loading="isLoading" :error-message="errorMessage" @retry="load">
      <template v-if="project">
        <div class="detail-hero">
          <div class="page-heading">
            <p class="eyebrow">{{ project.countryName }} / {{ project.countryCode }}</p>
            <h1 id="project-title">{{ project.name }}</h1>
            <p>{{ project.description }}</p>
          </div>
          <div class="inventory-note">
            <span>当前库存</span>
            <strong>{{ project.availableCount }}</strong>
            <ElTag effect="plain" type="info">演示号码</ElTag>
          </div>
        </div>

        <div class="purchase-layout">
          <section aria-labelledby="plans-title">
            <div class="section-heading-row">
              <div>
                <p class="section-kicker">PLANS</p>
                <h2 id="plans-title">选择套餐</h2>
              </div>
            </div>
            <div class="plan-list" role="radiogroup" aria-label="套餐">
              <button
                v-for="plan in project.plans"
                :key="plan.id"
                class="plan-option"
                :class="{ selected: selectedPlanId === plan.id }"
                type="button"
                role="radio"
                :aria-checked="selectedPlanId === plan.id"
                @click="selectedPlanId = plan.id"
              >
                <span>
                  <strong>{{ plan.name }}</strong>
                  <small>{{ plan.description }}</small>
                </span>
                <span class="plan-price">
                  <strong>{{ plan.unitPoints.toLocaleString('zh-CN') }}</strong>
                  <small>积分 / 个</small>
                </span>
              </button>
            </div>
          </section>

          <aside class="order-summary" aria-labelledby="summary-title">
            <p class="section-kicker">SUMMARY</p>
            <h2 id="summary-title">购买摘要</h2>
            <dl>
              <div><dt>项目</dt><dd>{{ project.name }}</dd></div>
              <div><dt>套餐</dt><dd>{{ selectedPlan?.name }}</dd></div>
              <div class="quantity-row">
                <dt>数量</dt>
                <dd>
                  <ElInputNumber
                    v-model="quantity"
                    :min="1"
                    :max="maxQuantity"
                    controls-position="right"
                    aria-label="购买数量"
                  />
                </dd>
              </div>
              <div class="summary-total">
                <dt>预计积分</dt>
                <dd>{{ totalPoints.toLocaleString('zh-CN') }}</dd>
              </div>
            </dl>
            <p v-if="purchaseError" class="form-error" role="alert">{{ purchaseError }}</p>
            <ElButton
              type="primary"
              size="large"
              :loading="isPurchasing"
              :disabled="!selectedPlan || selectedPlan.availableCount < quantity"
              @click="purchase"
            >
              确认购买
            </ElButton>
            <p>演示订单不会产生真实费用。</p>
          </aside>
        </div>
      </template>
    </DataState>
  </section>
</template>
