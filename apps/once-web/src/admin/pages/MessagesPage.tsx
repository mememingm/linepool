import { useQuery } from "@tanstack/react-query";
import { listOptions } from "../api";
import { useAdminPage } from "../context";
import { Pager, State } from "../primitives";
import { MessageTable } from "../tables";

export function MessagesPage() {
  const { input, update } = useAdminPage();
  const result = useQuery(listOptions("messages", input));
  return <section className="oa-card">
    <p className="oa-context oa-pad">短信内容属于用户隐私，仅用于排查收发问题，请勿外传。</p>
    <State query={result} columns={6} empty={result.data?.items.length === 0} />
    {result.data && result.data.items.length > 0 && <MessageTable messages={result.data.items} />}
    <Pager data={result.data} onPage={page => update("page", String(page))} />
  </section>;
}
