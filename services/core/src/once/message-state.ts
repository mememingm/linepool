export type OutboundStatus = 'PENDING' | 'SUBMITTING' | 'QUEUED' | 'SENDING' | 'SENT' | 'UNCERTAIN' | 'DELIVERED' | 'UNDELIVERABLE' | 'FAILED';
export const terminalOutbound: Partial<Record<OutboundStatus, true>> = { DELIVERED: true, UNDELIVERABLE: true, FAILED: true };
export type OutboundRow = {
  id: string; lease_id: string; allocation_id: string; user_id: string; number_id: string;
  upstream_account_id: string; provider: string; external_number_id: string; sender_number: string;
  recipient: string; content: string; request_payload: Record<string, unknown>; idempotency_key: string; import_batch_id: string | null;
  provider_message_id: string | null; status: OutboundStatus; attempts: number; claim_token: string | null;
  claim_deadline: Date | null; last_event_at: Date | null; last_checked_at: Date | null;
  error_message: string | null; created_at: Date; updated_at: Date;
};
export function outboundView(row: OutboundRow) {
  return { id: row.id, leaseId: row.lease_id, number: row.sender_number, to: row.recipient,
    content: row.content, status: row.status, errorCode: row.error_message, createdAt: row.created_at,
    updatedAt: row.updated_at, providerMessageId: row.provider_message_id, demo: row.provider === 'pingcode-mock' || row.provider.startsWith('demo') };
}
/** Terminal facts and later observations win; uncertainty never reverses an accepted send. */
export function outboundTransition(row: OutboundRow, status: OutboundStatus, occurredAt: Date) {
  if (terminalOutbound[row.status]) return terminalOutbound[status] && row.status !== status ? 'CONFLICT' as const : 'IGNORE' as const;
  if (row.last_event_at && occurredAt < row.last_event_at) return 'IGNORE' as const;
  if (row.status === 'SENT' && ['QUEUED', 'SENDING', 'UNCERTAIN'].includes(status)) return 'IGNORE' as const;
  if (row.status === 'SENDING' && ['QUEUED', 'UNCERTAIN'].includes(status)) return 'IGNORE' as const;
  if (row.status === 'QUEUED' && status === 'UNCERTAIN') return 'IGNORE' as const;
  return 'APPLY' as const;
}
