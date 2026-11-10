import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Eye } from "lucide-react";
import { listOptions } from "../api";
import { adminHref } from "../navigation";
import { useAdminPage } from "../context";
import { Badge, DateText, IconAction, Pager, RowMenu, State, Table, rowClick } from "../primitives";

export function UsersPage() {
  const { input, update, openDetail, openAction } = useAdminPage();
  const navigate = useNavigate();
  const result = useQuery(listOptions("users", input));
  return <section className="oa-card">
    <State query={result} columns={6} empty={result.data?.items.length === 0} />
    {result.data && result.data.items.length > 0 && <Table label="用户管理" columns={["用户", "使用中号码", "租约", "订单", "状态", "注册 / 最近登录", ""]}>
      {result.data.items.map(user => <tr key={user.id} className="oa-clickable" onClick={rowClick(() => openDetail({ section: "users", id: user.id }))}>
        <td><strong>{user.email}{user.role === "ADMIN" && <span className="oa-inline-tag">管理员</span>}</strong></td>
        <td className="oa-numeric"><strong>{user.activeLeaseCount}</strong></td><td className="oa-numeric">{user.leaseCount}</td><td className="oa-numeric">{user.orderCount}</td>
        <td><Badge value={user.status} /></td><td><DateText value={user.createdAt} /><small>{user.lastLoginAt ? <DateText value={user.lastLoginAt} /> : "未提供登录时间"}</small></td>
        <td><div className="oa-row-actions"><IconAction label="查看用户详情" onClick={() => openDetail({ section: "users", id: user.id })}><Eye /></IconAction>
          <RowMenu items={user.role === "ADMIN" ? [] : [
            { label: "查看该用户的租约", onSelect: () => navigate(adminHref("leases", { userId: user.id })) },
            { label: "查看该用户的订单", onSelect: () => navigate(adminHref("orders", { userId: user.id })) },
            ...(user.authKind === "PINCLODE" ? [] : [{ label: "重置密码", onSelect: () => openAction({ kind: "password", user }) }]),
            { label: user.status === "ACTIVE" ? "禁用账号" : "启用账号", danger: user.status === "ACTIVE", onSelect: () => openAction({ kind: "user-status", user }) },
          ]} /></div></td>
      </tr>)}
    </Table>}
    <Pager data={result.data} onPage={page => update("page", String(page))} />
  </section>;
}
