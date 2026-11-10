import { useQuery } from '@tanstack/react-query';
import type { SettlementQuote, SettlementQuoteInput } from '@linepool/contracts';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { Facts } from '../admin/primitives';
import { agentError } from './subagent-shared';
import { money } from './pages/shared';

export function useSettlementQuote(input: SettlementQuoteInput | null) {
  return useQuery({ queryKey: ['settlement-preview', input], enabled: !!input,
    queryFn: async ({ signal }) => (await api.agentSettlementPreview(input!, { signal })).data,
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false }, queryClient);
}
export function SettlementPreview({ quote, loading, error, retail = false, seller = true }: {
  quote?: SettlementQuote; loading?: boolean; error?: unknown; retail?: boolean; seller?: boolean;
}) {
  if (error) return <p className="lp-admin-error" role="alert">{agentError(error)}</p>;
  if (loading) return <p className="lp-admin-context" role="status">正在核对价格与余额…</p>;
  if (!quote) return null;
  return <><Facts rows={retail ? [
    ['售价（记账）', money(quote.bookAmountMinor, 'USD')], ['本批号码成本', money(quote.costMinor, 'USD')], ['记账毛利', money(quote.profitMinor, 'USD')],
  ] : [
    ['计价', quote.unitAmountMinor !== null && quote.billedDays !== null ? `${money(quote.unitAmountMinor, 'USD')} / 30 天 × ${quote.billedDays} 天 × ${quote.count} 个，向上取整到分` : '按各号码单价与实际天数合计'],
    ['应付金额', money(quote.amountMinor, 'USD')], ['买方余额', money(quote.buyerBalanceMinor, 'USD')],
    ...(seller ? [['你的收入', money(quote.amountMinor, 'USD')], ['你的毛利', money(quote.profitMinor, 'USD')]] as [string, string][] : []),
  ]} />{!retail && !quote.sufficient && <p className="lp-admin-error" role="alert">{seller ? '对方余额不足' : '余额不足'}：需要 {money(quote.amountMinor, 'USD')}，当前 {money(quote.buyerBalanceMinor, 'USD')}。{!seller && '请联系上级或平台充值。'}</p>}
  {retail && <p className="lp-admin-context">{quote.missingReference ? '尚未设置客户参考售价，可手动填写。' : ''}需自行向客户收款，系统不扣款。</p>}</>;
}
