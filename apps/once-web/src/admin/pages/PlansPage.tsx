import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plansOptions } from "../api";
import { useAdminPage } from "../context";
import { Badge, DateText, IconAction, State, Table, money, rowClick } from "../primitives";

export function PlansPage() {
  const { openForm } = useAdminPage();
  const result = useQuery(plansOptions());
  const plans = result.data ?? [];
  const onSale = plans.filter(plan => plan.active).length;
  return <>
    <div className="oa-page-actions">
      <p className="oa-context">上架中 {onSale} 个套餐。至少要保留一个上架套餐，否则用户无法购买。</p>
      <Button onClick={() => openForm({ kind: "plan", plan: null })}><Plus />新建套餐</Button>
    </div>
    <section className="oa-card">
      <State query={result} columns={6} empty={result.data?.length === 0} />
      {plans.length > 0 && <Table label="套餐与价格" columns={["套餐", "天数", "价格", "每天约", "状态", "已售（首次租用）", "最后修改", ""]}>
        {plans.map(plan => <tr key={plan.id} className="oa-clickable" onClick={rowClick(() => openForm({ kind: "plan", plan }))}>
          <td><strong>{plan.label}</strong><small>{plan.note || "—"}</small></td>
          <td>{plan.days} 天</td>
          <td className="oa-numeric oa-money"><strong>{plan.pointsPrice === undefined ? "未提供积分价" : `${plan.pointsPrice.toLocaleString("zh-CN")} 积分`}</strong><small>历史金额参考 {money(plan.priceMinor, plan.currency)}</small></td>
          <td className="oa-numeric oa-money">{plan.pointsPrice === undefined ? "未提供" : `${(plan.pointsPrice / plan.days).toFixed(2)} 积分`}</td>
          <td><Badge value={plan.active ? "PLAN_ON" : "PLAN_OFF"} /></td>
          <td className="oa-numeric">{plan.orderCount}</td>
          <td><DateText value={plan.updatedAt} /></td>
          <td><IconAction label="编辑套餐" onClick={() => openForm({ kind: "plan", plan })}><Pencil /></IconAction></td>
        </tr>)}
      </Table>}
    </section>
    <p className="oa-context">排序数字小的套餐排在前面；首页会给「每天最便宜」的套餐标上「更划算」。</p>
  </>;
}
