import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { router } from './router.js';
import './styles/base.css';
import 'element-plus/theme-chalk/base.css';
import 'element-plus/theme-chalk/el-button.css';
import 'element-plus/theme-chalk/el-dialog.css';
import 'element-plus/theme-chalk/el-input.css';
import 'element-plus/theme-chalk/el-input-number.css';
import 'element-plus/theme-chalk/el-form.css';
import 'element-plus/theme-chalk/el-form-item.css';
import 'element-plus/theme-chalk/el-message.css';
import 'element-plus/theme-chalk/el-pagination.css';
import 'element-plus/theme-chalk/el-select.css';
import 'element-plus/theme-chalk/el-option.css';
import 'element-plus/theme-chalk/el-skeleton.css';
import 'element-plus/theme-chalk/el-skeleton-item.css';
import 'element-plus/theme-chalk/el-table.css';
import 'element-plus/theme-chalk/el-tag.css';

createApp(App).use(createPinia()).use(router).mount('#app');
