<script setup lang="ts">
import { ElButton, ElSkeleton, ElSkeletonItem } from 'element-plus';

defineProps<{
  isLoading: boolean;
  errorMessage?: string;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}>();

defineEmits<{ retry: [] }>();
</script>

<template>
  <Transition name="data-state" mode="out-in">
    <div v-if="isLoading" key="loading" class="loading-stack" aria-busy="true" aria-label="正在加载">
      <ElSkeleton v-for="index in 3" :key="index" animated>
        <template #template>
          <div class="skeleton-row">
            <ElSkeletonItem variant="text" class="skeleton-title" />
            <ElSkeletonItem variant="text" class="skeleton-detail" />
          </div>
        </template>
      </ElSkeleton>
    </div>
    <div v-else-if="errorMessage" key="error" class="state-panel" role="alert">
      <span class="state-rule state-rule--error"></span>
      <h2>数据加载失败</h2>
      <p>{{ errorMessage }}</p>
      <ElButton @click="$emit('retry')">重新加载</ElButton>
    </div>
    <div v-else-if="isEmpty" key="empty" class="state-panel" role="status">
      <span class="state-rule"></span>
      <h2>{{ emptyTitle ?? '暂无数据' }}</h2>
      <p>{{ emptyDescription ?? '当前没有可显示的内容。' }}</p>
    </div>
    <div v-else key="content" class="data-state-content"><slot /></div>
  </Transition>
</template>
