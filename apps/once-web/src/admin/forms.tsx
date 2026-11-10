import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { useApp } from "../app/AppProvider";
import { adminApi, adminError, adminKeys } from "./api";
import { parseAmount } from "./actions";
import { ConfirmDialog, ReasonField, money, useOperationKey } from "./primitives";
import { countryNames, regionOptions, resolveRegion } from "./regions";
import type { AdminNumber, AdminPlan, AdminSettings, ImportPreview, NumberInput } from "./types";

/** One audited write: shared busy state, error text, admin cache refresh and success toast. */
function useAdminWrite<T>(name: string, run: (key: string) => Promise<T>, onDone: (value: T) => void) {
  const client = useQueryClient();
  const { notify } = useApp();
  const key = useOperationKey();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => run(key),
    onSuccess: async value => {
      await client.invalidateQueries({ queryKey: adminKeys.all });
      notify(`${name}已完成，操作已记入日志。`, "success");
      onDone(value);
    },
    onError: cause => setError(adminError(cause)),
  });
  return { busy: mutation.isPending, error, setError, submit: () => { setError(""); mutation.mutate(); } };
}
function WriteDialog({ title, busy, error, onClose, onSubmit, submitLabel, children }: {
  title: string; busy: boolean; error: string; onClose: () => void; onSubmit: () => void; submitLabel?: string; children: ReactNode;
}) {
  return <ConfirmDialog title={title} busy={busy} onClose={onClose} footer={<>
    <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
    <Button type="submit" form="oa-write-form" disabled={busy}>{busy ? <RefreshCw className="oa-spin" /> : <Check />}{submitLabel ?? `确认${title}`}</Button></>}>
    <form id="oa-write-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}><fieldset disabled={busy}>
      {children}
      {error && <p role="alert" className="oa-error">{error}</p>}
    </fieldset></form>
  </ConfirmDialog>;
}

export function PlanDialog({ plan, onClose }: { plan: AdminPlan | null; onClose: () => void }) {
  const [days, setDays] = useState(plan ? String(plan.days) : "");
  const [price, setPrice] = useState(plan ? (plan.priceMinor / 100).toString() : "");
  const [points, setPoints] = useState(plan?.pointsPrice === undefined ? "" : String(plan.pointsPrice));
  const [currency, setCurrency] = useState(plan?.currency ?? "USD");
  const [label, setLabel] = useState(plan?.label ?? "");
  const [note, setNote] = useState(plan?.note ?? "");
  const [active, setActive] = useState(plan?.active ?? true);
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 0));
  const [reason, setReason] = useState("");
  const name = plan ? "编辑套餐" : "新建套餐";
  const write = useAdminWrite(name, key => {
    if (plan && plan.version === undefined) throw new Error("请重新载入套餐版本后再保存。");
    const body = { days: Number(days), priceMinor: parseAmount(price) ?? 0, pointsPrice: Number(points), currency, label: label.trim(), note: note.trim(), active, sortOrder: Number(sortOrder), reason, ...(plan ? { version: plan.version } : {}) };
    return plan ? adminApi.updatePlan(plan.id, body, key) : adminApi.createPlan(body, key);
  }, onClose);
  function submit() {
    if (!plan && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365)) return write.setError("天数需要是 1–365 的整数。");
    if (!price.trim() || parseAmount(price) === null) return write.setError("价格格式不正确，例如 12 或 12.5。");
    if (!points.trim() || !Number.isSafeInteger(Number(points)) || Number(points) < 1) return write.setError("请填写正整数消费积分。");
    if (!/^[A-Z]{3}$/.test(currency)) return write.setError("币种需要是三位大写代码。");
    if (!label.trim()) return write.setError("请填写套餐名称。");
    if (!Number.isInteger(Number(sortOrder))) return write.setError("排序需要是整数。");
    if (reason.trim().length < 3) return write.setError("请填写至少 3 个字的操作原因。");
    write.submit();
  }
  const perDay = parseAmount(price) && Number(days) > 0 ? money(Math.round(parseAmount(price)! / Number(days)), currency) : "";
  return <WriteDialog title={name} busy={write.busy} error={write.error} onClose={onClose} onSubmit={submit}>
    {plan && <p className="oa-confirm-target">{plan.days} 天套餐<small>天数是套餐的标识，创建后不能修改；改价只影响之后的新订单。</small></p>}
    <div className="oa-form-row">
      {!plan && <label>天数<Input type="number" min={1} max={365} required value={days} onChange={event => setDays(event.target.value)} placeholder="例如 90" /></label>}
      <label>历史金额参考（{currency}）<Input inputMode="decimal" required value={price} onChange={event => setPrice(event.target.value)} placeholder="例如 12" />
        {perDay && <small>折合每天约 {perDay}</small>}</label>
    </div>
    <div className="oa-form-row"><label>消费积分<Input type="number" min={1} step={1} required value={points} onChange={event => setPoints(event.target.value)} /><small>新购买及续费按此积分价结算。</small></label><label>参考金额币种<Input required maxLength={3} pattern="[A-Z]{3}" value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label></div>
    <div className="oa-form-row">
      <label>套餐名称<Input required maxLength={20} value={label} onChange={event => setLabel(event.target.value)} placeholder="例如 整月独享" /></label>
      <label>排序<Input type="number" value={sortOrder} onChange={event => setSortOrder(event.target.value)} /><small>数字小的排在前面</small></label>
    </div>
    <label>一句话说明<Input maxLength={60} value={note} onChange={event => setNote(event.target.value)} placeholder="显示在选号页和首页价格卡上" /></label>
    <label className="oa-check-row"><Checkbox checked={active} onCheckedChange={checked => setActive(checked === true)} /><span>上架销售<small>取消勾选后，用户在首页、选号页和续费时都看不到这个套餐；已购买的不受影响。</small></span></label>
    <ReasonField value={reason} onChange={setReason} disabled={write.busy} suggestions={plan ? ["调整价格", "暂停销售", "恢复销售"] : ["新增销售套餐"]} />
  </WriteDialog>;
}

const regionChoices = regionOptions.map(region => ({ value: `${region.countryCode}:${region.id}`, label: `${region.name}`,
  description: `${countryNames[region.countryCode]} · ${region.areaCodes.slice(0, 4).join(" / ")}` }));

export function NumberDialog({ number, onClose }: { number: AdminNumber | null; onClose: () => void }) {
  const [value, setValue] = useState(number?.number ?? "");
  const [region, setRegion] = useState(number ? `${number.countryCode}:${number.regionId}` : "");
  const [note, setNote] = useState(number?.note ?? "");
  const [resourceExpiry, setResourceExpiry] = useState(() => number?.resourceExpiresAt ? new Date(Date.parse(number.resourceExpiresAt) - new Date(number.resourceExpiresAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
  const [providerNumberId, setProviderNumberId] = useState(number?.providerNumberId ?? "");
  const [reason, setReason] = useState("");
  const name = number ? "编辑号码" : "新增号码";
  // Suggest the state from the area code while the operator types a new number.
  const guessed = !number && !region ? resolveRegion("", value) : undefined;
  const chosen = regionOptions.find(item => `${item.countryCode}:${item.id}` === region) ?? guessed;
  const write = useAdminWrite(name, key => {
    const fields = { countryCode: chosen!.countryCode, regionId: chosen!.id, regionName: chosen!.name, note: note.trim(), reason, resourceExpiresAt: new Date(resourceExpiry).toISOString(), ...(providerNumberId.trim() ? { providerNumberId: providerNumberId.trim() } : {}) };
    return number ? adminApi.updateNumber(number.id, fields, key) : adminApi.createNumber({ ...fields, number: value }, key);
  }, onClose);
  function submit() {
    if (!number && value.replace(/\D/g, "").length < 10) return write.setError("请填写完整的 10 位号码，例如 212 555 0100。");
    if (!chosen) return write.setError("请选择州 / 省。");
    if (!Number.isFinite(Date.parse(resourceExpiry)) || Date.parse(resourceExpiry) <= Date.now()) return write.setError("请填写已确认且尚未到期的上游资源期限。");
    if (reason.trim().length < 3) return write.setError("请填写至少 3 个字的操作原因。");
    write.submit();
  }
  return <WriteDialog title={name} busy={write.busy} error={write.error} onClose={onClose} onSubmit={submit}>
    {number ? <p className="oa-confirm-target oa-mono">{number.number}<small>号码本身不能修改；录错了可以删除后重新添加（仅限从未租用过的号码）。</small></p>
      : <label>号码<Input required value={value} inputMode="tel" placeholder="+1 212 555 0100" onChange={event => setValue(event.target.value)} /><small>美国、加拿大号码，可以不带 +1 和空格</small></label>}
    <label>州 / 省<Combobox label="州 / 省" value={chosen ? `${chosen.countryCode}:${chosen.id}` : ""} placeholder="搜索州名或区号" options={regionChoices} onValueChange={setRegion} />
      {guessed && <small>已按区号 {value.replace(/\D/g, "").slice(-10, -7)} 自动匹配为 {guessed.name}，可以修改。</small>}</label>
    <label>备注<Input maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder="例如：采购批次、SIM 卡编号" /></label>
    <label>已确认资源到期<Input type="datetime-local" required value={resourceExpiry} onChange={event => setResourceExpiry(event.target.value)} /><small>仅登记已确认的上游期限；修改这里不会向 PinClode 续期。</small></label>
    <label>上游号码 ID（可选）<Input value={providerNumberId} maxLength={128} onChange={event => setProviderNumberId(event.target.value)} /></label>
    <ReasonField value={reason} onChange={setReason} disabled={write.busy} suggestions={number ? ["修正归属地区", "补充备注"] : ["新采购号码入库", "补录号码"]} />
  </WriteDialog>;
}

/** CSV columns: number, region, confirmed resource expiry, optional provider ID, note. */
function parseRows(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] && /号码|number/i.test(lines[0])) lines.shift();
  return lines.map(line => {
    const [number = "", region = "", resourceExpiresAt = "", providerNumberId = "", ...rest] = line.split(/\t|,|，/).map(cell => cell.trim());
    const match = resolveRegion(region, number);
    const row: NumberInput = { number, countryCode: match?.countryCode ?? "", regionId: match?.id ?? "", regionName: match?.name ?? region, resourceExpiresAt, ...(providerNumberId ? { providerNumberId } : {}), note: rest.join(" ") };
    return row;
  });
}
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [reason, setReason] = useState("新采购号码入库");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const rows = useMemo(() => parseRows(text), [text]);
  const write = useAdminWrite("批量导入", key => adminApi.importNumbers({ rows, reason }, key), onClose);
  async function check() {
    write.setError(""); setChecking(true);
    try { setPreview(await adminApi.previewImport(rows)); }
    catch (cause) { write.setError(adminError(cause)); }
    finally { setChecking(false); }
  }
  function submit() {
    if (!preview) return void check();
    if (preview.errors.length) return write.setError("请先修正标红的行，再重新预览。");
    if (reason.trim().length < 3) return write.setError("请填写至少 3 个字的操作原因。");
    write.submit();
  }
  const busy = write.busy || checking;
  return <WriteDialog title="批量导入号码" busy={busy} error={write.error} onClose={onClose} onSubmit={submit}
    submitLabel={!preview ? "检查数据" : preview.errors.length ? "请先修正" : `导入 ${preview.valid.length} 个号码`}>
    <p className="oa-context">每行：<b>号码, 州或省, 已确认资源到期（ISO 时间）, 上游号码 ID（可空）, 备注</b>。地区可按区号识别，资源到期时间必须明确。最多 1000 行。</p>
    <label>号码数据<Textarea rows={8} value={text} className="oa-mono" placeholder="号码,州或省,资源到期（ISO）,上游号码ID,备注"
      onChange={event => { setText(event.target.value); setPreview(null); }} /><small>已识别 {rows.length} 行</small></label>
    {preview && <div className="oa-import-result">
      <p><strong className="oa-ok">{preview.valid.length} 行可以导入</strong>{preview.errors.length > 0 && <strong className="oa-error-text">，{preview.errors.length} 行需要修正</strong>}</p>
      {preview.errors.length > 0 && <ul className="oa-skip-list">{preview.errors.slice(0, 50).map(item => <li key={item.line}><strong>第 {item.line} 行</strong>{item.message}</li>)}</ul>}
      {preview.valid.length > 0 && <p className="oa-context">将导入：{preview.valid.slice(0, 5).map(row => `${row.number}（${row.regionName}）`).join("、")}{preview.valid.length > 5 ? ` 等 ${preview.valid.length} 个` : ""}</p>}
    </div>}
    <ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={["新采购号码入库", "补录号码"]} />
  </WriteDialog>;
}

export function SettingsDialog({ settings, onClose }: { settings: AdminSettings; onClose: () => void }) {
  const [auto, setAuto] = useState(settings.cooldownDays !== null);
  const [days, setDays] = useState(String(settings.cooldownDays ?? 7));
  const [reason, setReason] = useState("");
  const write = useAdminWrite("修改到期规则", key => {
    if (settings.version === undefined) throw new Error("请重新载入到期规则版本后再保存。");
    return adminApi.updateSettings({ cooldownDays: auto ? Number(days) : null, version: settings.version, reason }, key);
  }, onClose);
  function submit() {
    if (auto && !(Number.isInteger(Number(days)) && Number(days) >= 0 && Number(days) <= 365)) return write.setError("保留天数需要是 0–365 的整数。");
    if (reason.trim().length < 3) return write.setError("请填写至少 3 个字的操作原因。");
    write.submit();
  }
  return <WriteDialog title="到期号码规则" busy={write.busy} error={write.error} onClose={onClose} onSubmit={submit} submitLabel="保存规则">
    <p className="oa-context">租约到期后，号码先为原用户保留，期间不会卖给别人。保留期结束后，可以自动回到可售库存，也可以只由管理员手动释放。</p>
    <label className="oa-check-row"><Checkbox checked={auto} onCheckedChange={checked => setAuto(checked === true)} /><span>保留期结束后自动重新上架<small>不勾选：到期号码一直保留，直到管理员在号码库存里手动释放。</small></span></label>
    {auto && <label>保留天数<Input type="number" min={0} max={365} value={days} onChange={event => setDays(event.target.value)} />
      <small>到期后保留 {Number(days) || 0} 天再上架。填 0 表示到期后立即上架。号码再卖给别人后，上一位用户的验证码可能发到新用户手里，建议至少保留 30 天。</small></label>}
    <ReasonField value={reason} onChange={setReason} disabled={write.busy} suggestions={["确定到期保留规则", "调整保留天数"]} />
  </WriteDialog>;
}
