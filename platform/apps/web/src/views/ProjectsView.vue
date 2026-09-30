<script setup lang="ts">
import type { Pagination, ProjectSummary } from '@linepool/contracts';
import { ArrowRight } from '@element-plus/icons-vue';
import { ElIcon, ElPagination, ElTag } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import DataState from '../components/DataState.vue';
import {
  ApiClientError,
  apiPaginatedRequest,
} from '../services/api-client.js';

const projects = ref<ProjectSummary[]>([]);
const pagination = reactive<Pagination>({
  page: 1,
  pageSize: 6,
  totalItems: 0,
  totalPages: 0,
});
const isLoading = ref(true);
const errorMessage = ref('');

async function load(page = pagination.page): Promise<void> {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiPaginatedRequest<ProjectSummary>(
      `/projects?page=${page}&pageSize=${pagination.pageSize}`,
    );
    projects.value = response.data;
    Object.assign(pagination, response.pagination);
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError ? error.message : '无法加载项目';
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <section class="page-section" aria-labelledby="projects-title">
    <div class="page-heading">
      <p class="eyebrow">PROJECT MARKET / 演示数据</p>
      <h1 id="projects-title">项目市场</h1>
      <p>比较不同地区的套餐、积分价格与当前库存。</p>
    </div>

    <DataState
      :is-loading="isLoading"
      :error-message="errorMessage"
      :is-empty="projects.length === 0"
      empty-title="暂无可用项目"
      empty-description="当前没有已上架且有库存的演示项目。"
      @retry="load()"
    >
      <div class="project-grid project-grid--market">
        <RouterLink
          v-for="project in projects"
          :key="project.id"
          class="project-card project-card--large"
          :to="{ name: 'project-detail', params: { id: project.id } }"
        >
          <div class="project-card-top">
            <span class="country-code">{{ project.countryCode }}</span>
            <ElTag :type="project.availableCount > 0 ? 'info' : 'warning'" effect="plain">
              {{ project.availableCount > 0 ? `库存 ${project.availableCount}` : '暂时缺货' }}
            </ElTag>
          </div>
          <div>
            <span class="project-country">{{ project.countryName }}</span>
            <h2>{{ project.name }}</h2>
            <p>{{ project.description }}</p>
          </div>
          <div class="project-meta">
            <div>
              <span>最低</span>
              <strong>{{ project.minPoints.toLocaleString('zh-CN') }} 积分</strong>
            </div>
            <ElIcon aria-hidden="true"><ArrowRight /></ElIcon>
          </div>
        </RouterLink>
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
