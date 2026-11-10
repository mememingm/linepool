import { useQuery } from "@tanstack/react-query";
import { listOptions } from "../api";
import { auditLabels } from "../navigation";
import { useAdminPage } from "../context";
import { DateText, Pager, ShortId, State, Table } from "../primitives";

const targets: Record<string, string> = { user: "用户", number: "号码", lease: "租约", webhook: "事件", plan: "套餐", settings: "设置" };
export function AuditPage() {
  const { input, update } = useAdminPage();
  const result = useQuery(listOptions("audit", input));
  return <section className="oa-card">
    <State query={result} columns={5} empty={result.data?.items.length === 0} />
    {result.data && result.data.items.length > 0 && <Table label="操作日志" columns={["时间", "管理员", "操作", "对象", "原因"]}>
      {result.data.items.map(entry => <tr key={entry.id}>
        <td><DateText value={entry.createdAt} /></td><td>{entry.actorEmail}</td><td>{auditLabels[entry.action] ?? entry.action}</td>
        <td>{targets[entry.targetType] ?? entry.targetType}<small><ShortId value={entry.targetId} /></small></td><td className="oa-reason-cell">{entry.reason}</td>
      </tr>)}
    </Table>}
    <Pager data={result.data} onPage={page => update("page", String(page))} />
  </section>;
}
