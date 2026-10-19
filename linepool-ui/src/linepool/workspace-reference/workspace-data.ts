import { navigate } from '../../app/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { languageStore, type Locale } from '../preferences/store';
import { dateLabel, translate } from '../i18n/format';
import { createLinepoolApi, LinepoolApiError, type ApiRequestOptions } from '../api/client';
import type { CreateRenewalInput, PaginationQuery, UsageQuery } from '../api/contracts';
import type { Account, AccountProfileInput, AssignedNumber, Catalog, CreateOrderInput, Dashboard, LedgerEntry, ListQuery, LoginInput, NumbersQuery, Order, PaginatedResponse, RegisterInput, SmsMessage } from '../api/contracts';

const api = createLinepoolApi();
export type WorkspaceData = {
  account: Account;
  catalog: Catalog;
  dashboard: Dashboard;
  numbers: AssignedNumber[];
  messages: SmsMessage[];
  orders: Order[];
  ledger: LedgerEntry[];
};
export function apiMessage(error: unknown, locale: Locale = 'zh-CN'): string {
  if (error instanceof z.ZodError) return translate('请检查账号、密码及提交内容', locale);
  if (!(error instanceof LinepoolApiError)) return translate('操作失败，请重试', locale);
  const labels: Record<string, string> = {
    INVALID_CREDENTIALS: '账号或密码不正确', EMAIL_EXISTS: '该邮箱已注册',
    INVALID_CURRENT_PASSWORD: '当前密码不正确，请重新输入',
    UNAUTHENTICATED: '登录已过期，请重新登录', NETWORK_ERROR: '无法连接 API，请检查服务后重试',
    NUMBER_NOT_FOUND: '号码不存在或已不再属于当前账号',
    RENEWAL_DISABLED: '短期短信接收服务暂不支持续费',
    OFFER_NOT_FOUND: '所选服务期限已不可售，请重新选择',
    NUMBER_EXPIRY_CHANGED: '号码到期时间已变化，请刷新续费方案后重试',
    RENEWAL_KEY_CONFLICT: '此请求已用于其他续费申请，请查看申请记录',
    RENEWAL_PENDING: '该号码已有待处理申请，请查看申请记录',
    RENEWAL_DURATION_UNAVAILABLE: '此续费时长暂不可用，请刷新方案',
    REQUEST_TIMEOUT: '请求超时，请重试；重复提交会复用原申请',
    INSUFFICIENT_POINTS: '积分余额不足', INSUFFICIENT_STOCK: '所选服务库存不足，请重新选择',
    IDEMPOTENCY_CONFLICT: '此请求键已用于其他订单，请确认订单记录',
    INVALID_RESPONSE: 'API 返回的数据格式不正确，请稍后重试', ORIGIN_REJECTED: '当前访问地址未获 API 授权',
    ORDER_NOT_FOUND: '订单不存在', MESSAGE_NOT_FOUND: '短信不存在', VALIDATION_ERROR: '提交内容不符合接口要求',
  };
  return translate(labels[error.code] ?? (error.status === 429 ? '请求过于频繁，请稍后重试' : error.status >= 500 ? '服务暂时不可用，请稍后重试' : error.message), locale);
}
async function allPages<T>(fetchPage: (page: number) => Promise<PaginatedResponse<T>>): Promise<T[]> {
  const first = await fetchPage(1);
  const result = [...first.data];
  for (let page = 2; page <= first.pagination.totalPages; page++) result.push(...(await fetchPage(page)).data);
  return result;
}
async function fetchData(signal: AbortSignal): Promise<WorkspaceData> {
  const options = { signal };
  const [account, catalog, dashboard, numbers, messages, orders, points] = await Promise.all([
    api.account(options), api.catalog(options), api.dashboard(options),
    allPages(page => api.numbers({ page, pageSize: 100 }, options)),
    allPages(page => api.inbox({ page, pageSize: 100 }, options)),
    allPages(page => api.orders({ page, pageSize: 100 }, options)),
    api.points({ page: 1, pageSize: 100 }, options),
  ]);
  const ledger = [...points.data.entries];
  for (let page = 2; page <= points.pagination.totalPages; page++) ledger.push(...(await api.points({ page, pageSize: 100 }, options)).data.entries);
  return { account: account.data, catalog: catalog.data, dashboard: dashboard.data, numbers, messages, orders, ledger };
}
export function useWorkspaceApi() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lastRefresh = useRef(0);
  const expire = useCallback((failure: unknown) => {
    if (failure instanceof LinepoolApiError && failure.status === 401) {
      controller.current?.abort();
      generation.current++;
      setData(null); setLastUpdated(null); setNeedsLogin(true); setLoading(false); setError('登录已过期，请重新登录');
    }
  }, []);
  const refresh = useCallback(async (checkSession = false) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const version = ++generation.current;
    lastRefresh.current = Date.now();
    setLoading(true); setError('');
    try {
      const session = await api.me({ signal: current.signal });
      if (current.signal.aborted || version !== generation.current) return false;
      if (session.data.role === 'ADMIN') {
        setData(null); setLastUpdated(null);
        navigate('/admin', true);
        return true;
      }
      const result = await fetchData(current.signal);
      if (version !== generation.current) return false;
      setData(result); setLastUpdated(Date.now()); setNeedsLogin(false);
      return true;
    } catch (failure) {
      if (current.signal.aborted || version !== generation.current) return false;
      if (failure instanceof LinepoolApiError && failure.status === 401) {
        setData(null); setLastUpdated(null); setNeedsLogin(true);
        if (!checkSession) setError('登录已过期，请重新登录');
      } else setError(apiMessage(failure));
      return false;
    } finally { if (version === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh(true);
    return () => { controller.current?.abort(); generation.current++; };
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    const focus = () => { if (Date.now() - lastRefresh.current >= 60000) void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [Boolean(data), refresh]);
  async function authenticate(input: LoginInput | RegisterInput) {
    setError('');
    if ('displayName' in input) await api.register(input);
    else await api.login(input);
    setNeedsLogin(false);
    const loaded = await refresh();
    if (!loaded) throw new Error('Authenticated, but account data could not be loaded');
  }
  async function logout() {
    try { await api.logout(); }
    catch (failure) { expire(failure); if (!(failure instanceof LinepoolApiError && failure.status === 401)) throw failure; }
    controller.current?.abort(); generation.current++;
    setData(null); setLastUpdated(null); setNeedsLogin(true); setError(''); setLoading(false);
  }
  async function createOrder(input: CreateOrderInput) {
    try {
      const result = await api.createOrder(input);
      await refresh();
      return result.data;
    } catch (failure) { expire(failure); throw failure; }
  }
  async function order(id: string) {
    try { return (await api.order(id)).data; }
    catch (failure) { expire(failure); throw failure; }
  }
  async function markRead(ids: string[]) {
    if (!ids.length) return;
    try {
      const result = await api.markRead(ids);
      const changed = new Set(result.data.ids);
      setData(current => current ? { ...current, messages: current.messages.map(message => changed.has(message.id) ? { ...message, isRead: true } : message) } : current);
      await refresh();
    } catch (failure) { expire(failure); throw failure; }
  }
  async function updateProfile(input: AccountProfileInput) {
    const ownerId = data?.account.id;
    try {
      const result = await api.updateProfile(input);
      if (result.data.id !== ownerId) throw new LinepoolApiError(200, 'INVALID_RESPONSE', 'Account identifier does not match the request');
      // Publish identity immediately without overwriting a concurrently updated balance or preferences.
      setData(current => current?.account.id === ownerId ? { ...current, account: {
        ...current.account, displayName: result.data.displayName, email: result.data.email, phoneNumber: result.data.phoneNumber,
      } } : current);
      await refresh();
      return result.data;
    } catch (failure) { expire(failure); throw failure; }
  }
  async function preferences(value: boolean) {
    try {
      const result = await api.preferences(value);
      setData(current => current && current.account.id === data?.account.id ? { ...current, account: { ...current.account, preferences: result.data } } : current);
    } catch (failure) { expire(failure); throw failure; }
  }
  const listNumbers = useCallback(async (input: NumbersQuery, options?: ApiRequestOptions) => {
    try { return await api.numbers(input, options); }
    catch (failure) { expire(failure); throw failure; }
  }, [expire]);
  const listOrders = useCallback(async (input: ListQuery, options?: ApiRequestOptions) => {
    try { return await api.orders(input, options); }
    catch (failure) { expire(failure); throw failure; }
  }, [expire]);
  const renewalOptions = useCallback(async (id: string, options?: ApiRequestOptions) => {
    try { return (await api.renewalOptions(id, options)).data; }
    catch (failure) { expire(failure); throw failure; }
  }, [expire]);
  const renewals = useCallback(async (id: string, input: Partial<PaginationQuery>, options?: ApiRequestOptions) => {
    try { return await api.renewals(id, input, options); }
    catch (failure) { expire(failure); throw failure; }
  }, [expire]);
  const createRenewal = useCallback(async (id: string, input: CreateRenewalInput) => {
    try {
      const record = (await api.createRenewal(id, input)).data;
      if (record.source === 'live' && record.status === 'SUCCESS') await refresh();
      return record;
    } catch (failure) { expire(failure); throw failure; }
  }, [expire, refresh]);
  const numberUsage = useCallback(async (id: string, input: UsageQuery, options?: ApiRequestOptions) => {
    try { return (await api.numberUsage(id, input, options)).data; }
    catch (failure) { expire(failure); throw failure; }
  }, [expire]);
  return { data, loading, lastUpdated, error, needsLogin, refresh, authenticate, logout, createOrder, order, markRead, preferences, updateProfile, listNumbers, listOrders, renewalOptions, renewals, createRenewal, numberUsage };
}
export type WorkspaceActions = Pick<ReturnType<typeof useWorkspaceApi>, 'refresh' | 'logout' | 'createOrder' | 'order' | 'markRead' | 'preferences' | 'updateProfile' | 'listNumbers' | 'listOrders' | 'renewalOptions' | 'renewals' | 'createRenewal' | 'numberUsage'>;
export const formatTime = (value: string, locale = languageStore.getSnapshot()) => dateLabel(value, locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
