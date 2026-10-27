import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton } from '../../admin/primitives';
import { agentQueryKey } from '../access';
import { agentError } from '../subagent-shared';

export function useCustomers(agentId: string) {
  return useQuery({ queryKey: agentQueryKey(agentId, 'customers'), queryFn: async ({ signal }) => (await api.agentCustomers({ signal })).data }, queryClient);
}
export function useChildren(agentId: string, enabled: boolean) {
  return useQuery({ queryKey: agentQueryKey(agentId, 'direct-subagents'), enabled,
    queryFn: async ({ signal }) => {
      // All direct children are needed for selectors, independent of the management page's filters.
      const first = await api.agentSubagents({ page: 1, pageSize: 100 }, { signal });
      const rows = [...first.data];
      for (let page = 2; page <= first.pagination.totalPages; page++) rows.push(...(await api.agentSubagents({ page, pageSize: 100 }, { signal })).data);
      return rows;
    } }, queryClient);
}
export function useAgentAction(agentId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  function requestKey(payload: unknown) {
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    return request.current.key;
  }
  async function run(action: () => Promise<unknown>, done: () => void, message = '已保存') {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      toast.success(message); done();
    } catch (cause) { setError(agentError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { busy, error, run, requestKey };
}
export function FormFooter({ busy, onClose, onBack, label = '保存', disabled = false }: { busy: boolean; onClose: () => void; onBack?: () => void; label?: string; disabled?: boolean }) {
  return <footer>{onBack && <ActionButton disabled={busy} onClick={onBack}>返回修改</ActionButton>}<ActionButton disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={disabled}>{label}</ActionButton></footer>;
}
export function ErrorText({ error }: { error: string }) { return error ? <p className="lp-admin-error" role="alert">{error}</p> : null; }
export function Filter({ title, children }: { title: string; children: ReactNode }) { return <label className="lp-agent-inventory-filter">{title}{children}</label>; }
export function money(value: number | null | undefined, currency = 'USD') { return value == null ? '待核算' : `${currency} ${(value / 100).toFixed(2)}`; }
export function parseMoney(value: string) {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [units, cents = ''] = value.split('.');
  const result = Number(units) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
export function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function exportCsv(name: string, rows: Array<Array<string | number>>) {
  const csv = rows.map(row => row.map(value => {
    // Prevent formula execution when downloaded business data is opened in a spreadsheet.
    const text = String(value); const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
