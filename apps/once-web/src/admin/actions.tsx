import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { passwordSchema } from "@linepool/contracts";
import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApp } from "../app/AppProvider";
import { adminApi, adminError, adminKeys, listOptions, plansOptions } from "./api";
import { ConfirmDialog, ReasonField, daysLeft, useOperationKey } from "./primitives";
import type { AdminLease, AdminNumber, AdminUser, AdminWebhook, BatchResult } from "./types";

export type ActionTarget =
  | { kind: "user-status"; user: AdminUser }
  | { kind: "password"; user: AdminUser }
  | { kind: "assign"; number: AdminNumber }
  | { kind: "assign-user"; user: AdminUser }
  | { kind: "hold"; number: AdminNumber }
  | { kind: "batch"; action: "release" | "hold"; numbers: AdminNumber[] }
  | { kind: "delete-number"; number: AdminNumber }
  | { kind: "end"; lease: AdminLease }
  | { kind: "extend"; lease: AdminLease }
  | { kind: "retry"; event: AdminWebhook };

function title(target: ActionTarget) {
  switch (target.kind) {
    case "user-status": return target.user.status === "ACTIVE" ? "禁用账号" : "启用账号";
    case "password": return "重置密码";
    case "assign": return "手动分配号码";
    case "assign-user": return "给用户开通号码";
    case "hold": return target.number.saleStatus === "HELD" ? "恢复售卖" : "暂停售卖";
    case "batch": return target.action === "release" ? "释放号码" : "暂停售卖";
    case "delete-number": return "删除号码";
    case "end": return "回收号码";
    case "extend": return "租约延期";
    case "retry": return "重新处理事件";
  }
}
const suggestions: Record<ActionTarget["kind"], string[]> = {
  "user-status": ["违规使用", "用户申请注销", "申诉通过，恢复使用"],
  password: ["用户忘记密码", "用户申请重置"],
  assign: ["免费服务补偿", "客户补发号码", "测试使用"],
  "assign-user": ["免费服务补偿", "客户补发号码", "测试使用"],
  hold: ["号码异常暂停售卖", "复核完成，恢复售卖"],
  batch: ["保留期已过，重新上架", "复核完成，恢复售卖", "号码异常暂停售卖"],
  "delete-number": ["录入错误", "号码已失效"],
  end: ["客户退订", "违规使用回收", "分配错误"],
  extend: ["补偿服务中断", "客服补偿"],
  retry: ["已修复号码映射，重新匹配", "上游已恢复，重试"],
};
function subject(target: ActionTarget) {
  if (target.kind === "batch") return `已选择 ${target.numbers.length} 个号码`;
  if ("user" in target) return target.user.email;
  if ("number" in target) return `${target.number.number} · ${target.number.countryName}${target.number.regionName ? ` ${target.number.regionName}` : ""}`;
  if ("lease" in target) return `${target.lease.number} · ${target.lease.email}`;
  return `${target.event.eventId} · ${target.event.provider}`;
}
/** "35" or "35.5" dollars to cents; null when the text is not a valid amount. */
export function parseAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return /^\d{1,7}(\.\d{1,2})?$/.test(trimmed) ? Math.round(Number(trimmed) * 100) : null;
}

function UserPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const users = useQuery(listOptions("users", { status: "ACTIVE", search: term, pageSize: 20 }));
  const options = (users.data?.items ?? []).filter(user => user.role === "USER" && user.authKind !== "PINCLODE");
  const onlyUserId = !users.isPlaceholderData && !users.isFetching && !users.isError && users.data?.totalItems === 1 && options.length === 1 ? options[0]!.id : "";
  useEffect(() => {
    if (onlyUserId && !disabled && value !== onlyUserId) onChange(onlyUserId);
  }, [onlyUserId, disabled, value, onChange]);
  const searchUsers = () => { onChange(""); setTerm(search.trim()); };
  return <><label>查找用户<div className="oa-inline-search">
    <Input value={search} disabled={disabled} placeholder="邮箱或用户 ID" onChange={event => setSearch(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); searchUsers(); } }} />
    <Button type="button" variant="outline" disabled={disabled} onClick={searchUsers}>查找</Button></div></label>
    <label>目标用户<Select value={value} onValueChange={onChange} disabled={disabled || users.isFetching}>
      <SelectTrigger className="oa-select"><SelectValue placeholder={users.isPending ? "正在加载用户…" : options.length ? "请选择用户" : "没有匹配的正常用户"} /></SelectTrigger>
      <SelectContent className="once-admin-portal">{options.map(user => <SelectItem key={user.id} value={user.id}>{user.email}</SelectItem>)}</SelectContent>
    </Select>{users.isError && <small className="oa-error">{adminError(users.error)}</small>}</label></>;
}
/** Picks a sellable number, searchable by digits or region. */
function NumberPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const numbers = useQuery(listOptions("numbers", { status: "AVAILABLE", search: term, pageSize: 50 }));
  const options = numbers.data?.items ?? [];
  const searchNumbers = () => { onChange(""); setTerm(search.trim()); };
  return <><label>查找号码<div className="oa-inline-search">
    <Input value={search} disabled={disabled} placeholder="号码片段或州名，例如 212、纽约" onChange={event => setSearch(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); searchNumbers(); } }} />
    <Button type="button" variant="outline" disabled={disabled} onClick={searchNumbers}>查找</Button></div></label>
    <label>选择号码<Select value={value} onValueChange={onChange} disabled={disabled || numbers.isFetching}>
      <SelectTrigger className="oa-select"><SelectValue placeholder={numbers.isPending ? "正在加载号码…" : options.length ? "请选择可售号码" : "没有匹配的可售号码"} /></SelectTrigger>
      <SelectContent className="once-admin-portal">{options.map(number => <SelectItem key={number.id} value={number.id}>{number.number} · {number.regionName}</SelectItem>)}</SelectContent>
    </Select><small>{numbers.data ? `共 ${numbers.data.totalItems} 个可售号码，最多显示 50 个，可搜索缩小范围。` : ""}</small>
    {numbers.isError && <small className="oa-error">{adminError(numbers.error)}</small>}</label></>;
}
/** Manual assignment is free compensation, recorded separately from paid consumption. */
function PlanAndAmount({ term, onTerm, note, onNote, disabled }: {
  term: string; onTerm: (value: string) => void; note: string; onNote: (value: string) => void; disabled: boolean;
}) {
  const plans = useQuery(plansOptions());
  useEffect(() => {
    const first = plans.data?.find(plan => plan.active) ?? plans.data?.[0];
    if (!term && first) onTerm(String(first.days));
  }, [plans.data, term, onTerm]);
  return <><label>补偿套餐<Select value={term} onValueChange={onTerm} disabled={disabled || plans.isPending}>
      <SelectTrigger className="oa-select"><SelectValue placeholder={plans.isPending ? "正在加载套餐…" : "请选择套餐"} /></SelectTrigger>
      <SelectContent className="once-admin-portal">{(plans.data ?? []).map(plan => <SelectItem key={plan.id} value={String(plan.days)}>
        {plan.days} 天 · {plan.label}{plan.active ? "" : "（未上架）"}</SelectItem>)}</SelectContent>
    </Select>{plans.isError && <small className="oa-error">{adminError(plans.error)}</small>}</label>
    <label>补偿说明<Input value={note} maxLength={200} disabled={disabled} onChange={event => onNote(event.target.value)} /></label></>;
}

/** All admin writes go through this dialog: one reason, one idempotency key, then a full admin refresh. */
export function ActionDialog({ target, onClose }: { target: ActionTarget; onClose: () => void }) {
  const client = useQueryClient();
  const { notify } = useApp();
  const key = useOperationKey();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [userId, setUserId] = useState("");
  const [numberId, setNumberId] = useState("");
  const [term, setTerm] = useState("");
  const [days, setDays] = useState("30");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<BatchResult | null>(null);
  const name = title(target);
  const mutation = useMutation({
    mutationFn: (): Promise<unknown> => {
      const paid = { amountMinor: 0, note: note.trim() };
      switch (target.kind) {
        case "user-status": return adminApi.userStatus(target.user.id, { status: target.user.status === "ACTIVE" ? "DISABLED" : "ACTIVE", reason }, key);
        case "password": return adminApi.resetPassword(target.user.id, { newPassword: password, reason }, key);
        case "assign": return adminApi.assignNumber(target.number.id, { userId, term: Number(term), ...paid, reason }, key);
        case "assign-user": return adminApi.assignNumber(numberId, { userId: target.user.id, term: Number(term), ...paid, reason }, key);
        case "hold": return adminApi.holdNumber(target.number.id, { hold: target.number.saleStatus !== "HELD", reason }, key);
        case "batch": return adminApi.batchNumbers({ ids: target.numbers.map(number => number.id), action: target.action, reason }, key);
        case "delete-number": return adminApi.deleteNumber(target.number.id, { reason }, key);
        case "end": return adminApi.endLease(target.lease.id, { reason }, key);
        case "extend": return adminApi.extendLease(target.lease.id, { days: Number(days), ...paid, reason }, key);
        case "retry": return adminApi.retryWebhook(target.event.id, { reason }, key);
      }
    },
    onSuccess: async value => {
      await client.invalidateQueries({ queryKey: adminKeys.all });
      if (target.kind === "batch") {
        const batch = value as BatchResult;
        notify(`${name}：已处理 ${batch.changed} 个号码${batch.skipped.length ? `，${batch.skipped.length} 个未处理` : ""}。`, batch.changed ? "success" : "error");
        // Keep the dialog open to explain any numbers that could not change.
        if (batch.skipped.length) return setResult(batch);
      } else if (target.kind === 'retry') {
        const event = value as AdminWebhook;
        notify(["IMPORTED", "IGNORED", "CONNECTION_IMPORTED"].includes(event.status) ? '事件处理结果已保存。' : event.status === 'UNMATCHED' ? '已重新检查，仍未匹配。请核对号码归属与历史期间。' : '重新处理请求已完成，请查看事件状态与原因。', ["IMPORTED", "IGNORED", "CONNECTION_IMPORTED"].includes(event.status) ? 'success' : 'error');
      } else notify(`${name}已完成，操作已记入日志。`, "success");
      onClose();
    },
    onError: cause => setError(adminError(cause)),
  });
  const busy = mutation.isPending;
  function submit() {
    setError("");
    if (target.kind === "password") {
      if (!passwordSchema.safeParse(password).success) return setError("新密码须为 8–72 个字符，且 UTF-8 编码不超过 72 字节。");
      if (password !== confirmation) return setError("两次输入的新密码不一致。");
    }
    if ((target.kind === "assign" || target.kind === "assign-user") && !term) return setError("请选择套餐。");
    if (target.kind === "extend" && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365)) return setError("延长天数需要是 1–365 的整数。");
    if (reason.trim().length < 3) return setError("请填写至少 3 个字的操作原因。");
    mutation.mutate();
  }
  const danger = (target.kind === "user-status" && target.user.status === "ACTIVE") || target.kind === "end" || target.kind === "delete-number";
  const ready = !(target.kind === "assign" && !userId) && !(target.kind === "assign-user" && !numberId);
  if (result) return <ConfirmDialog title={`${name} · 结果`} busy={false} onClose={onClose} footer={<Button onClick={onClose}>知道了</Button>}>
    <p className="oa-confirm-target">已处理 {result.changed} 个，{result.skipped.length} 个未处理</p>
    <ul className="oa-skip-list">{result.skipped.map(item => <li key={item.id}><strong className="oa-mono">{item.number || item.id.slice(0, 8)}</strong>{item.message}</li>)}</ul>
  </ConfirmDialog>;
  return <ConfirmDialog title={name} busy={busy} onClose={onClose} footer={<>
    <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
    <Button type="submit" form="oa-action-form" variant={danger ? "destructive" : "default"} disabled={busy || !ready}>
      {busy ? <RefreshCw className="oa-spin" /> : <Check />}确认{name}</Button></>}>
    <form id="oa-action-form" onSubmit={event => { event.preventDefault(); submit(); }}><fieldset disabled={busy}>
      <p className="oa-confirm-target">{subject(target)}</p>
      {target.kind === "user-status" && target.user.status === "ACTIVE" && <p className="oa-warning">禁用后该用户的登录会话立即失效；号码、租约和订单记录保留。</p>}
      {target.kind === "password" && <><p className="oa-warning">重置后，该用户在所有设备上的登录都会失效。请通过安全渠道把新密码告诉用户。</p>
        <label>新密码（至少 8 位）<Input type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} aria-describedby="admin-password-hint" onChange={event => setPassword(event.target.value)} /></label>
        <p id="admin-password-hint" className="oa-context">密码长度为 8–72 个字符，且 UTF-8 编码不超过 72 字节。</p>
        <label>确认新密码<Input type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></>}
      {target.kind === "assign" && <UserPicker value={userId} onChange={setUserId} disabled={busy} />}
      {target.kind === "assign-user" && <NumberPicker value={numberId} onChange={setNumberId} disabled={busy} />}
      {(target.kind === "assign" || target.kind === "assign-user") && <>
        <PlanAndAmount term={term} onTerm={setTerm} note={note} onNote={setNote} disabled={busy} />
        <p className="oa-context">仅用于免费补偿，生成独立的补偿订单；收费开通请让用户使用积分购买。</p></>}
      {target.kind === "extend" && <>
        <label>延长天数<div className="oa-inline-search">
          <Input type="number" min={1} max={365} value={days} disabled={busy} onChange={event => setDays(event.target.value)} />
          {[7, 30].map(value => <Button key={value} type="button" variant="outline" disabled={busy} onClick={() => setDays(String(value))}>{value} 天</Button>)}</div>
          <small>当前到期：{daysLeft(target.lease.expiresAt)}</small></label>
        <p className="oa-context">免费延期补偿；收费续租请让用户使用积分。</p>
        <label>补偿说明<Input value={note} maxLength={200} disabled={busy} onChange={event => setNote(event.target.value)} /></label></>}
      {target.kind === "hold" && target.number.saleStatus !== "HELD" && <p className="oa-context">暂停后用户在选号页看不到这个号码；不影响已有租约。</p>}
      {target.kind === "hold" && target.number.saleStatus === "HELD" && <p className="oa-warning">恢复后号码会重新出现在可售库存中。</p>}
      {target.kind === "batch" && target.action === "release" && <p className="oa-warning">释放后号码重新出现在可售库存中。到期保留的号码，上一位用户将不能再续费这个号码；正在使用中的号码会自动跳过。</p>}
      {target.kind === "batch" && target.action === "hold" && <p className="oa-context">暂停后用户在选号页看不到这些号码；正在使用或到期保留中的号码会自动跳过。</p>}
      {target.kind === "batch" && <p className="oa-context oa-batch-preview">{target.numbers.slice(0, 8).map(number => number.number).join("、")}{target.numbers.length > 8 ? ` 等 ${target.numbers.length} 个` : ""}</p>}
      {target.kind === "delete-number" && <p className="oa-warning">号码会从库存中永久删除。只有从未被租用过的号码才能删除。</p>}
      {target.kind === "end" && <p className="oa-warning">立即结束这条租约，用户将不能再用这个号码收发短信。历史短信和订单保留；号码回收后保持「已暂停」，不会自动重新上架。</p>}
      {target.kind === "retry" && <p className="oa-context">只重新匹配这条已保存的事件，不会向 PingCode 发起新请求。</p>}
      <ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={suggestions[target.kind]} />
      {error && <p role="alert" className="oa-error">{error}</p>}
    </fieldset></form>
  </ConfirmDialog>;
}
