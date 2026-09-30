<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <section class="page-section" aria-labelledby="page-title">
    <div class="page-heading">
      <p class="eyebrow">LINEPOOL / 演示数据</p>
      <h1 id="page-title">{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div class="empty-panel" role="status">
      <span class="empty-line"></span>
      <h2>正在连接业务数据</h2>
      <p>页面结构已就绪，下一增量将接入 PostgreSQL 后端接口。</p>
    </div>
  </section>
</template>
