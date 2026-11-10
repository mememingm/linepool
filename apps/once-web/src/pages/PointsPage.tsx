import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { calculateRechargePoints, formatRechargeAmount, parseRechargeAmount, rechargeAmountInput, type OnceDemoPayInput } from "@linepool/contracts";
import { useApp } from "../app/AppProvider";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { completeOperation, operationKey, queryClient, request } from "../lib/api";
import { errorMessage, formatDateTime, leasePath, type MutationResult } from "../lib/models";
import { formatPoints, pointKeys, pointKind, pointStatus, usePointAccount, type PointConfig, type PointEntry, type PointPage, type PointRefund, type PurchaseIntent, type Recharge } from "../lib/points";
import "../styles/points.css";

function History({ kind }: { kind: "ledger" | "recharges" | "refunds" }) {
  const { account } = useApp();
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [, setParams] = useSearchParams();
  const data = useQuery({ queryKey: [...pointKeys.all(account!.id), kind, cursor], queryFn: ({ signal }) => request<PointPage<PointEntry | Recharge | PointRefund>>(`/points/${kind}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }) });
  return <section className="points-panel"><h2>{kind === "ledger" ? "积分明细" : kind === "recharges" ? "充值记录" : "历史退款记录"}</h2>
    {data.isPending ? <p role="status">正在读取…</p> : data.isError ? <p role="alert">{errorMessage(data.error)} <Button variant="outline" onClick={() => void data.refetch()}>重试</Button></p> : !data.data.items.length ? <p className="points-muted">暂无记录。</p> : <div className="points-table-scroll"><table className="points-table"><thead><tr><th>时间</th><th>类型 / 金额</th><th>状态 / 余额</th><th>说明</th></tr></thead><tbody>
      {data.data.items.map(row => <tr key={row.id}><td>{formatDateTime(row.createdAt)}</td>{"delta" in row ? <><td>{pointKind[row.kind] ?? row.kind}<small>可用 {row.delta > 0 ? "+" : ""}{row.delta} · 冻结 {row.frozenDelta > 0 ? "+" : ""}{row.frozenDelta}</small></td><td>{formatPoints(row.balanceAfter)}<small>冻结 {row.frozenAfter}</small></td><td>{row.description || "无"}</td></> : <><td>{formatRechargeAmount(row.amountMinor, { currency: row.currency, fractionDigits: row.fractionDigits ?? 2 }, "zh-CN")}<small>{formatPoints(row.points)}</small></td><td>{kind === "refunds" && row.status === "SUCCEEDED" ? "历史退款成功" : pointStatus[row.status] ?? row.status}{"environment" in row && <small>{row.environment === "DEMO" ? "模拟支付" : "历史记录"}</small>}</td><td>{"environment" in row ? <Button variant="outline" size="sm" onClick={() => setParams(p => { const next = new URLSearchParams(p); next.set("recharge", row.id); return next; })}>查看结果</Button> : row.reason}</td></>}</tr>)}
    </tbody></table></div>}
    {(previous.length > 0 || data.data?.nextCursor) && <div className="points-actions"><Button variant="outline" disabled={!previous.length || data.isFetching} onClick={() => { setCursor(previous[previous.length - 1] ?? ""); setPrevious(previous.slice(0, -1)); }}>上一页</Button><Button variant="outline" disabled={!data.data?.nextCursor || data.isFetching} onClick={() => { setPrevious([...previous, cursor]); setCursor(data.data!.nextCursor!); }}>下一页</Button></div>}
  </section>;
}

export function PointsPage() {
  const { account, notify } = useApp();
  const wallet = usePointAccount();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rechargeId = params.get("recharge") ?? "", intentId = params.get("intent") ?? "";
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<"ledger" | "recharges" | "refunds">("ledger");
  const [scenario, setScenario] = useState<OnceDemoPayInput["scenario"]>("SUCCESS");
  const config = useQuery({ queryKey: [...pointKeys.all(account!.id), "config"], queryFn: ({ signal }) => request<PointConfig>("/points/config", { signal }) });
  const intent = useQuery({ queryKey: [...pointKeys.all(account!.id), "intent", intentId], queryFn: ({ signal }) => request<PurchaseIntent>(`/points/intents/${encodeURIComponent(intentId)}`, { signal }), enabled: Boolean(intentId), refetchOnWindowFocus: true });
  const recharge = useQuery({ queryKey: [...pointKeys.all(account!.id), "recharge", rechargeId], queryFn: ({ signal }) => request<Recharge>(`/points/recharges/${encodeURIComponent(rechargeId)}`, { signal }), enabled: Boolean(rechargeId), refetchInterval: query => ["PENDING", "CHECKING", "PAID_UNCREDITED"].includes(query.state.data?.status ?? "") ? 10_000 : false, refetchIntervalInBackground: false });
  const rules = config.data?.rules ?? null;
  const parsed = parseRechargeAmount(amount, rules);
  const quoted = parsed.amountMinor === null ? null : calculateRechargePoints(parsed.amountMinor, rules);
  async function refresh() { await queryClient.invalidateQueries({ queryKey: pointKeys.all(account!.id) }); }
  useEffect(() => {
    if (recharge.data?.credited && ["SUCCEEDED", "PAID"].includes(recharge.data.status)) {
      void queryClient.invalidateQueries({ queryKey: pointKeys.account(account!.id) });
      if (intentId) void intent.refetch();
    }
  }, [recharge.data?.credited, recharge.data?.status, account!.id, intentId]);
  const create = useMutation({ mutationFn: async () => {
    if (parsed.amountMinor === null || quoted?.points == null) throw new Error("请按当前充值范围与币种精度输入能兑换为整数积分的金额。");
    const signature = `recharge:${parsed.amountMinor}:${intentId}:${config.data?.version}`;
    const row = await request<Recharge>("/points/recharges", { method: "POST", headers: { "Idempotency-Key": operationKey(account!.id, signature) }, body: { amountMinor: parsed.amountMinor, ...(intentId ? { purchaseIntentId: intentId } : {}) } });
    completeOperation(account!.id, signature);
    setParams(p => { const next = new URLSearchParams(p); next.set("recharge", row.id); return next; });
    await refresh();
  }, onError: error => notify(errorMessage(error), "error") });
  const check = useMutation({ mutationFn: async (simulate: boolean) => {
    await request(`/points/recharges/${encodeURIComponent(rechargeId)}/${simulate ? "demo-pay" : "check"}`, { method: "POST", body: simulate ? { scenario } : {} });
    await refresh();
  }, onError: error => notify(errorMessage(error), "error") });
  const purchase = useMutation({ mutationFn: async () => {
    const draft = intent.data, plan = draft?.currentPlan;
    if (!draft || !plan) throw new Error("请重新选择套餐。");
    const signature = `intent-purchase:${draft.id}:${plan.version}`;
    const result = await request<MutationResult & { status?: string }>(draft.kind === "RENT" ? "/leases" : `/leases/${encodeURIComponent(draft.leaseId!)}/renew`, { method: "POST", headers: { "Idempotency-Key": operationKey(account!.id, signature) }, body: { ...(draft.kind === "RENT" ? { number: draft.number } : {}), term: draft.termDays, quoteVersion: plan.version, purchaseIntentId: draft.id } });
    if (result.leaseId && ["DEMO_CONFIRMED", "CONFIRMED", "COMPLETED"].includes(result.status ?? "")) {
      completeOperation(account!.id, signature);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["state"] }), refresh()]);
      navigate(leasePath("numbers", result.leaseId)); notify("积分结算及服务已确认。");
    } else { await refresh(); notify("订单已提交，请在订单页查看处理结果。"); navigate("/app/billing"); }
  }, onError: error => { notify(errorMessage(error), "error"); void intent.refetch(); void wallet.refetch(); } });
  const busy = create.isPending || check.isPending || purchase.isPending;
  const draft = intent.data, plan = draft?.currentPlan;
  const unavailable = draft?.expired || draft?.availability !== "AVAILABLE" || !plan?.active;
  const canPurchase = draft && !draft.orderId && !unavailable && plan && wallet.data?.status === "ACTIVE" && wallet.data.availablePoints >= plan.pointsPrice;
  function submit(event: FormEvent) { event.preventDefault(); if (!busy) create.mutate(); }
  return <main className="content points-page"><div className="page-head"><div><h1>积分账户</h1><p>充值后，用本站积分租号和续费。</p></div><Button variant="outline" disabled={busy} onClick={() => void refresh()}>刷新账户</Button></div>
    {wallet.isError && <p role="alert">{errorMessage(wallet.error)} <Button variant="outline" onClick={() => void wallet.refetch()}>重试</Button></p>}
    <div className="points-balances"><section className="points-panel"><span>可用积分</span><strong>{wallet.data ? formatPoints(wallet.data.availablePoints) : "正在读取…"}</strong><p>余额与明细以本站账户记录为准。</p></section><section className="points-panel"><span>冻结积分</span><strong>{wallet.data ? formatPoints(wallet.data.frozenPoints) : "正在读取…"}</strong><p>开通或续费处理中，结果确认后结算。</p></section></div>
    {wallet.data?.status !== "ACTIVE" && wallet.data && <p role="alert">账户正在核对，暂不可充值或消费。余额及原有记录保留。</p>}
    {intentId && <section className="points-panel"><h2>继续确认{draft?.kind === "RENEW" ? "续费" : "租号"}</h2>{intent.isError ? <p role="alert">{errorMessage(intent.error)}</p> : !draft ? <p>正在读取原来的选择…</p> : <><p>{draft.number ?? "同号续费"} · {draft.termDays} 天 · {plan ? formatPoints(plan.pointsPrice) : "套餐已下架"}</p><p>充值期间不保号，提交时会再次检查号码和价格。</p>{draft.priceChanged && <p role="alert">套餐价格已变化。请确认下方显示的当前积分价。</p>}{draft.orderId ? <p>这份草稿已经生成订单。<Link to="/app/billing">查看订单</Link></p> : unavailable ? <p>原号码、套餐或草稿已不可用。已有余额可继续使用，<Link to="/app/new">重新选号</Link>。</p> : <Button disabled={!canPurchase || busy} onClick={() => purchase.mutate()}>{purchase.isPending ? "正在提交…" : canPurchase ? "确认使用积分购买" : "积分不足，请先充值"}</Button>}</>}</section>}
    <section className="points-panel"><h2>充值积分</h2>{config.isPending ? <p>正在读取充值规则…</p> : config.isError ? <p role="alert">{errorMessage(config.error)} <Button variant="outline" onClick={() => void config.refetch()}>重试</Button></p> : !rules || !config.data?.configured ? <p>本站尚未配置充值币种与兑换规则，当前不可创建充值单。</p> : <>
      {config.data.demo && <p className="points-demo">当前为模拟支付，不收取真实资金。</p>}<p>单笔 {formatRechargeAmount(rules.minimumMinor, rules, "zh-CN")} 至 {formatRechargeAmount(rules.maximumMinor, rules, "zh-CN")}。{rules.dailyMinor !== null && <>每日最多 {formatRechargeAmount(rules.dailyMinor, rules, "zh-CN")}。</>}{rules.exchangeAmountMinor && rules.exchangePoints && <>{formatRechargeAmount(rules.exchangeAmountMinor, rules, "zh-CN")} 可兑换 {formatPoints(rules.exchangePoints)}。</>}</p>
      <form onSubmit={submit} className="points-form"><div className="points-actions">{rules.presetsMinor.map(value => <Button type="button" variant={amount === rechargeAmountInput(value, rules.fractionDigits) ? "default" : "outline"} key={value} onClick={() => setAmount(rechargeAmountInput(value, rules.fractionDigits))}>{formatRechargeAmount(value, rules, "zh-CN")}</Button>)}</div><Label htmlFor="point-amount">自定义金额（{rules.currency}）</Label><Input id="point-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required /><p>{quoted?.points != null ? `预计获得 ${formatPoints(quoted.points)}` : "请输入符合当前精度与兑换规则的金额。"}</p><Button type="submit" disabled={busy || !config.data.enabled || !config.data.channelAvailable || wallet.data?.status !== "ACTIVE" || quoted?.points == null}>{create.isPending ? "正在创建…" : intentId ? "充值后返回确认" : "创建充值订单"}</Button>{(!config.data.enabled || !config.data.channelAvailable) && <p>在线充值暂未开放。</p>}</form>
    </>}</section>
    {rechargeId && <section className="points-panel"><h2>充值结果</h2>{recharge.isError ? <p role="alert">{errorMessage(recharge.error)}</p> : !recharge.data ? <p>正在读取…</p> : <><p>{formatRechargeAmount(recharge.data.amountMinor, recharge.data, "zh-CN")} · {formatPoints(recharge.data.points)} · <strong>{pointStatus[recharge.data.status] ?? recharge.data.status}</strong></p><small>订单 {recharge.data.orderNumber || recharge.data.id}</small>{recharge.data.credited ? <p>积分已到账。{intentId ? "请在上方确认购买，充值不会自动开通号码。" : "现在可以选择号码或续费。"}</p> : <p>以本地入账状态为准。查单请求由后台处理，支付完成后仍需等待积分入账。</p>}{recharge.data.lastError && <p role="alert">{recharge.data.lastError}</p>}<div className="points-actions"><Button variant="outline" disabled={busy} onClick={() => check.mutate(false)}>请求核对支付结果</Button>{config.data?.demo && recharge.data.environment === "DEMO" && ["PENDING", "CHECKING", "EXPIRED"].includes(recharge.data.status) && <Button disabled={busy} onClick={() => check.mutate(true)}>模拟支付</Button>}</div>{config.data?.demo && recharge.data.environment === "DEMO" && <details><summary>模拟支付场景</summary><Label htmlFor="payment-scenario">支付结果</Label><select id="payment-scenario" value={scenario} onChange={event => setScenario(event.target.value as OnceDemoPayInput["scenario"])}><option value="SUCCESS">成功</option><option value="FAILURE">明确失败</option><option value="UNKNOWN_SUCCESS">先未知，后台核对后成功</option><option value="UNKNOWN_FAILURE">先未知，后台核对后失败</option></select></details>}</>}</section>}
    <p className="points-muted">现金退款当前不可用；历史退款记录继续保留。</p>
    <div className="points-actions" role="tablist" aria-label="账户记录">{(["ledger", "recharges", "refunds"] as const).map(kind => <Button key={kind} role="tab" aria-selected={tab === kind} variant={tab === kind ? "default" : "outline"} onClick={() => setTab(kind)}>{kind === "ledger" ? "积分明细" : kind === "recharges" ? "充值记录" : "历史退款记录"}</Button>)}</div><History key={tab} kind={tab} />
  </main>;
}
