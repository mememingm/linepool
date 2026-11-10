import { passwordSchema } from "@linepool/contracts";
import { ApiError } from "../lib/api";
import type { RequestOptions } from "../lib/models";
import type {
  AdminAudit, AdminLease, AdminMessage, AdminNumber, AdminOrder, AdminPlan, AdminUser, AdminWebhook, NumberInput, Page, RegionStock,
} from "./types";

// Development-only fixtures that follow docs/ONCE-ADMIN-API.md. Nothing here reaches the real API.
const day = 86400000;
const now = Date.now();
const iso = (offsetDays: number) => new Date(now + offsetDays * day).toISOString();
const id = (prefix: string, index: number) =>
  `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${String(index).padStart(12, "0")}`;
const places = [
  ["US", "美国", "ca", "加利福尼亚州", "415"], ["US", "美国", "ny", "纽约州", "212"],
  ["CA", "加拿大", "on", "安大略省", "647"], ["US", "美国", "tx", "得克萨斯州", "512"],
  ["CA", "加拿大", "bc", "不列颠哥伦比亚省", "604"],
] as const;
const senders = ["Google", "Telegram", "WhatsApp", "Apple", "Microsoft", "+14155550123", "Amazon"];
const admin = { id: id("a0000000", 1), email: "admin@once.local", role: "ADMIN" as const };
const countryNames: Record<string, string> = { US: "美国", CA: "加拿大" };
type StoredNumber = Omit<AdminNumber, "heldSince" | "heldBy" | "autoReleaseAt" | "deletable"> & { occupied: boolean };

function build() {
  const plans: AdminPlan[] = [
    { id: id("p0000000", 7), days: 7, priceMinor: 1200, currency: "USD", label: "短期使用", note: "适合临时项目或验证", active: true, sortOrder: 10, orderCount: 0, updatedAt: iso(-30) },
    { id: id("p0000000", 30), days: 30, priceMinor: 3500, currency: "USD", label: "整月独享", note: "每天约 $1.17，更省心", active: true, sortOrder: 20, orderCount: 0, updatedAt: iso(-30) },
    { id: id("p0000000", 90), days: 90, priceMinor: 9000, currency: "USD", label: "季度套餐", note: "内部测试中", active: false, sortOrder: 30, orderCount: 0, updatedAt: iso(-3) },
  ];
  const users: AdminUser[] = [
    { ...admin, status: "ACTIVE", createdAt: iso(-60), lastLoginAt: iso(0), activeLeaseCount: 0, leaseCount: 0, orderCount: 0 },
    ...Array.from({ length: 36 }, (_, i): AdminUser => ({
      id: id("u0000000", i + 1), email: `user${String(i + 1).padStart(2, "0")}@example.com`, role: "USER",
      status: i % 13 === 7 ? "DISABLED" : "ACTIVE", createdAt: iso(-50 + i), lastLoginAt: i % 5 ? iso(-(i % 9)) : null,
      activeLeaseCount: 0, leaseCount: 0, orderCount: 0,
    })),
  ];
  const numbers: StoredNumber[] = Array.from({ length: 64 }, (_, i) => {
    const [countryCode, countryName, regionId, regionName, area] = places[i % places.length]!;
    return {
      id: id("n0000000", i + 1), number: `+1 ${area} 555 ${String(1000 + i).padStart(4, "0")}`, countryCode, countryName, regionId, regionName,
      provider: "demo", providerNumberId: null, providerStatus: null, resourceExpiresAt: null, lastSyncedAt: null, smsEnabled: true,
      source: i >= 56 ? "ADMIN" : "SEED", note: i >= 56 ? "2026-10 采购批次" : null, saleStatus: "AVAILABLE", holdReason: null, currentLease: null, occupied: false, createdAt: iso(-70),
    };
  });
  numbers[60]!.saleStatus = "HELD"; numbers[60]!.holdReason = "号码异常暂停";
  const leases: AdminLease[] = [];
  const orders: AdminOrder[] = [];
  for (let i = 0; i < 44; i++) {
    const user = users[1 + (i % 34)]!, number = numbers[i]!;
    const term = i % 3 ? 30 : 7, price = term === 7 ? 1200 : 3500;
    const expiresIn = i < 30 ? 2 + (i % 26) : i < 36 ? (i % 3) + 0.5 : -(i % 9) - 1;
    const status: AdminLease["status"] = i >= 40 ? "ENDED" : expiresIn < 0 ? "EXPIRED_HELD" : "ACTIVE";
    const lease: AdminLease = {
      id: id("l0000000", i + 1), userId: user.id, email: user.email, phoneNumberId: number.id, number: number.number,
      countryName: number.countryName, regionName: number.regionName, provider: number.provider, term, priceMinor: price, currency: "USD",
      status, startedAt: iso(expiresIn - term), expiresAt: iso(expiresIn), endedAt: status === "ACTIVE" ? null : iso(expiresIn),
      messageCount: (i * 7) % 23, outboundCount: (i * 3) % 6,
    };
    leases.push(lease);
    if (status !== "ENDED") {
      number.occupied = true;
      number.saleStatus = status === "ACTIVE" ? "OCCUPIED" : "EXPIRED_HELD";
      number.holdReason = status === "ACTIVE" ? null : "EXPIRY_RELEASE_RULES_UNCONFIRMED";
      if (status === "ACTIVE") number.currentLease = { id: lease.id, userId: user.id, email: user.email, expiresAt: lease.expiresAt };
    }
    const kinds: AdminOrder["kind"][] = i % 6 === 5 ? ["RENT", "RENEW"] : ["RENT"];
    kinds.forEach((kind, k) => orders.push({
      id: id("o0000000", orders.length + 1), userId: user.id, email: user.email, leaseId: lease.id, number: number.number, kind,
      termDays: term, amountMinor: price, currency: "USD",
      status: i === 3 && k === 0 ? "UNCERTAIN" : i === 9 ? "FAILED" : "COMPLETED", attempts: 1,
      lastError: i === 9 ? "PROVIDER_REJECTED" : null, providerOrderId: null,
      createdAt: iso(expiresIn - term + k * 5), completedAt: i === 9 ? null : iso(expiresIn - term + k * 5), note: null,
    }));
  }
  // A few orders created today so the dashboard has something to show.
  orders.slice(0, 4).forEach((order, i) => { order.createdAt = new Date(now - (i + 1) * 3600000).toISOString(); });
  const messages: AdminMessage[] = [];
  leases.slice(0, 30).forEach((lease, i) => {
    for (let m = 0; m < 3; m++) {
      const outbound = m === 2 && i % 2 === 0;
      messages.push({
        id: id("m0000000", messages.length + 1), direction: outbound ? "OUTBOUND" : "INBOUND", leaseId: lease.id, userId: lease.userId,
        email: lease.email, number: lease.number, peer: outbound ? "+1 202 555 0188" : senders[(i + m) % senders.length]!,
        body: outbound ? "好的，收到，谢谢。" : `您的验证码是 ${String(100000 + i * 37 + m * 911).slice(0, 6)}，5 分钟内有效。`,
        code: outbound ? null : String(100000 + i * 37 + m * 911).slice(0, 6),
        status: outbound ? (i % 8 === 0 ? "FAILED" : i % 8 === 2 ? "UNCERTAIN" : "DELIVERED") : null,
        readAt: !outbound && m === 0 ? iso(-0.1) : null, provider: lease.provider, providerMessageId: null,
        lastError: outbound && i % 8 === 0 ? "UNDELIVERABLE_DESTINATION" : null, at: iso(-(i % 10) - m / 10),
      });
    }
  });
  const webhooks: AdminWebhook[] = Array.from({ length: 6 }, (_, i) => {
    const status: AdminWebhook["status"] = i % 3 === 1 ? "FAILED" : i === 4 ? "QUARANTINED" : "PROCESSED";
    return {
      id: id("w0000000", i + 1), provider: "pingcode", providerAccountId: 'demo-account', eventType: 'sms.received', retryable: status !== 'PROCESSED', retryExhausted: false, eventId: `evt_${(9000 + i).toString(36)}`, status, attempts: status === "FAILED" ? 3 : 1,
      lastError: status === "FAILED" ? "INBOUND_PROCESSING_FAILED" : status === "QUARANTINED" ? "NO_LEASE_AT_RECEIVE_TIME" : null,
      conflictCount: 0, leaseId: status === "PROCESSED" ? leases[i]!.id : null, outboundMessageId: null,
      providerNumberId: String(880000 + i * 4), providerMessageId: `pc-msg-${i}`, occurredAt: iso(-i / 3), receivedAt: iso(-i / 3),
      processedAt: status === "PROCESSED" ? iso(-i / 3) : null, nextAttemptAt: status === "FAILED" ? iso(0.01) : null,
      payload: { event: "sms.received", eventId: `evt_${(9000 + i).toString(36)}`, data: { numberId: 880000 + i * 4, from: "Google", content: "G-123456 是你的 Google 验证码。" } },
    };
  });
  const audit: AdminAudit[] = [
    { id: id("e0000000", 1), actorEmail: admin.email, action: "USER_STATUS", targetType: "user", targetId: users[8]!.id, reason: "违规使用", createdAt: iso(-2) },
    { id: id("e0000000", 2), actorEmail: admin.email, action: "NUMBER_HOLD", targetType: "number", targetId: numbers[60]!.id, reason: "号码异常暂停", createdAt: iso(-1.5) },
    { id: id("e0000000", 3), actorEmail: admin.email, action: "LEASE_EXTEND", targetType: "lease", targetId: leases[2]!.id, reason: "补偿服务中断", createdAt: iso(-1) },
    { id: id("e0000000", 4), actorEmail: admin.email, action: "PLAN_CREATE", targetType: "plan", targetId: plans[0]!.id, reason: "历史新建短期套餐", createdAt: iso(-30) },
    { id: id("e0000000", 5), actorEmail: admin.email, action: "PLAN_UPDATE", targetType: "plan", targetId: plans[1]!.id, reason: "历史调整套餐说明", createdAt: iso(-10) },
    { id: id("e0000000", 6), actorEmail: admin.email, action: "ONCE_PLAN_SAVE", targetType: "plan", targetId: plans[2]!.id, reason: "保存季度套餐配置", createdAt: iso(-3) },
  ];
  for (const user of users) {
    const own = leases.filter(l => l.userId === user.id);
    user.leaseCount = own.length;
    user.activeLeaseCount = own.filter(l => l.status === "ACTIVE").length;
    user.orderCount = orders.filter(o => o.userId === user.id).length;
  }
  return { plans, settings: { cooldownDays: null as number | null }, users, numbers, leases, orders, messages, webhooks, audit };
}
const db = build();

function fail(message: string, status: number, code = ""): never {
  throw new ApiError(message, status, code);
}
function page<T>(rows: T[], params: URLSearchParams): Page<T> {
  const pageSize = [10, 20, 50].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, Number(params.get("page")) || 1), totalPages);
  return { items: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pageSize, totalItems: rows.length, totalPages };
}
const matches = (search: string, ...values: (string | null | undefined)[]) =>
  !search || values.some(value => value?.toLowerCase().includes(search.toLowerCase()));
const byNewest = <T,>(rows: T[], date: (row: T) => string) => [...rows].sort((a, b) => date(b).localeCompare(date(a)));
const expiring = (lease: AdminLease) => lease.status === "ACTIVE" && Date.parse(lease.expiresAt) - Date.now() < 3 * day;

/** Adds the fields the backend derives from leases and settings. */
function view(number: StoredNumber): AdminNumber {
  const expired = db.leases.find(lease => lease.phoneNumberId === number.id && lease.status === "EXPIRED_HELD");
  const heldSince = expired ? expired.endedAt ?? expired.expiresAt : null;
  const { occupied: _occupied, ...fields } = number;
  return { ...fields, heldSince, heldBy: expired?.email ?? null,
    autoReleaseAt: heldSince && db.settings.cooldownDays !== null ? new Date(Date.parse(heldSince) + db.settings.cooldownDays * day).toISOString() : null,
    deletable: !number.occupied && !db.leases.some(lease => lease.phoneNumberId === number.id) };
}
function planView(plan: AdminPlan): AdminPlan {
  return { ...plan, orderCount: db.orders.filter(order => order.termDays === plan.days && (order.kind === "RENT" || order.kind === "ADMIN_ASSIGN")).length };
}
function stock(): RegionStock[] {
  const regions = new Map<string, RegionStock>();
  for (const number of db.numbers) {
    const key = `${number.countryCode}:${number.regionId}`;
    const region = regions.get(key) ?? { countryCode: number.countryCode, regionId: number.regionId, regionName: number.regionName, total: 0, available: 0, occupied: 0, held: 0 };
    region.total++;
    if (number.occupied) region.occupied++; else if (number.holdReason) region.held++; else region.available++;
    regions.set(key, region);
  }
  return [...regions.values()].sort((a, b) => a.available - b.available);
}

function list(section: string, params: URLSearchParams) {
  const search = params.get("search")?.trim() ?? "", status = params.get("status") ?? "", userId = params.get("userId") ?? "";
  switch (section) {
    case "users":
      return page(db.users.filter(u => matches(search, u.email, u.id) && (!status || u.status === status || u.role === status)), params);
    case "numbers":
      return page([...db.numbers].sort((a, b) => a.number.localeCompare(b.number)).map(view)
        .filter(n => matches(search, n.number, n.currentLease?.email, n.note, n.regionName) && (!status || n.saleStatus === status)), params);
    case "leases":
      return page(byNewest(db.leases.filter(l => matches(search, l.number, l.email, l.id) && (!userId || l.userId === userId) &&
        (!status || (status === "EXPIRING" ? expiring(l) : l.status === status))), l => l.startedAt), params);
    case "orders":
      return page(byNewest(db.orders.filter(o => matches(search, o.id, o.email, o.number) && (!userId || o.userId === userId) &&
        (!status || (status === "TODAY" ? Date.now() - Date.parse(o.createdAt) < day : status === "ATTENTION" ? ["UNCERTAIN", "FAILED", "PENDING", "PROCESSING"].includes(o.status) : o.status === status))), o => o.createdAt), params);
    case "messages":
      return page(byNewest(db.messages.filter(m => matches(search, m.number, m.peer, m.email, m.body) &&
        (!params.get("direction") || m.direction === params.get("direction")) && (!params.get("leaseId") || m.leaseId === params.get("leaseId")) &&
        (!status || m.status === status)), m => m.at), params);
    case "webhooks":
      return page(byNewest(db.webhooks.filter(w => matches(search, w.eventId, w.providerMessageId, w.providerNumberId) && (!status || w.status === status) && (!params.get('provider') || params.get('provider') === w.provider) && (!params.get('eventType') || params.get('eventType') === w.eventType) && (!params.get('from') || w.receivedAt >= params.get('from')!) && (!params.get('to') || w.receivedAt <= params.get('to')!)), w => w.receivedAt), params);
    case "audit":
      return page(byNewest(db.audit.filter(a => matches(search, a.actorEmail, a.targetId, a.reason) && (!status || a.action === status)), a => a.createdAt), params);
  }
  return fail("Not found", 404);
}
function find<T extends { id: string }>(rows: T[], key: string) {
  return rows.find(row => row.id === key) ?? fail("记录不存在或已变化。", 404, "NOT_FOUND");
}
function reasonOf(body: Record<string, unknown>) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500) fail("操作原因需要 3–500 个字符。", 400, "VALIDATION_ERROR");
  return reason;
}
function record(action: string, targetType: string, targetId: string, reason: string) {
  db.audit.push({ id: crypto.randomUUID(), actorEmail: admin.email, action, targetType, targetId, reason, createdAt: new Date().toISOString() });
}
function refreshUser(userId: string) {
  const user = db.users.find(u => u.id === userId);
  if (!user) return;
  user.leaseCount = db.leases.filter(l => l.userId === userId).length;
  user.activeLeaseCount = db.leases.filter(l => l.userId === userId && l.status === "ACTIVE").length;
  user.orderCount = db.orders.filter(o => o.userId === userId).length;
}
function amountOf(value: unknown) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || Number(value) < 0) fail("收款金额无效。", 400, "VALIDATION_ERROR");
  return Number(value);
}
function numberInput(body: Record<string, unknown>) {
  let digits = typeof body.number === "string" ? body.number.replace(/\D/g, "") : "";
  if (digits.length === 10) digits = "1" + digits;
  if (!/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return "号码格式不正确，请填写 10 位北美号码，例如 +1 212 555 0100。";
  const countryCode = String(body.countryCode ?? "").toUpperCase();
  if (!countryNames[countryCode]) return "国家只支持 US 或 CA。";
  if (!body.regionId || !body.regionName) return "请选择有效的州 / 省。";
  return { number: `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`, countryCode, countryName: countryNames[countryCode]!,
    regionId: String(body.regionId), regionName: String(body.regionName), note: String(body.note ?? "").trim() || null };
}
function previewImport(body: Record<string, unknown>) {
  const rows = Array.isArray(body.rows) ? body.rows as NumberInput[] : [];
  if (!rows.length) fail("没有可导入的行。", 400, "VALIDATION_ERROR");
  const seen = new Set<string>(), valid: ReturnType<typeof numberInput>[] = [], errors: { line: number; message: string }[] = [];
  rows.forEach((row, index) => {
    const input = numberInput(row as unknown as Record<string, unknown>);
    if (typeof input === "string") errors.push({ line: index + 1, message: input });
    else if (db.numbers.some(n => n.number === input.number)) errors.push({ line: index + 1, message: `${input.number} 已在库存中。` });
    else if (seen.has(input.number)) errors.push({ line: index + 1, message: `${input.number} 在文件中重复。` });
    else { seen.add(input.number); valid.push(input); }
  });
  return { valid, errors };
}
function addNumber(input: Exclude<ReturnType<typeof numberInput>, string>) {
  const number: StoredNumber = { id: crypto.randomUUID(), ...input, provider: "demo", providerNumberId: null, providerStatus: null, resourceExpiresAt: null,
    lastSyncedAt: null, smsEnabled: true, source: "ADMIN", saleStatus: "AVAILABLE", holdReason: null, currentLease: null, occupied: false, createdAt: new Date().toISOString() };
  db.numbers.push(number);
  return number;
}
function release(number: StoredNumber) {
  if (number.currentLease) return false;
  const expired = db.leases.find(lease => lease.phoneNumberId === number.id && lease.status === "EXPIRED_HELD");
  if (expired) Object.assign(expired, { status: "ENDED" });
  Object.assign(number, { occupied: false, saleStatus: "AVAILABLE", holdReason: null });
  return true;
}
const applied = new Map<string, unknown>();

function mutate(path: string, body: Record<string, unknown>) {
  const [, section, key, action] = path.split("/");
  const reason = reasonOf(body);
  if (section === "plans") {
    const priceMinor = body.priceMinor, label = String(body.label ?? "").trim();
    if (!Number.isInteger(priceMinor) || Number(priceMinor) < 0) fail("价格无效。", 400, "VALIDATION_ERROR");
    if (!label) fail("套餐名称需要 1–20 个字符。", 400, "VALIDATION_ERROR");
    const fields = { priceMinor: Number(priceMinor), label, note: String(body.note ?? ""), active: body.active === true, sortOrder: Number(body.sortOrder ?? 0), updatedAt: new Date().toISOString() };
    if (!key) {
      if (db.plans.some(plan => plan.days === body.days)) fail("已有相同天数的套餐，请直接编辑它。", 409, "PLAN_EXISTS");
      const plan: AdminPlan = { id: crypto.randomUUID(), days: Number(body.days), currency: "USD", orderCount: 0, ...fields };
      db.plans.push(plan);
      record("ONCE_PLAN_SAVE", "plan", plan.id, reason);
      return planView(plan);
    }
    const plan = find(db.plans, key);
    if (plan.active && !fields.active && !db.plans.some(item => item.active && item.id !== plan.id)) fail("至少要保留一个上架的套餐，否则用户将无法购买。", 409, "LAST_ACTIVE_PLAN");
    Object.assign(plan, fields);
    record("ONCE_PLAN_SAVE", "plan", plan.id, reason);
    return planView(plan);
  }
  if (section === "settings") {
    const value = body.cooldownDays;
    if (value !== null && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 365)) fail("保留天数需要是 0–365 的整数。", 400, "VALIDATION_ERROR");
    db.settings.cooldownDays = value === null ? null : Number(value);
    record("SETTINGS_UPDATE", "settings", "number.cooldownDays", reason);
    return { ...db.settings };
  }
  if (section === "numbers" && !key) {
    const input = numberInput(body);
    if (typeof input === "string") fail(input, 400, "VALIDATION_ERROR");
    if (db.numbers.some(n => n.number === input.number)) fail(`号码 ${input.number} 已在库存中。`, 409, "NUMBER_EXISTS");
    const number = addNumber(input);
    record("NUMBER_CREATE", "number", number.id, reason);
    return view(number);
  }
  if (section === "numbers" && key === "import") {
    const preview = previewImport(body);
    if (preview.errors.length) fail(`有 ${preview.errors.length} 行需要修正，请重新预览。`, 400, "IMPORT_INVALID");
    for (const input of preview.valid) record("NUMBER_CREATE", "number", addNumber(input as Exclude<typeof input, string>).id, reason);
    return { created: preview.valid.length };
  }
  if (section === "numbers" && key === "batch") {
    const ids = Array.isArray(body.ids) ? body.ids as string[] : [];
    const changed: string[] = [], skipped: { id: string; number: string; message: string }[] = [];
    for (const numberId of ids) {
      const number = db.numbers.find(n => n.id === numberId);
      if (!number) { skipped.push({ id: numberId, number: "", message: "号码不存在。" }); continue; }
      if (body.action === "release") {
        if (!number.occupied && !number.holdReason) skipped.push({ id: numberId, number: number.number, message: "已经是可售状态。" });
        else if (release(number)) changed.push(numberId);
        else skipped.push({ id: numberId, number: number.number, message: "号码正在使用中或有未完成订单。" });
      } else if (number.occupied || number.holdReason) skipped.push({ id: numberId, number: number.number, message: number.occupied ? "号码正在使用或到期保留中。" : "已经是暂停状态。" });
      else { Object.assign(number, { saleStatus: "HELD", holdReason: reason }); changed.push(numberId); }
    }
    for (const numberId of changed) record(body.action === "release" ? "NUMBER_RELEASE" : "NUMBER_HOLD", "number", numberId, reason);
    return { changed: changed.length, skipped };
  }
  if (section === "numbers" && !action) {
    const number = find(db.numbers, key!);
    const input = numberInput({ ...body, number: number.number });
    if (typeof input === "string") fail(input, 400, "VALIDATION_ERROR");
    Object.assign(number, { countryCode: input.countryCode, countryName: input.countryName, regionId: input.regionId, regionName: input.regionName, note: input.note });
    record("NUMBER_UPDATE", "number", number.id, reason);
    return view(number);
  }
  if (section === "numbers" && action === "delete") {
    const number = find(db.numbers, key!);
    if (!view(number).deletable) fail("这个号码已有租用或订单记录，不能删除。", 409, "NUMBER_IN_USE");
    db.numbers.splice(db.numbers.indexOf(number), 1);
    record("NUMBER_DELETE", "number", number.id, reason);
    return { id: number.id, number: number.number };
  }
  if (section === "users" && action === "status") {
    const user = find(db.users, key!);
    if (user.role === "ADMIN") fail("Admin protected", 409, "ADMIN_PROTECTED");
    user.status = body.status === "DISABLED" ? "DISABLED" : "ACTIVE";
    record("USER_STATUS", "user", user.id, reason);
    return user;
  }
  if (section === "users" && action === "password") {
    const user = find(db.users, key!);
    if (user.role === "ADMIN") fail("Admin protected", 409, "ADMIN_PROTECTED");
    if (!passwordSchema.safeParse(body.newPassword).success) fail("密码须为 8–72 个字符，且 UTF-8 编码不超过 72 字节。", 400, "VALIDATION_ERROR");
    record("USER_PASSWORD_RESET", "user", user.id, reason);
    return { ok: true };
  }
  if (section === "numbers" && action === "assign") {
    const number = find(db.numbers, key!);
    const user = db.users.find(u => u.id === body.userId && u.status === "ACTIVE" && u.role === "USER") ?? fail("User unavailable", 409, "USER_UNAVAILABLE");
    if (number.saleStatus !== "AVAILABLE") fail("Number unavailable", 409, "NUMBER_UNAVAILABLE");
    const plan = db.plans.find(item => item.days === body.term) ?? fail("该租期已下架或不存在，请重新选择。", 400, "PLAN_UNAVAILABLE");
    const amountMinor = amountOf(body.amountMinor), note = String(body.note ?? "").trim() || null;
    const lease: AdminLease = {
      id: crypto.randomUUID(), userId: user.id, email: user.email, phoneNumberId: number.id, number: number.number, countryName: number.countryName,
      regionName: number.regionName, provider: number.provider, term: plan.days, priceMinor: amountMinor, currency: "USD", status: "ACTIVE",
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + plan.days * day).toISOString(), endedAt: null, messageCount: 0, outboundCount: 0,
    };
    db.leases.push(lease);
    db.orders.push({ id: crypto.randomUUID(), userId: user.id, email: user.email, leaseId: lease.id, number: number.number, kind: "ADMIN_ASSIGN",
      termDays: plan.days, amountMinor, currency: "USD", status: "COMPLETED", attempts: 1, lastError: null, providerOrderId: null,
      createdAt: lease.startedAt, completedAt: lease.startedAt, note });
    Object.assign(number, { occupied: true, saleStatus: "OCCUPIED", holdReason: null, currentLease: { id: lease.id, userId: user.id, email: user.email, expiresAt: lease.expiresAt } });
    refreshUser(user.id);
    record("NUMBER_ASSIGN", "number", number.id, reason);
    return lease;
  }
  if (section === "numbers" && action === "hold") {
    const number = find(db.numbers, key!);
    if (number.occupied) fail("Number unavailable", 409, "NUMBER_UNAVAILABLE");
    Object.assign(number, body.hold ? { saleStatus: "HELD", holdReason: reason } : { saleStatus: "AVAILABLE", holdReason: null });
    record("NUMBER_HOLD", "number", number.id, reason);
    return view(number);
  }
  if (section === "leases" && (action === "end" || action === "extend")) {
    const lease = find(db.leases, key!);
    if (lease.status !== "ACTIVE") fail("Lease not active", 409, "LEASE_NOT_ACTIVE");
    const number = db.numbers.find(n => n.id === lease.phoneNumberId);
    if (action === "end") {
      Object.assign(lease, { status: "ENDED", endedAt: new Date().toISOString() });
      // Reclaimed numbers stay held until an operator explicitly releases them.
      if (number) Object.assign(number, { occupied: false, saleStatus: "HELD", holdReason: "管理员回收，待人工复核", currentLease: null });
      record("LEASE_END", "lease", lease.id, reason);
    } else {
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) fail("延期天数需要是 1–365 的整数。", 400, "VALIDATION_ERROR");
      lease.expiresAt = new Date(Date.parse(lease.expiresAt) + days * day).toISOString();
      if (number?.currentLease) number.currentLease.expiresAt = lease.expiresAt;
      db.orders.push({ id: crypto.randomUUID(), userId: lease.userId, email: lease.email, leaseId: lease.id, number: lease.number, kind: "ADMIN_EXTEND",
        termDays: days, amountMinor: amountOf(body.amountMinor), currency: "USD", status: "COMPLETED", attempts: 1, lastError: null, providerOrderId: null,
        createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), note: String(body.note ?? "").trim() || null });
      record("LEASE_EXTEND", "lease", lease.id, reason);
    }
    refreshUser(lease.userId);
    return lease;
  }
  if (section === "webhooks" && action === "retry") {
    const event = find(db.webhooks, key!);
    if (event.status === "PROCESSED") fail("Not retryable", 409, "WEBHOOK_NOT_RETRYABLE");
    Object.assign(event, { attempts: event.attempts + 1, status: event.status === "QUARANTINED" ? "QUARANTINED" : "PROCESSED",
      processedAt: event.status === "QUARANTINED" ? null : new Date().toISOString(), lastError: event.status === "QUARANTINED" ? event.lastError : null, nextAttemptAt: null });
    record("WEBHOOK_RETRY", "webhook", event.id, reason);
    return event;
  }
  return fail("Not found", 404);
}

export async function mockAdminRequest(path: string, options: RequestOptions = {}) {
  await new Promise(resolve => setTimeout(resolve, 180 + Math.random() * 220));
  options.signal?.throwIfAborted();
  const [route, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  if (route === '/integrations/pingcode') {
    if (options.method === 'POST') return fail('演示后台不保存真实上游凭据，请使用真实后端。', 409);
    return { provider: 'pingcode', name: 'PingCode', configured: false, demoMode: true, baseUrl: '', accountId: '', apiKeyConfigured: false,
      receiveSecretConfigured: false, sendSecretConfigured: false, mappedNumbers: 0, receiveUrl: location.origin + '/api/webhooks/pingcode/receive', sendUrl: location.origin + '/api/webhooks/pingcode/send',
      publicHttps: false, lastEvent: null, lastCheck: null, lastSync: null, requiredScopes: ['numbers:read', 'sms:read', 'sms:send'],
      capabilities: { numbers: true, receiveSms: true, sendSms: true, sendStatus: 'polling', purchase: false, renew: false }, deliveryNote: '这是前端演示。请连接真实后端以保存凭据、检测连接及同步号码。' };
  }
  if (route === '/webhooks/summary') return { counts: Object.fromEntries(['RECEIVED', 'PROCESSING', 'UNMATCHED', 'FAILED', 'QUARANTINED', 'PROCESSED'].map(status => [status, db.webhooks.filter(row => row.status === status).length])), retryExhausted: 0 };
  if (options.method === "POST") {
    if (route === "/numbers/import/preview") return structuredClone(previewImport((options.body ?? {}) as Record<string, unknown>));
    const key = options.headers?.["Idempotency-Key"] ?? "";
    if (applied.has(key)) return structuredClone(applied.get(key));
    const result = mutate(route!, (options.body ?? {}) as Record<string, unknown>);
    applied.set(key, result);
    return structuredClone(result);
  }
  if (route === "/session") return { ...admin };
  if (route === "/plans") return structuredClone([...db.plans].sort((a, b) => a.sortOrder - b.sortOrder).map(planView));
  if (route === "/settings") return { ...db.settings };
  if (route === "/numbers/stats") return structuredClone(stock());
  if (route === "/summary") {
    const today = db.orders.filter(o => Date.now() - Date.parse(o.createdAt) < day);
    const lowStock = stock().filter(region => region.available <= 3).map(({ countryCode, regionId, regionName, available }) => ({ countryCode, regionId, regionName, available }));
    return structuredClone({
      users: db.users.length, activeLeases: db.leases.filter(l => l.status === "ACTIVE").length,
      availableNumbers: db.numbers.filter(n => !n.occupied && !n.holdReason).length, heldNumbers: db.numbers.filter(n => !n.occupied && n.holdReason).length,
      expiredHeldNumbers: db.leases.filter(l => l.status === "EXPIRED_HELD").length, lowStock, lowStockThreshold: 3,
      todayOrders: today.length, todayRevenueMinor: today.reduce((sum, o) => sum + (o.amountMinor ?? 0), 0), currency: "USD",
      expiringLeases: db.leases.filter(expiring).length, failedOutbound: db.messages.filter(m => m.status === "FAILED" || m.status === "UNCERTAIN").length,
      failedWebhooks: db.webhooks.filter(w => w.status === "FAILED" || w.status === "QUARANTINED").length,
      uncertainOrders: db.orders.filter(o => ["UNCERTAIN", "FAILED", "PENDING", "PROCESSING"].includes(o.status)).length,
      recentOrders: byNewest(db.orders, o => o.createdAt).slice(0, 6),
      expiring: db.leases.filter(expiring).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).slice(0, 6),
      integrations: { demoMode: true, pingcodeConfigured: false, receiveWebhookConfigured: false, paymentsConnected: false },
    });
  }
  const [, section, key] = route!.split("/");
  if (!key) return structuredClone(list(section!, params));
  if (section === "users") {
    const user = find(db.users, key);
    return structuredClone({ user, leases: byNewest(db.leases.filter(l => l.userId === key), l => l.startedAt), orders: byNewest(db.orders.filter(o => o.userId === key), o => o.createdAt).slice(0, 50) });
  }
  if (section === "numbers")
    return structuredClone({ number: view(find(db.numbers, key)), leases: byNewest(db.leases.filter(l => l.phoneNumberId === key), l => l.startedAt) });
  if (section === "leases")
    return structuredClone({ lease: find(db.leases, key), orders: db.orders.filter(o => o.leaseId === key), messages: byNewest(db.messages.filter(m => m.leaseId === key), m => m.at).slice(0, 20) });
  if (section === 'webhooks') return structuredClone({ ...find(db.webhooks, key), history: [] });
  if (section === "orders") return structuredClone(find(db.orders, key));
  return fail("Not found", 404);
}
