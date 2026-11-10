import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock3, FileUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { listOptions, settingsOptions, stockOptions } from "../api";
import { useAdminPage } from "../context";
import { Badge, DateText, Pager, RowMenu, State, Table, daysLeft, rowClick } from "../primitives";
import type { AdminNumber } from "../types";

function cooldownText(days: number | null | undefined) {
  if (days === undefined) return "读取中…";
  return days === null ? "到期号码只由管理员手动释放" : days === 0 ? "到期后立即重新上架" : `到期后保留 ${days} 天再自动上架`;
}
function StockPanel() {
  const [open, setOpen] = useState(false);
  const stock = useQuery({ ...stockOptions(), enabled: open });
  return <details className="oa-card oa-stock" onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary><span>按地区查看库存</span><ChevronDown size={16} /></summary>
    {open && <><State query={stock} columns={5} empty={stock.data?.length === 0} />
      {stock.data && stock.data.length > 0 && <Table label="地区库存" columns={["地区", "可售", "使用中 / 到期保留", "已暂停", "合计"]}>
        {stock.data.map(region => <tr key={`${region.countryCode}:${region.regionId}`}>
          <td>{region.regionName}<small>{region.countryCode === "CA" ? "加拿大" : "美国"}</small></td>
          <td className="oa-numeric">{region.available <= 3 ? <strong className="oa-error-text">{region.available}</strong> : region.available}</td>
          <td className="oa-numeric">{region.occupied}</td><td className="oa-numeric">{region.held}</td><td className="oa-numeric">{region.total}</td>
        </tr>)}</Table>}</>}
  </details>;
}

export function NumbersPage() {
  const { input, update, openDetail, openAction, openForm } = useAdminPage();
  const result = useQuery(listOptions("numbers", input));
  const settings = useQuery(settingsOptions());
  const [selected, setSelected] = useState<Map<string, AdminNumber>>(new Map());
  // Selection is per page of results; changing filters or pages starts over.
  const listKey = JSON.stringify(input);
  useEffect(() => setSelected(new Map()), [listKey]);
  const items = result.data?.items ?? [];
  const selectable = items.filter(number => !number.historicalOnly);
  const allSelected = selectable.length > 0 && selectable.every(number => selected.has(number.id));
  function toggle(number: AdminNumber, checked: boolean) {
    setSelected(previous => { const next = new Map(previous); if (checked) next.set(number.id, number); else next.delete(number.id); return next; });
  }
  const chosen = [...selected.values()];
  const batch = (action: "release" | "hold") => openAction({ kind: "batch", action, numbers: chosen });
  return <>
    <div className="oa-page-actions">
      <p className="oa-context"><Clock3 size={14} />到期规则：{cooldownText(settings.data?.cooldownDays)}
        {settings.data && <Button variant="link" size="sm" onClick={() => openForm({ kind: "settings", settings: settings.data! })}>修改</Button>}</p>
      <div className="oa-row-actions">
        <Button variant="outline" onClick={() => openForm({ kind: "import" })}><FileUp />批量导入</Button>
        <Button onClick={() => openForm({ kind: "number", number: null })}><Plus />新增号码</Button>
      </div>
    </div>
    <StockPanel />
    {chosen.length > 0 && <div className="oa-batch-bar" role="region" aria-label="批量操作">
      <span>已选择 <strong>{chosen.length}</strong> 个号码</span>
      <Button size="sm" onClick={() => batch("release")}>释放（重新上架）</Button>
      <Button size="sm" variant="outline" onClick={() => batch("hold")}>暂停售卖</Button>
      <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>取消选择</Button>
    </div>}
    <section className="oa-card">
      <State query={result} columns={6} empty={result.data?.items.length === 0} />
      {items.length > 0 && <Table label="号码库存" columns={[
        <Checkbox key="all" aria-label="选择本页可操作号码" checked={allSelected} disabled={!selectable.length} onCheckedChange={checked => setSelected(checked === true ? new Map(selectable.map(number => [number.id, number])) : new Map())} />,
        "号码", "地区", "状态", "当前 / 上一位用户", "到期", ""]}>
        {items.map(number => <tr key={number.id} className="oa-clickable" data-selected={selected.has(number.id) || undefined} onClick={rowClick(() => openDetail({ section: "numbers", id: number.id }))}>
          <td><Checkbox aria-label={`选择 ${number.number}`} disabled={number.historicalOnly} checked={selected.has(number.id)} onCheckedChange={checked => toggle(number, checked === true)} /></td>
          <td><strong className="oa-mono">{number.number}</strong>{number.source === "ADMIN" && <small>手动录入{number.note ? ` · ${number.note}` : ""}</small>}
            {number.source !== "ADMIN" && number.note && <small>{number.note}</small>}</td>
          <td>{number.regionName}<small>{number.countryName}</small></td>
          <td><Badge value={number.saleStatus} label={number.saleStatus === "OCCUPIED" ? "使用中" : number.saleStatus === "EXPIRED_HELD" ? "到期保留" : undefined} />
            {number.saleStatus === "HELD" && number.holdReason && <small>{number.holdReason}</small>}
            {number.saleStatus === "EXPIRED_HELD" && <small>{number.autoReleaseAt ? <>自动上架 <DateText value={number.autoReleaseAt} /></> : "等待手动释放"}</small>}</td>
          <td>{number.currentLease?.email ?? number.heldBy ?? <span className="oa-faint">—</span>}</td>
          <td>{number.currentLease ? <><DateText value={number.currentLease.expiresAt} /><small>{daysLeft(number.currentLease.expiresAt)}</small></>
            : number.heldSince ? <><DateText value={number.heldSince} /><small>已到期</small></> : "—"}</td>
          <td><div className="oa-row-actions">
            {number.saleStatus === "AVAILABLE" && <Button size="sm" variant="outline" onClick={() => openAction({ kind: "assign", number })}>分配</Button>}
            {number.saleStatus === "EXPIRED_HELD" && <Button size="sm" variant="outline" onClick={() => openAction({ kind: "batch", action: "release", numbers: [number] })}>释放</Button>}
            <RowMenu items={[
              { label: "查看详情和历史", onSelect: () => openDetail({ section: "numbers", id: number.id }) },
              ...(!number.historicalOnly ? [{ label: "编辑地区和备注", onSelect: () => openForm({ kind: "number", number }) }] : []),
              ...(!number.historicalOnly && (number.saleStatus === "AVAILABLE" || number.saleStatus === "HELD") ? [{ label: number.saleStatus === "HELD" ? "恢复售卖" : "暂停售卖", onSelect: () => openAction({ kind: "hold", number }) }] : []),
              ...(!number.historicalOnly && number.deletable ? [{ label: "删除号码", danger: true, onSelect: () => openAction({ kind: "delete-number", number }) }] : []),
            ]} /></div></td>
        </tr>)}
      </Table>}
      <Pager data={result.data} onPage={page => update("page", String(page))} />
    </section>
  </>;
}
