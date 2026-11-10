import { Eye } from "lucide-react";
import { Badge, DateText, IconAction, RowMenu, ShortId, Table, daysLeft, money, rowClick, type RowMenuItem } from "./primitives";
import type { AdminLease, AdminMessage, AdminOrder } from "./types";
import { formatPoints } from "../lib/points";

export const orderAmount = (order: AdminOrder) => order.settlementType === "POINTS" ? formatPoints(order.pointsAmount ?? 0) : order.settlementType === "COMPENSATION" ? "免费补偿" : money(order.amountMinor, order.currency);

export function OrderTable({ orders, onDetail }: { orders: AdminOrder[]; onDetail?: (id: string) => void }) {
  return <Table label="订单列表" columns={["订单号", "用户", "类型 / 号码", "金额", "状态", "下单时间", ...(onDetail ? [""] : [])]}>
    {orders.map(order => <tr key={order.id} className={onDetail ? "oa-clickable" : undefined} onClick={onDetail ? rowClick(() => onDetail(order.id)) : undefined}>
      <td><ShortId value={order.id} /></td><td><strong>{order.email}</strong></td>
      <td><Badge value={order.kind} /><small className="oa-mono">{order.number ?? "—"} · {order.termDays} 天</small></td>
      <td className="oa-numeric">{orderAmount(order)}</td>
      <td><Badge value={order.status} />{order.lastError && <small className="oa-error-text">{order.lastError}</small>}</td>
      <td><DateText value={order.createdAt} /></td>
      {onDetail && <td><IconAction label="查看订单详情" onClick={() => onDetail(order.id)}><Eye /></IconAction></td>}
    </tr>)}
  </Table>;
}
export function leaseStatus(lease: AdminLease) {
  return lease.status === "ACTIVE" && Date.parse(lease.expiresAt) - Date.now() < 3 * 86400000 ? "EXPIRING" : lease.status;
}
export function LeaseTable({ leases, showUser = true, onDetail, menu }: {
  leases: AdminLease[]; showUser?: boolean; onDetail?: (id: string) => void; menu?: (lease: AdminLease) => RowMenuItem[];
}) {
  return <Table label="租约列表" columns={["号码", ...(showUser ? ["用户"] : []), "租期", "状态", "开始 / 到期", "短信", ...(menu || onDetail ? [""] : [])]}>
    {leases.map(lease => <tr key={lease.id} className={onDetail ? "oa-clickable" : undefined} onClick={onDetail ? rowClick(() => onDetail(lease.id)) : undefined}>
      <td><strong className="oa-mono">{lease.number}</strong><small>{lease.countryName} · {lease.regionName}{lease.provider === "pingcode" ? " · PingCode" : ""}</small></td>
      {showUser && <td>{lease.email}</td>}
      <td>{lease.term} 天<small className="oa-money">{lease.priceMinor === 0 ? "免费开通" : money(lease.priceMinor, lease.currency)}</small></td>
      <td><Badge value={leaseStatus(lease)} label={leaseStatus(lease) === "ACTIVE" ? "使用中" : undefined} /></td>
      <td><DateText value={lease.startedAt} /><small>{lease.status === "ENDED" ? <>结束于 <DateText value={lease.endedAt} /></> : <><DateText value={lease.expiresAt} /> · {daysLeft(lease.expiresAt)}</>}</small></td>
      <td className="oa-numeric">{lease.messageCount}<small>发出 {lease.outboundCount}</small></td>
      {(menu || onDetail) && <td><div className="oa-row-actions">{onDetail && <IconAction label="查看租约详情" onClick={() => onDetail(lease.id)}><Eye /></IconAction>}{menu && <RowMenu items={menu(lease)} />}</div></td>}
    </tr>)}
  </Table>;
}
export function MessageTable({ messages, showLease = true }: { messages: AdminMessage[]; showLease?: boolean }) {
  return <Table label="短信记录" columns={["时间", "方向", ...(showLease ? ["本方号码 / 用户"] : []), "对方", "内容", "状态"]}>
    {messages.map(message => <tr key={message.id}>
      <td><DateText value={message.at} /></td><td><Badge value={message.direction} /></td>
      {showLease && <td><strong className="oa-mono">{message.number}</strong><small>{message.email}</small></td>}
      <td className="oa-mono">{message.peer}</td>
      <td className="oa-message-cell">{message.body}{message.code && <small>验证码 {message.code}</small>}</td>
      <td>{message.status ? <Badge value={message.status} /> : message.readAt ? <span className="oa-faint">已读</span> : <span className="oa-faint">未读</span>}
        {message.lastError && <small className="oa-error-text">{message.lastError}</small>}</td>
    </tr>)}
  </Table>;
}
