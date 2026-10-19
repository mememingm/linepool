export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
const friendly: Record<string, string> = {
  SESSION_REQUIRED: '演示会话已失效，请刷新页面重新连接。',
  OUT_OF_STOCK: '共享演示库存不足，请稍后再试。',
  PRICE_CHANGED: '演示价格已更新，请重新核对商品。',
  PRODUCT_UNAVAILABLE: '此演示商品暂不可用。',
  CANNOT_CANCEL: '当前任务状态或规则不允许取消，请刷新后查看。',
  TASK_NOT_FOUND: '当前工作区找不到这个任务。',
  IDEMPOTENCY_CONFLICT: '请求编号与商品不一致，请重新选择商品。',
  DEMO_CAPACITY: '本地演示资源已占满，请等待已有任务到期。',
};
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  let body;
  try { body = await response.json(); }
  catch { throw new ApiError('INVALID_RESPONSE', '服务响应异常，请检查本地 API 是否正在运行。', response.status); }
  if (!response.ok) throw new ApiError(body.error?.code ?? 'UNKNOWN', friendly[body.error?.code] ?? body.error?.message ?? '请求失败，请重试。', response.status);
  return body as T;
}
export const errorText = (error: unknown) => error instanceof Error ? (error instanceof TypeError ? '无法连接本地服务，请检查服务后重试。' : error.message) : '操作未完成，请重试。';
