/**
 * agent-settlement.ts 中文分区导读副本：代理报价与余额结算
 * 原文件：backend/src/agent-settlement.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】根据价格规则和持有时间计算报价，核对预览标识，转移双方余额并保存结算明细。
 * 【为什么这样组织】价格和余额由后端重新检查；整数与 BigInt 保持金额精度，不能信任浏览器提交的最终价格。
 * 【调用链】AgentInventory / HoldingBatch → quoteSettlement → assertQuote → settleBalances → saveSettlement。
 * 【修改提示】按 30 天价格折算的基准不是商城套餐选项；改计算规则需核对取整、余额、报价标识和历史账目。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { SettlementQuote } from '@linepool/contracts';
import { ApiFailure } from '../../../../backend/src/http.js';

/**
 * DAY_MS = 一天对应的毫秒数。用于把时间差换算为天数，不是套餐期限配置。
 */
const DAY_MS = 86400000;
/**
 * SettlementSource = 待计价号码资源与服务信息。这里只描述结构，执行操作需看后面的函数。
 */
export type SettlementSource = {
  key: string; phoneNumber: string; regionId: string; service: string;
  startsAt: string; expiresAt: string; costMinor: number;
};
/**
 * Rule = 结算使用的价格规则。这里只描述结构，执行操作需看后面的函数。
 */
type Rule = { id: string; buyer_agent_id: string | null; region_id: string | null; service: string; unit_amount_minor: string };
/**
 * SettlementLine = 一条号码服务的结算明细。这里只描述结构，执行操作需看后面的函数。
 */
export type SettlementLine = SettlementSource & {
  unitAmountMinor: number | null; billedDays: number; priceRuleId: string | null;
  amountMinor: number; bookAmountMinor: number;
};
/**
 * Settlement = 一次报价的金额、明细与校验信息。这里只描述结构，执行操作需看后面的函数。
 */
export type Settlement = { quote: SettlementQuote; lines: SettlementLine[]; sellerAgentId: string | null; buyerAgentId: string | null; retail: boolean };

/**
 * safe = 检查 BigInt 金额非负且未超过 JavaScript 安全整数范围，再转换为 number。
 */
function safe(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiFailure(409, 'AMOUNT_TOO_LARGE', 'Settlement amount exceeds the supported range');
  return Number(value);
}
/**
 * prorate = 按 30 天基准价折算实际计费天数，并向上取到最小货币单位；它不是商城 30 天套餐开关。
 */
export function prorate(unit: number, days: number) { return safe((BigInt(unit) * BigInt(days) + 29n) / 30n); }
/**
 * sum = 用 BigInt 累加金额后检查安全范围，避免普通大整数累加丢精度。
 */
const sum = (values: number[]) => safe(values.reduce((total, value) => total + BigInt(value), 0n));
/**
 * uniform = 所有明细值一致时返回统一值，否则返回 null，供订单头概括单价或计费天数。
 */
const uniform = <T>(values: T[]): T | null => values.every(value => value === values[0]) ? values[0]! : null;

/** Exact buyer beats default buyer, then exact country beats all countries; priority is deliberately unused. */
/**
 * quoteSettlement = 生成后端报价。按指定买方优先、指定地区优先选 USD/P30D 规则，计算天数、应付/记账/成本/利润及余额，并生成报价校验标识；priority 在此不参与排序。
 */
export async function quoteSettlement(client: PoolClient, sellerAgentId: string | null, buyerAgentId: string | null,
  retail: boolean, sources: SettlementSource[], bookAmountMinor?: number): Promise<Settlement> {
  const { rows: rules } = await client.query<Rule>(
    `SELECT id,buyer_agent_id,region_id,service,unit_amount_minor FROM price_rules
     WHERE is_active AND NOT legacy_archived AND currency='USD' AND plan='P30D'
       AND pricing_kind=$1 AND seller_type=$2 AND seller_agent_id IS NOT DISTINCT FROM $3
       AND (buyer_agent_id=$4 OR buyer_agent_id IS NULL) AND service=ANY($5::text[])
     ORDER BY (buyer_agent_id IS NOT NULL) DESC,(region_id IS NOT NULL) DESC,id`,
    [retail ? 'RETAIL' : 'WHOLESALE', sellerAgentId ? 'AGENT' : 'PLATFORM', sellerAgentId, buyerAgentId, [...new Set(sources.map(row => row.service))]]);
  const lookup = new Map<string, Rule | null>();
  // 每个号码单独计算服务天数与参考价格，再汇总成整单；计费天数向上取整。
  const lines = sources.map(source => {
    const days = Math.ceil((Date.parse(source.expiresAt) - Date.parse(source.startsAt)) / DAY_MS);
    if (!Number.isSafeInteger(days) || days < 1) throw new ApiFailure(400, 'INVALID_HOLDING_WINDOW', 'Holding expiry must follow its start');
    const key = JSON.stringify([source.service, source.regionId]);
    if (!lookup.has(key)) lookup.set(key, rules.find(rule => rule.service === source.service && (rule.region_id === null || rule.region_id === source.regionId)) ?? null);
    const rule = lookup.get(key);
    if (!rule && !retail) throw new ApiFailure(409, 'PRICE_NOT_SET', `还没有设置 ${source.service} / ${source.regionId} 的价格，请先在“商品与价格”中设置`, { service: source.service, regionId: source.regionId });
    const unit = rule ? safe(BigInt(rule.unit_amount_minor)) : null;
    const reference = unit === null ? 0 : prorate(unit, days);
    return { ...source, unitAmountMinor: unit, billedDays: days, priceRuleId: rule?.id ?? null,
      amountMinor: retail ? 0 : reference, bookAmountMinor: retail ? bookAmountMinor ?? reference : 0 };
  });
  const amountMinor = sum(lines.map(line => line.amountMinor));
  const bookTotal = sum(lines.map(line => line.bookAmountMinor));
  const costMinor = sum(lines.map(line => line.costMinor));
  const { rows: [account] } = buyerAgentId ? await client.query<{ balance_minor: string }>(
    "SELECT balance_minor FROM balance_accounts WHERE owner_type='AGENT' AND agent_id=$1 AND currency='USD'", [buyerAgentId]) : { rows: [] };
  const balance = safe(BigInt(account?.balance_minor ?? 0));
  // Use billed days rather than a moving clock so a preview can survive the confirmation step.
  // fingerprint = 报价内容的校验标识。确认时后端重算并比较，防止价格或服务期限已改变还使用旧报价。
  const fingerprint = createHash('sha256').update(JSON.stringify({ sellerAgentId, buyerAgentId, retail, lines: lines.map(({ startsAt: _start, ...line }) => line) })).digest('hex');
  return { sellerAgentId, buyerAgentId, retail, lines,
    quote: { fingerprint, currency: 'USD', count: lines.length, amountMinor, bookAmountMinor: bookTotal, costMinor,
      profitMinor: (retail ? bookTotal : amountMinor) - costMinor, buyerBalanceMinor: balance,
      sufficient: retail || balance >= amountMinor, unitAmountMinor: uniform(lines.map(line => line.unitAmountMinor)),
      billedDays: uniform(lines.map(line => line.billedDays)), missingReference: lines.some(line => !line.priceRuleId) } };
}

/**
 * assertQuote = 确认前端带回的报价标识存在且等于后端重算值，否则要求重新核对价格。
 */
export function assertQuote(settlement: Settlement, fingerprint?: string) {
  if (!fingerprint) throw new ApiFailure(409, 'QUOTE_REQUIRED', '请先核对本次结算金额');
  if (settlement.quote.fingerprint !== fingerprint) throw new ApiFailure(409, 'PRICE_CHANGED', '价格或号码期限已变化，请返回修改并重新核对金额');
}

/** Called within the inventory transaction. Lock accounts in ID order and check versions. */
/**
 * settleBalances = 在库存事务内执行代理批发余额结算。按确定顺序建立/锁定账户，检查余额与版本，扣买方、加卖方并写流水；零售记账分支不在这里扣客户余额。
 */
export async function settleBalances(client: PoolClient, orderId: string, settlement: Settlement) {
  if (settlement.retail || settlement.quote.amountMinor === 0) return;
  const buyerId = settlement.buyerAgentId!;
  const ids = [buyerId, ...(settlement.sellerAgentId ? [settlement.sellerAgentId] : [])].sort();
  // Account creation uses the same order as locking to avoid deadlocks in concurrent transfers.
  for (const id of ids) await client.query("INSERT INTO balance_accounts(owner_type,agent_id,currency) VALUES('AGENT',$1,'USD') ON CONFLICT DO NOTHING", [id]);
  const { rows: accounts } = await client.query<{ id: string; agent_id: string; balance_minor: string; version: number }>(
    "SELECT id,agent_id,balance_minor,version FROM balance_accounts WHERE owner_type='AGENT' AND agent_id=ANY($1::uuid[]) AND currency='USD' ORDER BY id FOR UPDATE", [ids]);
  const buyer = accounts.find(account => account.agent_id === buyerId)!;
  const amount = settlement.quote.amountMinor;
  if (BigInt(buyer.balance_minor) < BigInt(amount)) throw new ApiFailure(409, 'INSUFFICIENT_BALANCE', '余额不足，请联系上级或平台充值', { requiredMinor: amount, balanceMinor: Number(buyer.balance_minor), currency: 'USD' });
  for (const account of accounts) {
    const debit = account.agent_id === buyerId;
    const after = safe(BigInt(account.balance_minor) + (debit ? -BigInt(amount) : BigInt(amount)));
    const { rowCount } = await client.query('UPDATE balance_accounts SET balance_minor=$2,version=version+1 WHERE id=$1 AND version=$3', [account.id, after, account.version]);
    if (rowCount !== 1) throw new ApiFailure(409, 'BALANCE_CHANGED', '余额已变化，请重试');
    await client.query(`INSERT INTO balance_ledger(account_id,type,delta,balance_after,description,tx_order_id)
      VALUES($1,$2,$3,$4,$5,$6)`, [account.id, debit ? 'ORDER_DEBIT' : 'TRANSFER_IN', debit ? -amount : amount, after,
      debit ? '进货扣款' : '下级进货收入', orderId]);
  }
}

/**
 * saveSettlement = 保存报价快照和逐号码结算明细到交易记录，批发交易同时把实际支付额记为新持有的成本。
 */
export async function saveSettlement(client: PoolClient, orderId: string, settlement: Settlement, holdings: Array<{ id: string; key: string }>) {
  const q = settlement.quote;
  await client.query(`UPDATE tx_orders SET amount_minor=$2,book_amount_minor=$3,cost_minor=$4,unit_amount_minor=$5,billed_days=$6,price_rule_id=$7 WHERE id=$1`,
    [orderId, q.amountMinor, q.bookAmountMinor, q.costMinor, q.unitAmountMinor, q.billedDays, uniform(settlement.lines.map(line => line.priceRuleId))]);
  const byKey = new Map(holdings.map(holding => [holding.key, holding.id]));
  const rows = settlement.lines.map(line => ({ ...line, holdingId: byKey.get(line.key), sourceId: settlement.sellerAgentId ? line.key : null }));
  await client.query(`INSERT INTO tx_order_items(tx_order_id,source_holding_id,holding_id,phone_number,region_id,service,starts_at,expires_at,
      unit_amount_minor,billed_days,price_rule_id,amount_minor,book_amount_minor,cost_minor)
    SELECT $2,item."sourceId",item."holdingId",item."phoneNumber",item."regionId",item.service,item."startsAt",item."expiresAt",
      item."unitAmountMinor",item."billedDays",item."priceRuleId",item."amountMinor",item."bookAmountMinor",item."costMinor"
    FROM jsonb_to_recordset($1::jsonb) AS item("sourceId" uuid,"holdingId" uuid,"phoneNumber" text,"regionId" text,service text,
      "startsAt" timestamptz,"expiresAt" timestamptz,"unitAmountMinor" bigint,"billedDays" integer,"priceRuleId" uuid,"amountMinor" bigint,"bookAmountMinor" bigint,"costMinor" bigint)`, [JSON.stringify(rows), orderId]);
  // The buyer's new cost is what they paid; a customer's book sale is not an acquisition charge.
  if (!settlement.retail) await client.query(`UPDATE number_holdings holding SET cost_minor=item."amountMinor"
    FROM jsonb_to_recordset($1::jsonb) AS item("holdingId" uuid,"amountMinor" bigint) WHERE holding.id=item."holdingId"`, [JSON.stringify(rows)]);
}
