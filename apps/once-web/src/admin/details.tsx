import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { detailOptions } from "./api";
import { adminHref } from "./navigation";
import { Badge, DateText, Drawer, Facts, State, daysLeft, money } from "./primitives";
import { LeaseTable, MessageTable, OrderTable, leaseStatus, orderAmount } from "./tables";
import type { ActionTarget } from "./actions";
import type { FormTarget } from "./context";

export type DetailTarget = { section: "users" | "numbers" | "leases" | "orders"; id: string };
type Props = { id: string; openAction: (target: ActionTarget) => void; openDetail: (target: DetailTarget) => void; openForm: (target: FormTarget) => void };

function UserDetail({ id, openAction, openDetail }: Props) {
  const result = useQuery(detailOptions("users", id));
  if (!result.data) return <State query={result} columns={2} />;
  const { user, leases, orders } = result.data;
  return <>
    <div className="oa-detail-hero"><strong>{user.email}</strong><div><Badge value={user.status} /><Badge value={user.role} /></div></div>
    <Facts rows={[["注册时间", <DateText value={user.createdAt} />], ["最近登录", <DateText value={user.lastLoginAt} />],
      ["使用中的号码", `${user.activeLeaseCount} 个`], ["历史租约", `${user.leaseCount} 条`], ["订单", `${user.orderCount} 笔`], ["用户 ID", <span className="oa-mono oa-break">{user.id}</span>]]} />
    {user.role === "USER" && <div className="oa-detail-actions">
      {user.status === "ACTIVE" && user.authKind !== "PINCLODE" && <Button onClick={() => openAction({ kind: "assign-user", user })}>开通号码</Button>}
      {user.authKind !== "PINCLODE" && <Button variant="outline" onClick={() => openAction({ kind: "password", user })}>重置密码</Button>}
      <Button variant={user.status === "ACTIVE" ? "destructive" : "outline"} onClick={() => openAction({ kind: "user-status", user })}>{user.status === "ACTIVE" ? "禁用账号" : "启用账号"}</Button></div>}
    <h3>租约</h3>{leases.length ? <LeaseTable leases={leases} showUser={false} onDetail={leaseId => openDetail({ section: "leases", id: leaseId })} /> : <p className="oa-context">这个用户还没有租过号码。</p>}
    <h3>最近订单</h3>{orders.length ? <OrderTable orders={orders} /> : <p className="oa-context">还没有订单。</p>}
    <Link className="oa-link" to={adminHref("orders", { userId: id })}>查看全部订单 <ArrowUpRight size={14} /></Link>
  </>;
}
function NumberDetail({ id, openAction, openDetail, openForm }: Props) {
  const result = useQuery(detailOptions("numbers", id));
  if (!result.data) return <State query={result} columns={2} />;
  const { number, leases } = result.data;
  return <>
    <div className="oa-detail-hero"><strong className="oa-mono">{number.number}</strong><span>{number.countryName} · {number.regionName}</span><div><Badge value={number.saleStatus} label={number.saleStatus === "OCCUPIED" ? "使用中" : number.saleStatus === "EXPIRED_HELD" ? "到期保留" : undefined} /><Badge value={number.source} label={number.source === "ADMIN" ? "手动录入" : undefined} /></div></div>
    {number.saleStatus === "EXPIRED_HELD" && <p className="oa-warning">{number.heldBy ?? "上一位用户"} 的租约已于 <DateText value={number.heldSince} /> 到期，号码仍为其保留。{number.autoReleaseAt ? <>将在 <DateText value={number.autoReleaseAt} /> 自动重新上架。</> : "未设置自动上架，需要手动释放。"}</p>}
    <Facts rows={[["当前用户", number.currentLease?.email ?? "未占用"], ["当前租约到期", number.currentLease ? <><DateText value={number.currentLease.expiresAt} /> · {daysLeft(number.currentLease.expiresAt)}</> : "—"],
      ["暂停原因", number.saleStatus === "HELD" ? number.holdReason ?? "—" : "—"], ["短信能力", number.smsEnabled ? "可收发短信" : "已关闭"], ["备注", number.note ?? "—"], ["入库时间", <DateText value={number.createdAt} />]]} />
    {!number.historicalOnly && <div className="oa-detail-actions">
      {number.saleStatus === "AVAILABLE" && <Button onClick={() => openAction({ kind: "assign", number })}>分配给用户</Button>}
      {number.saleStatus === "EXPIRED_HELD" && <Button onClick={() => openAction({ kind: "batch", action: "release", numbers: [number] })}>释放（重新上架）</Button>}
      {(number.saleStatus === "AVAILABLE" || number.saleStatus === "HELD") && <Button variant="outline" onClick={() => openAction({ kind: "hold", number })}>{number.saleStatus === "HELD" ? "恢复售卖" : "暂停售卖"}</Button>}
      <Button variant="outline" onClick={() => openForm({ kind: "number", number })}>编辑地区和备注</Button>
      {number.deletable && <Button variant="destructive" onClick={() => openAction({ kind: "delete-number", number })}>删除</Button>}
    </div>}
    <h3>租用历史</h3>{leases.length ? <LeaseTable leases={leases} onDetail={leaseId => openDetail({ section: "leases", id: leaseId })} /> : <p className="oa-context">这个号码还没有被租用过。</p>}
    <details className="oa-tech"><summary>技术信息</summary><Facts rows={[["号码 ID", <span className="oa-mono oa-break">{number.id}</span>], ["上游号码 ID", number.providerNumberId ?? "—"],
      ["上游状态", number.providerStatus ?? "—"], ["上游资源到期", <DateText value={number.resourceExpiresAt} />], ["最近同步", <DateText value={number.lastSyncedAt} />], ["入库时间", <DateText value={number.createdAt} />]]} /></details>
  </>;
}
function LeaseDetail({ id, openAction }: Props) {
  const result = useQuery(detailOptions("leases", id));
  if (!result.data) return <State query={result} columns={2} />;
  const { lease, orders, messages } = result.data;
  return <>
    <div className="oa-detail-hero"><strong className="oa-mono">{lease.number}</strong><span>{lease.email}</span><div><Badge value={leaseStatus(lease)} label={leaseStatus(lease) === "ACTIVE" ? "使用中" : undefined} /></div></div>
    <Facts rows={[["租期", `${lease.term} 天 · ${lease.priceMinor === 0 ? "免费开通" : money(lease.priceMinor, lease.currency)}`], ["开始时间", <DateText value={lease.startedAt} />],
      ["到期时间", <><DateText value={lease.expiresAt} />{lease.status !== "ENDED" && ` · ${daysLeft(lease.expiresAt)}`}</>], ["结束时间", <DateText value={lease.endedAt} />],
      ["收到短信", `${lease.messageCount} 条`], ["发出短信", `${lease.outboundCount} 条`], ["租约 ID", <span className="oa-mono oa-break">{lease.id}</span>]]} />
    {!lease.historicalOnly && !["ENDED", "RELEASED"].includes(lease.status) && <div className="oa-detail-actions">
      {lease.status === "ACTIVE" && <Button variant="outline" onClick={() => openAction({ kind: "extend", lease })}>延期</Button>}
      <Button variant="destructive" onClick={() => openAction({ kind: "end", lease })}>回收号码</Button></div>}
    <h3>相关订单</h3>{orders.length ? <OrderTable orders={orders} /> : <p className="oa-context">没有相关订单。</p>}
    <h3>最近短信</h3>{messages.length ? <MessageTable messages={messages} showLease={false} /> : <p className="oa-context">还没有短信。</p>}
    <Link className="oa-link" to={adminHref("messages", { leaseId: id })}>查看全部短信 <ArrowUpRight size={14} /></Link>
  </>;
}
function OrderDetail({ id }: Props) {
  const result = useQuery(detailOptions("orders", id));
  if (!result.data) return <State query={result} columns={2} />;
  const order = result.data;
  return <>
    <div className="oa-detail-hero"><strong>{orderAmount(order)}</strong><span>{order.email} · {order.number ?? "—"}</span><div><Badge value={order.kind} /><Badge value={order.status} /></div></div>
    <Facts rows={[["订单号", <span className="oa-mono oa-break">{order.id}</span>], ["租期", `${order.termDays} 天`], ["下单时间", <DateText value={order.createdAt} />],
      ["完成时间", <DateText value={order.completedAt} />], ["收款备注", order.note ?? "—"], ["处理次数", order.attempts], ["上游订单号", order.providerOrderId ?? "—"], ["异常原因", order.lastError ?? "—"]]} />
    {order.leaseId && <Link className="oa-link" to={adminHref("leases", { search: order.leaseId })}>查看对应租约 <ArrowUpRight size={14} /></Link>}
  </>;
}
const titles = { users: "用户详情", numbers: "号码详情", leases: "租约详情", orders: "订单详情" };
export function DetailDrawer({ target, onClose, ...props }: { target: DetailTarget; onClose: () => void } & Omit<Props, "id">) {
  const Content = { users: UserDetail, numbers: NumberDetail, leases: LeaseDetail, orders: OrderDetail }[target.section];
  return <Drawer title={titles[target.section]} onClose={onClose}><Content key={target.id} id={target.id} {...props} /></Drawer>;
}
