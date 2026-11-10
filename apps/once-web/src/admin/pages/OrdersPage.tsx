import { useQuery } from "@tanstack/react-query";
import { listOptions } from "../api";
import { useAdminPage } from "../context";
import { Pager, State } from "../primitives";
import { OrderTable } from "../tables";

export function OrdersPage() {
  const { input, update, openDetail } = useAdminPage();
  const result = useQuery(listOptions("orders", input));
  return <section className="oa-card">
    <State query={result} columns={6} empty={result.data?.items.length === 0} />
    {result.data && result.data.items.length > 0 && <OrderTable orders={result.data.items} onDetail={id => openDetail({ section: "orders", id })} />}
    <Pager data={result.data} onPage={page => update("page", String(page))} />
  </section>;
}
