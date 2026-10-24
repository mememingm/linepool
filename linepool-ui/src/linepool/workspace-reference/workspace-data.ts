import { navigate } from '../../app/router';
import type { ShellRoute } from './navigation';
const emptyNumbers: AssignedNumber[] = [];
const emptyMessages: SmsMessage[] = [];
const emptyOrders: Order[] = [];
const emptyLedger: LedgerEntry[] = [];
const emptyCatalog: Catalog = { regions: [], services: [], offers: [], isDemo: true };
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, workspaceApi } from '../api/query-client';
import { z } from 'zod';
import { languageStore, type Locale } from '../preferences/store';
import { dateLabel, translate } from '../i18n/format';
import { createLinepoolApi, LinepoolApiError, type ApiRequestOptions } from '../api/client';
import type { CreateRenewalInput, InboxQuery, PointsQuery, PaginationQuery, UsageQuery } from '../api/contracts';
import type { Account, AccountProfileInput, AssignedNumber, Catalog, CreateOrderInput, Dashboard, LedgerEntry, ListQuery, LoginInput, NumbersQuery, Order, PaginatedResponse, RegisterInput, SmsMessage } from '../api/contracts';

const api = workspaceApi;
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
type Resource = keyof WorkspaceData;

export function useWorkspaceApi(page: ShellRoute['page'] = 'dashboard') {
  // Keep private data within this mounted workspace; never share it with another login.
  const client = queryClient;
  const [signedOut, setSignedOut] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const session = useQuery({ queryKey: ['session'], queryFn: ({ signal }) => api.me({ signal }), enabled: !signedOut }, client);
  const ownerId = session.data?.data.id;
  const enabled = !signedOut && !!ownerId && session.data?.data.role !== 'ADMIN';
  const key = useCallback((resource: Resource) => ['workspace', ownerId, resource] as const, [ownerId]);
  const account = useQuery({ queryKey: key('account'), queryFn: async ({ signal }) => (await api.account({ signal })).data, enabled }, client);
  const needsCatalog = !['account', 'settings', 'points'].includes(page);
  const catalog = useQuery({ queryKey: key('catalog'), queryFn: async ({ signal }) => (await api.catalog({ signal })).data, enabled: enabled && needsCatalog }, client);
  const dashboard = useQuery({ queryKey: [...key('dashboard'), page === 'dashboard' ? 'overview' : 'summary'], queryFn: async ({ signal }) => (await (page === 'dashboard' ? api.dashboardOverview({ signal }) : api.dashboard({ signal }))).data, enabled }, client);
  // Number options are needed only inside the inbox. Record lists use their own server pagination.
  const numbers = useQuery({ queryKey: key('numbers'), queryFn: ({ signal }) => allPages(page => api.numbers({ page, pageSize: 100 }, { signal })), enabled: enabled && page === 'inbox' }, client);
  const queries = [account, ...(needsCatalog ? [catalog] : []), dashboard, ...(page === 'inbox' ? [numbers] : [])];
  const failure = session.error ?? queries.find(query => query.error)?.error;
  const unauthorized = [session, ...queries].some(query => query.error instanceof LinepoolApiError && query.error.status === 401);
  const needsLogin = signedOut || unauthorized;
  const data = useMemo<WorkspaceData | null>(() => {
    if (!enabled || unauthorized || !account.data || (needsCatalog && !catalog.data) || !dashboard.data || (page === 'inbox' && !numbers.data)) return null;
    return { account: account.data, catalog: catalog.data ?? emptyCatalog, dashboard: dashboard.data,
      numbers: page === 'inbox' ? numbers.data! : dashboard.data.overview?.recentNumbers ?? emptyNumbers,
      messages: dashboard.data.overview?.recentMessages ?? emptyMessages, orders: dashboard.data.recentOrders ?? emptyOrders, ledger: emptyLedger };
  }, [enabled, unauthorized, needsCatalog, page, account.data, catalog.data, dashboard.data, numbers.data]);
  const loading = !needsLogin && (session.isFetching || queries.some(query => query.isFetching) || (session.isPending && !session.error));
  const lastUpdated = data ? Math.max(...queries.map(query => query.dataUpdatedAt)) : null;
  const error = notice || (failure && !unauthorized ? apiMessage(failure) : '');
  const clearSession = useCallback((message = '') => {
    generation.current++;
    setSignedOut(true);
    setNotice(message);
    client.clear();
  }, [client]);
  const expire = useCallback((cause: unknown, version: number) => {
    if (version === generation.current && cause instanceof LinepoolApiError && cause.status === 401) clearSession('登录已过期，请重新登录');
  }, [clearSession]);
  useEffect(() => {
    if (unauthorized) clearSession(ownerId ? '登录已过期，请重新登录' : '');
  }, [unauthorized, clearSession, ownerId]);
  useEffect(() => {
    if (!signedOut && session.data?.data.role === 'ADMIN') navigate('/admin', true);
  }, [signedOut, session.data]);
  useEffect(() => () => { generation.current++; }, []);
  const refreshResources = useCallback(async (affected: Resource[]) => {
    setNotice('');
    const version = generation.current;
    try {
      await Promise.all(affected.map(resource => client.invalidateQueries({ queryKey: key(resource), exact: resource !== 'dashboard' }, { throwOnError: true })));
      return version === generation.current;
    } catch (cause) {
      if (version === generation.current) {
        expire(cause, version);
        if (!(cause instanceof LinepoolApiError && cause.status === 401)) setNotice(apiMessage(cause));
      }
      return false;
    }
  }, [client, key, expire]);
  const refresh = useCallback(async (_checkSession = false) => {
    setNotice('');
    const version = generation.current;
    try {
      const result = await client.fetchQuery({ queryKey: ['session'], queryFn: ({ signal }) => api.me({ signal }), staleTime: 0 });
      if (version !== generation.current) return false;
      setSignedOut(false);
      if (result.data.role === 'ADMIN') { navigate('/admin', true); return true; }
      // Existing observers refetch only their own resource, sharing in-flight requests.
      await client.invalidateQueries({ queryKey: ['workspace', result.data.id] }, { throwOnError: true });
      return version === generation.current;
    } catch (cause) {
      if (version !== generation.current) return false;
      expire(cause, version);
      if (!(cause instanceof LinepoolApiError && cause.status === 401)) setNotice(apiMessage(cause));
      return false;
    }
  }, [client, expire]);
  async function authenticate(input: LoginInput | RegisterInput) {
    setNotice('');
    if ('displayName' in input) await api.register(input);
    else await api.login(input);
    generation.current++;
    client.clear();
    const loaded = await refresh();
    if (!loaded) throw new Error('Authenticated, but account data could not be loaded');
  }
  async function logout() {
    const version = generation.current;
    try { await api.logout(); }
    catch (failure) { expire(failure, version); if (!(failure instanceof LinepoolApiError && failure.status === 401)) throw failure; }
    if (version === generation.current) clearSession();
  }
  async function createOrder(input: CreateOrderInput) {
    const version = generation.current;
    try {
      const result = await api.createOrder(input);
      if (version === generation.current) await refreshResources(['account', 'catalog', 'dashboard', 'numbers', 'orders', 'ledger']);
      return result.data;
    } catch (failure) { expire(failure, version); throw failure; }
  }
  async function order(id: string) {
    const version = generation.current;
    try { return (await api.order(id)).data; }
    catch (failure) { expire(failure, version); throw failure; }
  }
  async function markRead(ids: string[]) {
    if (!ids.length) return;
    const version = generation.current;
    try {
      const result = await api.markRead(ids);
      if (version !== generation.current) return;
      const changed = new Set(result.data.ids);
      void changed;
      await refreshResources(['messages', 'dashboard']);
    } catch (failure) { expire(failure, version); throw failure; }
  }
  async function updateProfile(input: AccountProfileInput) {
    const ownerId = data?.account.id;
    const version = generation.current;
    try {
      const result = await api.updateProfile(input);
      if (version !== generation.current) return result.data;
      if (result.data.id !== ownerId) throw new LinepoolApiError(200, 'INVALID_RESPONSE', 'Account identifier does not match the request');
      await client.cancelQueries({ queryKey: key('account'), exact: true });
      if (version !== generation.current) return result.data;
      client.setQueryData<Account>(key('account'), current => current?.id === ownerId ? {
        ...current, displayName: result.data.displayName, email: result.data.email, phoneNumber: result.data.phoneNumber,
      } : current);
      await refreshResources(['account']);
      return result.data;
    } catch (failure) { expire(failure, version); throw failure; }
  }
  async function preferences(value: boolean) {
    const version = generation.current;
    try {
      const result = await api.preferences(value);
      if (version !== generation.current) return;
      await client.cancelQueries({ queryKey: key('account'), exact: true });
      if (version !== generation.current) return;
      client.setQueryData<Account>(key('account'), current => current && current.id === ownerId ? { ...current, preferences: result.data } : current);
    } catch (failure) { expire(failure, version); throw failure; }
  }
  const listNumbers = useCallback(async (input: NumbersQuery, options?: ApiRequestOptions) => {
    const version = generation.current;
    try { return await api.numbers(input, options); }
    catch (failure) { expire(failure, version); throw failure; }
  }, [expire]);
  const listInbox = useCallback(async (input: InboxQuery, options?: ApiRequestOptions) => {
    const version = generation.current;
    try { return await api.inbox(input, options); }
    catch (failure) { expire(failure, version); throw failure; }
  }, [expire]);
  const listPoints = useCallback(async (input: PointsQuery, options?: ApiRequestOptions) => {
    const version = generation.current;
    try { return await api.points(input, options); }
    catch (failure) { expire(failure, version); throw failure; }
  }, [expire]);
  const listOrders = useCallback(async (input: ListQuery, options?: ApiRequestOptions) => {
    const version = generation.current;
    try { return await api.orders(input, options); }
    catch (failure) { expire(failure, version); throw failure; }
  }, [expire]);
  const renewalOptions = useCallback(async (id: string, options?: ApiRequestOptions) => {
    const version = generation.current;
    try { return (await api.renewalOptions(id, options)).data; }
    catch (failure) { expire(failure, version); throw failure; }
  }, [expire]);
  const renewals = useCallback(async (id: string, input: Partial<PaginationQuery>, options?: ApiRequestOptions) => {
    const version = generation.current;
    try { return await api.renewals(id, input, options); }
    catch (failure) { expire(failure, version); throw failure; }
  }, [expire]);
  const createRenewal = useCallback(async (id: string, input: CreateRenewalInput) => {
    const version = generation.current;
    try {
      const record = (await api.createRenewal(id, input)).data;
      if (version === generation.current && record.source === 'live' && record.status === 'SUCCESS') await refreshResources(['account', 'dashboard', 'numbers', 'ledger']);
      return record;
    } catch (failure) { expire(failure, version); throw failure; }
  }, [expire, refreshResources]);
  const numberUsage = useCallback(async (id: string, input: UsageQuery, options?: ApiRequestOptions) => {
    const version = generation.current;
    try { return (await api.numberUsage(id, input, options)).data; }
    catch (failure) { expire(failure, version); throw failure; }
  }, [expire]);
  return { data, loading, lastUpdated, error, needsLogin, refresh, authenticate, logout, createOrder, order, markRead, preferences, updateProfile, listNumbers, listOrders, listInbox, listPoints, renewalOptions, renewals, createRenewal, numberUsage };
}
export type WorkspaceActions = Pick<ReturnType<typeof useWorkspaceApi>, 'refresh' | 'logout' | 'createOrder' | 'order' | 'markRead' | 'preferences' | 'updateProfile' | 'listNumbers' | 'listOrders' | 'listInbox' | 'listPoints' | 'renewalOptions' | 'renewals' | 'createRenewal' | 'numberUsage'>;
export const formatTime = (value: string, locale = languageStore.getSnapshot()) => dateLabel(value, locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
