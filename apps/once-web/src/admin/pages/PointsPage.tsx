import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { formatRechargeAmount, parseRechargeAmount, rechargeAmountInput, type RechargeRules, type OncePointRulesInput } from "@linepool/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "../../app/AppProvider";
import { request } from "../../lib/api";
import { formatPoints, pointKind, pointStatus, type PointAccount, type PointConfig, type PointEntry, type PointPage, type PointRefund, type Recharge } from "../../lib/points";
import { adminError, adminKeys, listOptions } from "../api";
import { ConfirmDialog, DateText, Pager, ReasonField, ShortId, State, Table, useOperationKey } from "../primitives";
import type { AdminOrder } from "../types";

type Summary = { wallets: { accounts: number; availablePoints: string; frozenPoints: string; restricted: number }; exceptions: { kind: string; count: number }[]; revenueAvailable: false; sourceBreakdownAvailable: false; cashRefundAvailable: false };
type RechargeRow = Recharge & { userId: string };
type RefundRow = PointRefund & { userId: string };
type ExceptionRow = { id: string; userId: string | null; kind: string; status: string; details: Record<string, unknown>; reason: string | null; createdAt: string };
type Operation = { title: string; path: string; field?: "delta" | "points"; maximum?: number; explanation?: string };
const endpoint = "/admin/points";
const queryKey = (part: string, ...values: unknown[]) => [...adminKeys.all, "points", part, ...values];

function OperationDialog({ operation, onClose }: { operation: Operation; onClose: () => void }) {
  const client = useQueryClient(), { notify } = useApp(), key = useOperationKey();
  const [reason, setReason] = useState(""), [amount, setAmount] = useState(operation.maximum ? String(operation.maximum) : "");
  const [error, setError] = useState("");
  const write = useMutation({ mutationFn: () => request<unknown>(`${endpoint}/${operation.path}`, { method: "POST", headers: { "Idempotency-Key": key }, body: { reason: reason.trim(), ...(operation.field ? { [operation.field]: Number(amount) } : {}) } }), onSuccess: async value => {
    await Promise.all([client.invalidateQueries({ queryKey: adminKeys.all }), client.invalidateQueries({ queryKey: ["points"] })]);
    if (value && typeof value === "object" && "balanced" in value) notify(value.balanced ? "账户余额与流水对账通过。" : "发现差异，已生成异常待办。", value.balanced ? "success" : "error");
    else notify("操作已保存，记录已刷新。", "success");
    onClose();
  }, onError: cause => setError(adminError(cause)) });
  function submit() {
    setError("");
    if (reason.trim().length < 2) return setError("请填写操作原因。");
    if (operation.field && (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0 || (operation.maximum !== undefined && Number(amount) > operation.maximum))) return setError("请填写允许范围内的正整数积分。");
    write.mutate();
  }
  return <ConfirmDialog title={operation.title} busy={write.isPending} onClose={onClose} footer={<><Button variant="outline" disabled={write.isPending} onClick={onClose}>取消</Button><Button type="submit" form="oa-points-operation" disabled={write.isPending}>确认{operation.title}</Button></>}><form id="oa-points-operation" onSubmit={event => { event.preventDefault(); submit(); }}><fieldset disabled={write.isPending}>{operation.explanation && <p className="oa-context">{operation.explanation}</p>}{operation.field && <label>{operation.field === "delta" ? "增加补偿积分" : "退回消费积分"}<Input type="number" step="1" min={1} max={operation.maximum} required value={amount} onChange={event => setAmount(event.target.value)} /></label>}<ReasonField value={reason} onChange={setReason} disabled={write.isPending} suggestions={["服务异常补偿", "人工核对完成"]} />{error && <p className="oa-error" role="alert">{error}</p>}</fieldset></form></ConfirmDialog>;
}

function RulesDialog({ config, close }: { config: PointConfig; close: () => void }) {
  const rules = config.rules;
  const client = useQueryClient(), { notify } = useApp(), key = useOperationKey();
  const [currency, setCurrency] = useState(rules?.currency ?? "");
  const [precision, setPrecision] = useState(rules ? String(rules.fractionDigits) : "");
  const [minimum, setMinimum] = useState(rules ? rechargeAmountInput(rules.minimumMinor, rules.fractionDigits) : "");
  const [maximum, setMaximum] = useState(rules ? rechargeAmountInput(rules.maximumMinor, rules.fractionDigits) : "");
  const [daily, setDaily] = useState(rules?.dailyMinor ? rechargeAmountInput(rules.dailyMinor, rules.fractionDigits) : "");
  const [presets, setPresets] = useState(rules?.presetsMinor.map(value => rechargeAmountInput(value, rules.fractionDigits)).join(", ") ?? "");
  const [exchange, setExchange] = useState(rules?.exchangeAmountMinor ? rechargeAmountInput(rules.exchangeAmountMinor, rules.fractionDigits) : "");
  const [points, setPoints] = useState(rules?.exchangePoints ? String(rules.exchangePoints) : "");
  const [enabled, setEnabled] = useState(rules?.enabled ?? false), [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: async () => {
    const fractionDigits = Number(precision);
    if (!/^[A-Z]{3}$/.test(currency) || precision === "" || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6 || !Number.isSafeInteger(Number(points)) || Number(points) <= 0) throw new Error("请填写币种、有效精度及兑换积分。");
    const amountRules: RechargeRules = { enabled, currency, fractionDigits, minimumMinor: 1, maximumMinor: Number.MAX_SAFE_INTEGER, dailyMinor: null, presetsMinor: [], exchangeAmountMinor: null, exchangePoints: null };
    const values = [minimum, maximum, daily, exchange, ...presets.split(/[,，]/).map(value => value.trim()).filter(Boolean)].map(value => parseRechargeAmount(value, amountRules).amountMinor);
    if (values.some(value => value === null) || reason.trim().length < 2) throw new Error("请按币种精度填写有效金额，并填写操作原因。");
    const [minMinor, maxMinor, dailyMinor, exchangeAmountMinor, ...presetsMinor] = values as number[];
    const body: OncePointRulesInput = { enabled, currency, fractionDigits, minMinor: minMinor!, maxMinor: maxMinor!, dailyMinor: dailyMinor!, presetsMinor, exchangeAmountMinor: exchangeAmountMinor!, exchangePoints: Number(points), expectedVersion: config.version, reason: reason.trim() };
    await request(`${endpoint}/rules`, { method: "POST", headers: { "Idempotency-Key": key }, body });
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: adminKeys.all }); await client.invalidateQueries({ queryKey: ["points"] }); notify("充值规则已保存。", "success"); close(); } });
  return <ConfirmDialog title="充值规则" busy={save.isPending} onClose={close} footer={<><Button variant="outline" disabled={save.isPending} onClick={close}>取消</Button><Button type="submit" form="oa-recharge-rules" disabled={save.isPending}>保存规则</Button></>}><form id="oa-recharge-rules" onSubmit={event => { event.preventDefault(); save.mutate(); }}><fieldset disabled={save.isPending}>
    <label className="oa-check-row"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />允许创建充值单</label><div className="oa-form-row"><label>币种<Input value={currency} required maxLength={3} pattern="[A-Z]{3}" placeholder="例如 USD" onChange={event => setCurrency(event.target.value.toUpperCase())} /></label><label>小数位数<Input type="number" min={0} max={6} step={1} required value={precision} onChange={event => setPrecision(event.target.value)} /></label></div>
    {([['最低充值', minimum, setMinimum], ['单笔上限', maximum, setMaximum], ['每日上限', daily, setDaily], ['兑换金额', exchange, setExchange]] as const).map(([label, value, update]) => <label key={label}>{label}（{currency || "所选币种"}）<Input inputMode="decimal" value={value} required onChange={event => update(event.target.value)} /></label>)}<label>兑换积分<Input type="number" min={1} step={1} value={points} required onChange={event => setPoints(event.target.value)} /></label><label>快捷金额（逗号分隔）<Input value={presets} onChange={event => setPresets(event.target.value)} /></label><p className="oa-context">兑换金额与兑换积分共同决定充值比例；快捷金额须能兑换为整数积分。</p><ReasonField value={reason} onChange={setReason} disabled={save.isPending} suggestions={["配置本站充值规则", "调整兑换比例"]} />{save.isError && <p role="alert" className="oa-error">{adminError(save.error)}</p>}
  </fieldset></form></ConfirmDialog>;
}

function RefundableOrders({ userId, openOperation }: { userId: string; openOperation: (operation: Operation) => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(""), [submitted, setSubmitted] = useState("");
  const orders = useQuery({ ...listOptions("orders", { userId, page, pageSize: 50, search: submitted }), placeholderData: undefined });
  const refundable = orders.data?.items.filter(order => order.settlementType === "POINTS" && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(order.fundsStatus ?? "") && (order.pointsAmount ?? 0) > (order.refundedPoints ?? 0)) ?? [];
  return <><h3>可退积分的消费订单</h3>
    <p className="oa-context">每页查询 50 笔订单，仅列出其中可退积分的订单。消费退积分不会自动缩短租约，结束服务请另行回收。</p>
    <form className="oa-inline-search" onSubmit={event => { event.preventDefault(); setSubmitted(search.trim()); setPage(1); }}><Input aria-label="搜索消费订单" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} placeholder="搜索订单号或号码" /><Button type="submit" variant="outline">搜索订单</Button></form>
    <State query={orders} empty={orders.data?.items.length === 0} />
    {orders.data && orders.data.items.length > 0 && refundable.length === 0 && <p className="oa-context">本页没有可退积分的订单，可继续翻页或搜索。</p>}
    {refundable.length > 0 && <Table label="消费订单退回" columns={["订单 / 号码", "消费积分", "已退回", "操作"]}>{refundable.map((order: AdminOrder) => <tr key={order.id}><td><ShortId value={order.id} /><small>{order.number}</small></td><td>{formatPoints(order.pointsAmount!)}</td><td>{formatPoints(order.refundedPoints ?? 0)}</td><td><Button size="sm" variant="outline" onClick={() => openOperation({ title: "退回消费积分", path: `orders/${order.id}/refund`, field: "points", maximum: order.pointsAmount! - (order.refundedPoints ?? 0), explanation: "按该笔订单已扣除且尚未退回的积分执行退回。" })}>退回积分</Button></td></tr>)}</Table>}
    <Pager data={orders.data} onPage={setPage} />
  </>;
}

export function PointsPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get("userId") ?? "";
  const [tab, setTab] = useState<"recharges" | "refunds" | "exceptions" | "account">("recharges");
  const [cursor, setCursor] = useState(""), [previous, setPrevious] = useState<string[]>([]);
  const [operation, setOperation] = useState<Operation | null>(null), [editingRules, setEditingRules] = useState(false);
  const [search, setSearch] = useState(""), [submitted, setSubmitted] = useState("");
  const summary = useQuery({ queryKey: queryKey("summary"), queryFn: ({ signal }) => request<Summary>(`${endpoint}/summary`, { signal }) });
  const config = useQuery({ queryKey: queryKey("rules"), queryFn: ({ signal }) => request<PointConfig>(`${endpoint}/rules`, { signal }) });
  const history = useQuery({ queryKey: queryKey(tab, cursor), queryFn: ({ signal }) => request<PointPage<RechargeRow | RefundRow | ExceptionRow>>(`${endpoint}/${tab}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }), enabled: tab !== "account" });
  const users = useQuery({ ...listOptions("users", { search: submitted, pageSize: 10 }), enabled: Boolean(submitted) && tab === "account" });
  const account = useQuery({ queryKey: queryKey("account", userId), queryFn: ({ signal }) => request<PointAccount>(`${endpoint}/users/${userId}`, { signal }), enabled: Boolean(userId) && tab === "account" });
  const ledger = useQuery({ queryKey: queryKey("ledger", userId, cursor), queryFn: ({ signal }) => request<PointPage<PointEntry>>(`${endpoint}/users/${userId}/ledger?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }), enabled: Boolean(userId) && tab === "account" });
  const s = summary.data;
  const next = tab === "account" ? ledger.data?.nextCursor : history.data?.nextCursor;
  return <><State query={summary} /><p className="oa-context">模拟充值不计为现金收入。现金退款当前不可用，历史记录保留。账户不提供来源批次拆分。</p>
    {s && <div className="oa-metrics">{[["本站自营账户", String(s.wallets.accounts)], ["可用积分合计", BigInt(s.wallets.availablePoints).toLocaleString("zh-CN")], ["冻结积分合计", BigInt(s.wallets.frozenPoints).toLocaleString("zh-CN")], ["需复核账户 / 异常", `${s.wallets.restricted} / ${s.exceptions.reduce((total, item) => total + item.count, 0)}`]].map(([label, value]) => <div className="oa-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    <section className="oa-card"><div className="oa-card-heading"><div className="oa-actions">{([["recharges", "充值记录"], ["refunds", "历史退款"], ["exceptions", "异常待办"], ["account", "用户账户"]] as const).map(([value, label]) => <Button key={value} variant={tab === value ? "default" : "outline"} size="sm" onClick={() => { setTab(value); setCursor(""); setPrevious([]); }}>{label}</Button>)}</div><Button variant="outline" size="sm" disabled={!config.data} onClick={() => setEditingRules(true)}>充值规则</Button></div>
      {config.isError && <State query={config} />}
      {tab !== "account" && <><State query={history} empty={history.data?.items.length === 0} />{history.data?.items.length ? <Table label="积分业务记录" columns={tab === "exceptions" ? ["异常 / 用户", "状态", "创建时间", "处理"] : ["业务单 / 用户", "金额", "状态", "创建时间", "说明"]}>{history.data.items.map(item => {
        if (tab === "exceptions") { const row = item as ExceptionRow; return <tr key={row.id}><td><ShortId value={row.id} /><small>{row.kind}</small><small>{row.userId || "未关联用户"}</small><details><summary>查看详情</summary><pre>{JSON.stringify(row.details, null, 2)}</pre></details>{row.reason && <small>{row.reason}</small>}</td><td>{row.status === "OPEN" ? "待核对" : "已处理"}</td><td><DateText value={row.createdAt} /></td><td>{row.status === "OPEN" && <Button size="sm" variant="outline" onClick={() => setOperation({ title: "记录核对结果", path: `exceptions/${row.id}/resolve`, explanation: "先确认资金或履约结果；此操作只记录核对结论。" })}>记录核对结果</Button>}</td></tr>; }
        const row = item as RechargeRow | RefundRow;
        return <tr key={row.id}><td><ShortId value={row.id} /><small>{row.userId}</small>{"reason" in row && <small>{row.reason}</small>}</td><td>{formatRechargeAmount(row.amountMinor, { currency: row.currency, fractionDigits: row.fractionDigits ?? 2 }, "zh-CN")}<small>{formatPoints(row.points)}</small></td><td>{tab === "refunds" && row.status === "SUCCEEDED" ? "历史退款成功" : pointStatus[row.status] ?? row.status}</td><td><DateText value={row.createdAt} /></td><td>{tab === "refunds" ? "仅供查看，现金退款执行已停用" : "environment" in row && row.environment === "DEMO" ? "模拟充值" : "历史记录"}</td></tr>;
      })}</Table> : null}</>}
      {tab === "account" && <div className="oa-pad"><form className="oa-inline-search" onSubmit={event => { event.preventDefault(); setSubmitted(search.trim()); }}><Input aria-label="搜索积分用户" value={search} onChange={event => setSearch(event.target.value)} placeholder="输入用户邮箱查找账户" /><Button type="submit" variant="outline">查找用户</Button></form>{submitted && <><State query={users} empty={users.data?.items.length === 0} /><div className="oa-actions">{users.data?.items.filter(user => user.authKind !== "PINCLODE").map(user => <Button key={user.id} variant={userId === user.id ? "default" : "outline"} size="sm" onClick={() => { setParams({ userId: user.id }); setCursor(""); setPrevious([]); }}>{user.email}</Button>)}</div></>}
        {userId && <><State query={account} />{account.data && <><p className="oa-confirm-target">可用 {formatPoints(account.data.availablePoints)} · 冻结 {formatPoints(account.data.frozenPoints)}</p><p className="oa-context">账户{account.data.status === "ACTIVE" ? "正常" : "待复核"}。来源批次拆分当前不可用。</p><div className="oa-actions"><Button size="sm" variant="outline" onClick={() => setOperation({ title: "增加补偿积分", path: `users/${userId}/adjust`, field: "delta", explanation: "增加本站服务补偿积分；当前不支持按来源扣回积分。" })}>增加补偿积分</Button><Button size="sm" variant="outline" onClick={() => setOperation({ title: "账户对账", path: `users/${userId}/reconcile` })}>账户对账</Button></div></>}
          <h3>积分流水</h3><State query={ledger} empty={ledger.data?.items.length === 0} />{ledger.data?.items.length ? <Table label="用户积分流水" columns={["时间", "业务", "可用变动", "冻结变动", "变动后可用"]}>{ledger.data.items.map(entry => <tr key={entry.id}><td><DateText value={entry.createdAt} /></td><td>{pointKind[entry.kind] ?? entry.kind}<small>{entry.description}</small></td><td>{entry.delta > 0 ? "+" : ""}{entry.delta}</td><td>{entry.frozenDelta > 0 ? "+" : ""}{entry.frozenDelta}</td><td>{formatPoints(entry.balanceAfter)}</td></tr>)}</Table> : null}
          <RefundableOrders key={userId} userId={userId} openOperation={setOperation} /></>}
      </div>}
      <div className="oa-pager"><span>{tab === "account" ? "积分流水 · 每页最多 25 条" : "每页最多 25 条"}</span><div><Button size="sm" variant="outline" disabled={!previous.length} onClick={() => { setCursor(previous.at(-1) ?? ""); setPrevious(previous.slice(0, -1)); }}>上一页</Button><Button size="sm" variant="outline" disabled={!next} onClick={() => { setPrevious([...previous, cursor]); setCursor(next ?? ""); }}>下一页</Button></div></div>
    </section>{operation && <OperationDialog operation={operation} onClose={() => setOperation(null)} />}{editingRules && config.data && <RulesDialog config={config.data} close={() => setEditingRules(false)} />}
  </>;
}
