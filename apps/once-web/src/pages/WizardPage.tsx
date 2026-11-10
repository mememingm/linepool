import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Shuffle } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Combobox } from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApp } from "../app/AppProvider";
import { initialWizard, useUIStore } from "../stores/ui-store";
import { inventoryOptions, plansOptions, queryKeys, workspaceScope } from "../lib/queries";
import {
  ApiError,
  completeOperation,
  operationKey,
  queryClient,
  request,
} from "../lib/api";
import {
  countries,
  errorMessage,
  formatMoney,
  leasePath,
  localDemo,
  regions,
  type MutationResult,
} from "../lib/models";
import { inventoryForSelection } from "../lib/inventory";
import { usePointAccount, formatPoints, planPoints, pointKeys } from "../lib/points";
import { PublicHeader } from "../components/Shell";
import { Icon } from "../components/ui";
/** `embedded` renders inside the signed-in workspace shell instead of the public site header. */
export function WizardPage({ embedded = false }: { embedded?: boolean }) {
  const { account, notify } = useApp();
  const wizard = useUIStore((state) => state.wizard);
  const setWizard = useUIStore((state) => state.setWizard);
  const navigate = useNavigate();
  const plans = useQuery(plansOptions());
  const terms = plans.data ?? [];
  const wallet = usePointAccount();
  async function rechargeForSelection() {
    if (!account || !term?.version) throw new Error("请先确认套餐报价。");
    const intent = await request<{ id: string }>("/points/intents", { method: "POST", body: { kind: "RENT", number: wizard.number, term: wizard.term, quoteVersion: term.version } });
    navigate(`/app/points?intent=${encodeURIComponent(intent.id)}`);
  }
  const country = countries.find((item) => item.code === wizard.country),
    region = (regions[wizard.country] || []).find(
      (item) => item.id === wizard.region,
    ),
    term = terms.find((item) => item.days === wizard.term);
  const inventory = useQuery({
    ...inventoryOptions(),
    enabled: wizard.step >= 4,
  });
  const selectedNumber = inventory.data?.find(item => item.number === wizard.number);
  const stepper = useRef<HTMLDivElement>(null);
  const previousStep = useRef(wizard.step);
  useLayoutEffect(() => {
    if (previousStep.current === wizard.step) return;
    previousStep.current = wizard.step;
    stepper.current?.scrollIntoView({ block: "start", behavior: "instant" });
    document.querySelector<HTMLElement>(".wizard-title h2")?.focus({ preventScroll: true });
  }, [wizard.step]);
  const [numberSearch, setNumberSearch] = useState("");
  const [areaCode, setAreaCode] = useState("all");
  useEffect(() => { setAreaCode("all"); setNumberSearch(""); }, [wizard.country, wizard.region]);
  const candidates = useMemo(
    () => inventoryForSelection(inventory.data || [], wizard.country, wizard.region),
    [inventory.data, wizard.country, wizard.region],
  );
  const areaCodes = useMemo(() => [...new Set(candidates.map(item => item.number.replace(/\D/g, "").slice(1, 4)))].sort(), [candidates]);
  const available = useMemo(() => {
    const query = numberSearch.replace(/\D/g, "");
    return candidates.filter(item => {
      const digits = item.number.replace(/\D/g, "");
      return (areaCode === "all" || digits.slice(1, 4) === areaCode) && (!numberSearch.trim() || (query && digits.includes(query)));
    });
  }, [candidates, areaCode, numberSearch]);
  const batchScope = `${wizard.country}:${wizard.region}:${areaCode}:${numberSearch}`;
  const [batch, setBatch] = useState({ scope: batchScope, index: 0 });
  const batchCount = Math.ceil(available.length / 6);
  const batchIndex = batch.scope === batchScope && batchCount
    ? batch.index % batchCount
    : 0;
  const visibleNumbers = available.slice(batchIndex * 6, batchIndex * 6 + 6);
  const changeBatch = () => {
    if (batchCount <= 1 || inventory.isFetching) return;
    setBatch({ scope: batchScope, index: (batchIndex + 1) % batchCount });
    setWizard((previous) => ({ ...previous, number: "", agreed: false }));
  };
  useEffect(() => {
    if (
      inventory.data &&
      wizard.number &&
      !inventory.data.some((item) => item.number === wizard.number)
    )
      setWizard((previous) => ({ ...previous, number: "", agreed: false }));
  }, [inventory.data, wizard.number, setWizard]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!account || !wizard.number || !term) return;
      if (!localDemo() && !term.version) throw new Error("套餐报价尚未加载，请稍后重试。");
      if (!localDemo() && wallet.data && wallet.data.availablePoints < planPoints(term)) { await rechargeForSelection(); return; }
      const selected = inventory.data?.find(
        (item) => item.number === wizard.number,
      );
      if (!selected) throw new Error("这个号码已不可用，请重新选择。");
      const signature = `rent:${selected.number}:${wizard.term}:${term.version ?? "offline"}`;
      const result = await request<MutationResult>("/leases", {
        method: "POST",
        headers: { "Idempotency-Key": operationKey(account.id, signature) },
        body: { number: selected.number, term: wizard.term, ...(!localDemo() ? { quoteVersion: term.version } : {}) },
      });
      if (result.status === "FAILED") { completeOperation(account.id, signature); throw new Error("订单未完成，请检查订单记录与积分解冻结果。"); }
      if (result?.orderId && !result.leaseId) { completeOperation(account.id, signature); await queryClient.invalidateQueries({ queryKey: pointKeys.all(account.id) }); navigate("/app/billing"); notify("订单已保存，正在处理，请在订单页核对结果。"); return; }
      if (!result?.leaseId || !["DEMO_CONFIRMED", "CONFIRMED", "COMPLETED"].includes(result.status))
        throw new Error("租赁结果尚未确认，请先检查订单后重试。");
      completeOperation(account.id, signature);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces(workspaceScope(account.id)),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory() });
      await queryClient.invalidateQueries({ queryKey: pointKeys.all(account.id) });
      setWizard(initialWizard);
      navigate(leasePath("numbers", result.leaseId));
      notify("租赁记录已保存。");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "INSUFFICIENT_POINTS") { void rechargeForSelection().catch(e => notify(errorMessage(e), "error")); return; }
      if (error instanceof ApiError && error.code === "QUOTE_CHANGED") void queryClient.invalidateQueries({ queryKey: queryKeys.plans() });
      notify(errorMessage(error), "error");
      if (error instanceof ApiError && error.status === 409 && (!error.code || error.code === "NUMBER_UNAVAILABLE")) {
        setWizard((previous) => ({
          ...previous,
          step: 4,
          number: "",
          agreed: false,
        }));
        void inventory.refetch();
      }
    },
  });
  const update = (patch: Partial<typeof wizard>) =>
    setWizard((previous) => ({ ...previous, ...patch }));
  const next = () => update({ step: Math.min(5, wizard.step + 1) }),
    back = () => update({ step: Math.max(1, wizard.step - 1) });
  const confirm = () => {
    if (!account) navigate("/login", { state: { returnTo: "/numbers/new" } });
    else if (!mutation.isPending) mutation.mutate();
  };
  if (account?.authKind === "PINCLODE") return <Navigate to="/agent" replace />;
  const stage = wizard.step <= 3 ? 1 : wizard.step === 4 ? 2 : 3;
  const body = (
        <>
          {!embedded && <div className="breadcrumb">
            <Link to={account ? "/app/overview" : "/"}>{account ? "返回工作台" : "首页"}</Link>
            <span>/</span>
            <strong>选择号码</strong>
          </div>}
          <div className="page-head">
            <div>
              <h1>{embedded ? "租用新号码" : "选择你的专属号码"}</h1>
            </div>
          </div>
          <div className="wizard-layout">
            <section className="wizard-main">
              <div className="stepper" aria-label="租赁流程" ref={stepper}>
                {["条件", "选号码", "确认"].map((name, index) => (
                  <Fragment key={name}>
                    <div
                      aria-current={stage === index + 1 ? "step" : undefined}
                      className={`step-node ${stage === index + 1 ? "active" : ""} ${stage > index + 1 ? "done" : ""}`}
                    >
                      <span className="step-circle">
                        {stage > index + 1 ? "✓" : index + 1}
                      </span>
                      <span>
                        阶段{index + 1} · {name}
                        {index === 0 && stage === 1 && <small className="wizard-substep">{wizard.step}/3 · {["国家", "地区", "租期"][wizard.step - 1]}</small>}
                      </span>
                    </div>
                    {index < 2 && <span className="step-line" />}
                  </Fragment>
                ))}
              </div>
              {wizard.step === 1 && (
                <>
                  <div className="wizard-title">
                    <h2 tabIndex={-1}>你想在哪个国家使用？</h2>
                  </div>
                  <div className="wizard-selector"><Label>国家 / 地区</Label>
                    <Combobox label="选择国家或地区" value={wizard.country} placeholder="选择国家或地区"
                      onValueChange={value => update({country: value, region: "all", term: 0, number: "", agreed: false})}
                      options={countries.map(item => ({value: item.code, label: `${item.name} · ${item.dial}`, description: item.detail, disabled: !item.available}))} />
                  </div>
                </>
              )}
              {wizard.step === 2 && (
                <>
                  <div className="wizard-title">
                    <h2 tabIndex={-1}>选择使用地区</h2>
                  </div>
                  <div className="wizard-selector"><Label>地区与区号</Label><Combobox label="地区与区号" value={wizard.region} placeholder="搜索或选择地区" onValueChange={value => update({region: value, number: "", agreed: false})} options={(regions[wizard.country] || []).map(item => ({value: item.id, label: `${item.name} · ${item.area}`, description: item.detail}))} /></div>
                </>
              )}
              {wizard.step === 3 && (
                <>
                  <div className="wizard-title">
                    <h2 tabIndex={-1}>你需要使用多久？</h2>
                    {plans.isPending ? <p role="status">正在读取套餐…</p> : plans.isError ? <p role="alert">{errorMessage(plans.error)} <Button variant="outline" onClick={() => void plans.refetch()}>重新读取</Button></p> : !terms.length ? <p>当前没有上架的套餐。</p> : null}
                  </div>
                  <RadioGroup value={String(wizard.term)} onValueChange={value => update({term: Number(value)})} className="term-selector option-grid" aria-label="租期" required>
                    {terms.map(item => <Label key={item.days} htmlFor={`rent-term-${item.days}`} className={`option-card term-card ${wizard.term === item.days ? "selected" : ""}`}>
                      <RadioGroupItem id={`rent-term-${item.days}`} value={String(item.days)} data-term={item.days} aria-label={`${item.days} 天 · ${item.label} · ${(localDemo() ? formatMoney(item.price) : formatPoints(planPoints(item)))}`} />
                      <strong>{item.days} 天</strong><span>{item.label}</span>
                      <small>{item.note}</small>
                      <b className="term-price">{(localDemo() ? formatMoney(item.price) : formatPoints(planPoints(item)))}</b>
                    </Label>)}
                  </RadioGroup>
                </>
              )}
              {wizard.step === 4 && (
                <>
                  <div className="wizard-title">
                    <h2 tabIndex={-1}>选择一个号码</h2>
                    <p>
                      {country?.name} · {region?.name} · {wizard.term} 天{(localDemo() || (available.length > 0 && available.every(item => item.demo))) && " · 演示号码（非真实手机号码）"}
                    </p>
                  </div>
                  <div className="inventory-picker">
                    <div className="inventory-filters">
                      <Label htmlFor="inventory-number-search">搜索号码<Input id="inventory-number-search" type="search" inputMode="tel" placeholder="输入完整号码或部分数字" value={numberSearch} onChange={event => { setNumberSearch(event.target.value); update({ number: "", agreed: false }); }} /></Label>
                      <div><Label>区号</Label><Combobox label="按区号筛选" value={areaCode} onValueChange={value => { setAreaCode(value); update({ number: "", agreed: false }); }} options={[{ value: "all", label: "全部区号" }, ...areaCodes.map(code => ({ value: code, label: code }))]} /></div>
                    </div>
                    <div className="inventory-toolbar">
                      <div className="inventory-count">
                        <strong>{inventory.isPending ? "正在读取库存" : `${available.length} 个可选号码`}</strong>
                        <span>{available.length ? `每组最多 6 个 · 第 ${batchIndex + 1} / ${batchCount} 组` : "按当前国家与地区匹配"}</span>
                      </div>
                      <div className="inventory-actions">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="inventory-batch-button"
                          disabled={available.length <= 6 || inventory.isFetching || inventory.isError}
                          onClick={changeBatch}
                        >
                          <Shuffle aria-hidden="true" />
                          换一批
                        </Button>
                      </div>
                    </div>
                  {inventory.isPending ? <div className="number-grid" role="status" aria-label="正在读取可用号码">{Array.from({length: 6}, (_, i) => <Skeleton key={i} className="inventory-skeleton" />)}</div> : available.length ? (
                      <div
                        key={`${batchScope}:${batchIndex}:${visibleNumbers.map((item) => item.id).join(":")}`}
                        className="number-grid inventory-number-grid"
                        aria-label="可选号码"
                        aria-busy={inventory.isFetching}
                        data-refreshing={inventory.isFetching}
                      >
                        {visibleNumbers.map((item) => {
                          const selected = wizard.number === item.number;
                          return (
                            <Button
                              type="button"
                              variant="ghost"
                              key={item.id}
                              className={`number-card ${selected ? "selected" : ""}`}
                              data-number={item.number}
                              aria-label={`${item.number}，${item.countryName} · ${item.regionName}`}
                              aria-pressed={selected}
                              disabled={inventory.isFetching || inventory.isError}
                              onClick={() => update({ number: item.number, agreed: false })}
                            >
                              <span className="number-card-content">
                                <strong>{item.number}</strong>
                                <span className="number-card-meta">
                                  <span>{item.countryName} · {item.regionName}</span>
                                  {item.id === available[0]?.id && (
                                    <span className="recommend-badge">推荐</span>
                                  )}
                                </span>
                              </span>
                              <span className="inventory-selection-indicator" aria-hidden="true">
                                {selected && <Check size={14} />}
                              </span>
                            </Button>
                          );
                        })}
                      </div>
                  ) : (
                    <Empty
                      className={
                        inventory.isPending || inventory.isError
                          ? "data-state"
                          : "empty-state compact"
                      }
                    >
                      <h2>
                        {inventory.isError
                          ? "库存暂不可用"
                          : inventory.isPending
                            ? "正在加载号码"
                            : "当前没有可用号码"}
                      </h2>
                      <p>
                        {inventory.isError
                          ? errorMessage(inventory.error)
                          : inventory.isPending
                            ? "正在读取当前库存。"
                            : "暂未提供匹配号码，请更换地区或稍后重试。"}
                      </p>
                    </Empty>
                  )}
                    <p
                      className={`inventory-status ${inventory.isError ? "inventory-status-error" : ""}`}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {inventory.isFetching ? (
                        <>正在获取最新库存…</>
                      ) : inventory.isError ? (
                        <>库存读取失败。<Button variant="link" size="sm" onClick={() => void inventory.refetch()}>重试</Button></>
                      ) : inventory.dataUpdatedAt ? (
                        <>最近同步 {new Date(inventory.dataUpdatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</>
                      ) : null}
                    </p>
                  </div>
                </>
              )}
              {wizard.step === 5 && country && region && term && (
                <>
                  <div className="wizard-title">
                    <h2 tabIndex={-1}>确认你的号码</h2>
                  </div>
                  <div className="confirm-grid">
                    <div className="confirm-panel">
                      <h3>号码与能力</h3>
                      <div className="confirm-number">{wizard.number}</div>
                      <div className="capability-list">
                        <div><Icon name="smartphone" /><span>{selectedNumber?.countryName || country.name} · {selectedNumber?.regionName || "归属地区暂未提供"}</span></div>
                        {(localDemo() || selectedNumber?.demo) && <div className="capability-unavailable"><Icon name="clock-3" /><span>演示号码：收到的短信为模拟数据</span></div>}
                        <div><Check className="capability-available" size={18} aria-hidden="true" /><span>验证码显示与复制</span></div>
                        <div className="capability-unavailable"><Icon name="circle-help" /><span>短信发送以号码能力为准</span></div>
                      </div>
                    </div>
                    <div className="confirm-panel">
                      <h3>租期与积分</h3>
                      {!localDemo() && <p>可用积分：{wallet.data ? formatPoints(wallet.data.availablePoints) : "正在读取"}；充值期间不保号。</p>}
                      <div className="summary-line">
                        <span>租期</span>
                        <strong>{term.days} 天</strong>
                      </div>
                      <div className="summary-line">
                        <span>一次性费用</span>
                        <strong>{localDemo() ? formatMoney(term.price) : formatPoints(planPoints(term))}</strong>
                      </div>
                      <div className="summary-line">
                        <span>自动续费</span>
                        <strong>不会开启</strong>
                      </div>
                      <div className="summary-total">
                        <span>合计</span>
                        <strong>{localDemo() ? formatMoney(term.price) : formatPoints(planPoints(term))}</strong>
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div className="wizard-actions">
                {wizard.step > 1 ? (
                  <Button variant="ghost"
                    className="ghost-btn"
                    data-action="back"
                    disabled={mutation.isPending}
                    onClick={back}
                  >
                    ← {wizard.step === 5 ? "返回选号" : "返回"}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="wizard-actions-right">
                  {wizard.step === 5 ? (
                    <Button variant="default"
                      className="primary-btn"
                      data-action="confirm"
                      disabled={!wizard.number || !term?.version || plans.isError || inventory.isFetching || inventory.isError || mutation.isPending}
                      aria-busy={mutation.isPending}
                      onClick={confirm}
                    >
                      {mutation.isPending
                        ? "提交中…"
                        : account
                          ? (!localDemo() && wallet.data && term && wallet.data.availablePoints < planPoints(term) ? "充值后返回确认" : "确认使用积分租赁")
                          : "登录后确认租赁"}
                    </Button>
                  ) : (
                    <Button variant="default"
                      className="primary-btn"
                      data-action="next"
                      disabled={
                        wizard.step === 1
                          ? !wizard.country
                          : wizard.step === 2
                            ? !wizard.region
                            : wizard.step === 3
                              ? !term || plans.isPending || plans.isError
                              : !wizard.number ||
                                inventory.isFetching ||
                                inventory.isError
                      }
                      onClick={next}
                    >
                      {
                        [
                          "继续选择地区 →",
                          "继续选择租期 →",
                          "查看可选号码 →",
                          "查看确认信息 →",
                        ][wizard.step - 1]
                      }
                    </Button>
                  )}
                </div>
              </div>
            </section>
            <aside className="summary-card">
              <h3>你的选择</h3>
              {wizard.number && (
                <div className="summary-number">{wizard.number}</div>
              )}
              {[
                ["国家", country?.name],
                ["地区", region?.name],
                ["租期", term ? `${term.days} 天` : ""],
              ].map(([label, value]) => (
                <div className="summary-line" key={label}>
                  <span>{label}</span>
                  <strong>{value || "未选择"}</strong>
                </div>
              ))}
              {term && (
                <>
                  <div className="summary-total">
                    <span>一次性费用</span>
                    <strong>{localDemo() ? formatMoney(term.price) : formatPoints(planPoints(term))}</strong>
                  </div>
                  <div className="summary-muted">
                    到期后停止服务，不会自动续费。可在有效期内续租同一号码。
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
  );
  if (embedded) return <main className="content wizard-content">{body}</main>;
  return (
    <div className="app product-ui once-ui">
      <PublicHeader active="new" />
      <main className="page">
        <div className="container">{body}</div>
      </main>
    </div>
  );
}
