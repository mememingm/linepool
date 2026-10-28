import type { AgentDashboard } from '@linepool/contracts';
import { money } from './pages/shared';

export default function SettlementMetrics({ data, partner }: { data: AgentDashboard; partner: boolean }) {
  const s = data.settlement;
  if (!s) return null;
  const metrics = [
    ['本期进货支出', s.purchaseCostMinor],
    ...(partner ? [['本期下级销售额', s.downstreamSalesMinor] as const] : []),
    ['客户销售额（记账）', s.customerSalesMinor],
    ['本期已售成本', s.soldCostMinor],
    ['本期毛利', s.profitMinor],
    ['库存占用资金', s.inventoryValueMinor],
  ] as const;
  return <>
    <div className="lp-agent-account-summary">{metrics.map(([label, amount]) => <div key={label}><span>{label}</span><strong>{money(amount, data.currency)}</strong></div>)}</div>
    <p className="lp-admin-context">客户销售额为记账金额，需自行收款。毛利 = 下级销售额 + 客户记账销售额 − 已售号码成本；进货支出包含尚未售出的号码。历史未记录的持有成本按 0 计，不补算历史利润。</p>
  </>;
}
