import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listOptions } from "../api";
import { adminHref } from "../navigation";
import { useAdminPage } from "../context";
import { Pager, State } from "../primitives";
import { LeaseTable } from "../tables";

export function LeasesPage() {
  const { input, update, openDetail, openAction } = useAdminPage();
  const navigate = useNavigate();
  const result = useQuery(listOptions("leases", input));
  return <section className="oa-card">
    <State query={result} columns={6} empty={result.data?.items.length === 0} />
    {result.data && result.data.items.length > 0 && <LeaseTable leases={result.data.items} onDetail={id => openDetail({ section: "leases", id })}
      menu={lease => [
        { label: "查看短信", onSelect: () => navigate(adminHref("messages", { leaseId: lease.id })) },
        ...(!lease.historicalOnly && lease.status === "ACTIVE" ? [{ label: "延期", onSelect: () => openAction({ kind: "extend", lease }) }] : []),
        ...(!lease.historicalOnly && !["ENDED", "RELEASED"].includes(lease.status) ? [{ label: "回收号码", danger: true, onSelect: () => openAction({ kind: "end", lease }) }] : []),
      ]} />}
    <Pager data={result.data} onPage={page => update("page", String(page))} />
  </section>;
}
