/**
 * query-client.ts 中文分区导读副本：前端查询缓存与预加载
 * 原文件：src/linepool/api/query-client.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。前端使用浏览器 fetch 发送请求，或使用查询工具管理结果缓存。
 * 【整体用途】管理接口结果的内存缓存，并在进入工作台前预取账户、目录和概览。
 * 【为什么这样组织】把缓存策略集中设置，减少路由切换时重复请求；查询缓存与浏览器 HTTP 缓存是两层配置。
 * 【调用链】登录成功 → primeWorkspace → 写入 session 缓存并预取工作台资料 → 页面读取。
 * 【修改提示】staleTime: 60_000 是 60 秒内视为新鲜；retry: false 是不自动重试。更改默认值时核对页面自己的查询配置。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { QueryClient } from '@tanstack/react-query';
import type { User } from '../../../../src/linepool/api/contracts';
import { createLinepoolApi } from '../../../../src/linepool/api/client';

/**
 * queryClient = 查询缓存管理器。默认新鲜时间 60 秒、查询和修改均不自动重试，重新聚焦窗口时允许按缓存状态刷新。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: false, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

/**
 * workspaceApi = 供预加载使用的一份接口调用工具实例。具体请求方法仍由 client.ts 提供。
 */
export const workspaceApi = createLinepoolApi();
// Keep focus/refetch management alive across route changes; the cache is cleared explicitly on logout/401.
// 保持缓存的聚焦/重连管理生效。退出登录或 401 时清缓存的逻辑在调用方，不是这行自动完成。
queryClient.mount();

/** Seed the session and warm the first workspace queries before navigation. */
/**
 * primeWorkspace = 预热工作台数据。先写入登录用户；管理员直接结束，普通用户并行预取账户、目录和概览。allSettled 允许个别预取失败后仍完成这次预热。
 */
export async function primeWorkspace(user: User): Promise<void> {
  queryClient.setQueryData(['session'], { data: user });
  if (user.role === 'ADMIN') return;
  const key = (resource: string) => ['workspace', user.id, resource] as const;
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: key('account'),
      queryFn: async ({ signal }) => (await workspaceApi.account({ signal })).data,
    }),
    queryClient.prefetchQuery({
      queryKey: key('catalog'),
      queryFn: async ({ signal }) => (await workspaceApi.catalog({ signal })).data,
    }),
    queryClient.prefetchQuery({
      queryKey: [...key('dashboard'), 'overview'],
      queryFn: async ({ signal }) => (await workspaceApi.dashboardOverview({ signal })).data,
    }),
  ]);
}
