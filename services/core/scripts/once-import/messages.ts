import { canonicalPhoneNumber, id, record, text as s } from './model.js';
import { ImportPlan } from './plan.js';

export async function planMessages(b: ImportPlan): Promise<void> {
  await b.each('Message', async row => {
    const lease = b.find('Lease', row.leaseId), number = b.find('PhoneNumber', lease.phoneNumberId);
    const period = b.period(id(lease), row.receivedAt), targetId = b.mapped('Message', id(row));
    const localMessage = ['demo', 'demo-chat', `demo-inbox:${s(lease.userId)}`].includes(s(row.provider)) && row.providerAccountId === '' && number.provider === 'demo';
    const provenance = row.providerMessageId ? b.provenance(localMessage ? number : row) : null;
    if (provenance && !localMessage && (number.provider !== row.provider || number.providerAccountId !== row.providerAccountId || !number.providerNumberId)) throw new Error('Message provider identity differs from its historical resource');
    if (await b.fact('Message', row, targetId, null, { allocationId: id(period), provenance })) {
      b.write('Message', row, 'sms_messages', { id: targetId, user_id: b.mapped('User', lease.userId), number_id: b.mapped('PhoneNumber', id(number)), allocation_id: id(period), platform_id: null, sender: row.sender, title: row.title, body: row.body, verification_code: row.code, received_at: row.receivedAt, is_read: row.readAt != null, read_at: row.readAt, ingested_at: row.createdAt });
      if (provenance) {
        const normalized = { kind: 'INBOUND', provider: row.provider, upstreamAccountId: provenance.accountId, externalProjectId: null, externalNumberId: number.providerNumberId, externalMessageId: row.providerMessageId, phoneNumber: canonicalPhoneNumber(number.number), sender: row.sender, title: row.title, content: row.body, code: row.code, occurredAt: new Date(s(row.receivedAt)).toISOString() };
        b.write('Message', row, 'provider_message_receipts', { provider: row.provider, external_message_id: row.providerMessageId, upstream_account_id: provenance.accountId, message_id: targetId, allocation_id: id(period), fingerprint: null, normalized_payload: normalized, raw_payload: { source: row }, external_project_id: null, external_number_id: number.providerNumberId, upstream_created_at: row.receivedAt, created_at: row.createdAt, received_at: row.createdAt, ingested_at: row.createdAt, processing_status: 'IMPORTED', processed_at: row.createdAt, import_batch_id: b.decisions.batchId }, { provider: row.provider, external_message_id: row.providerMessageId });
      }
    }
  });
  await b.each('OutboundMessage', async row => {
    const lease = b.find('Lease', row.leaseId), number = b.find('PhoneNumber', lease.phoneNumberId), period = b.period(id(lease), row.createdAt), provenance = b.provenance(row);
    const localDemo = row.provider === 'demo' && row.providerAccountId === '';
    if (row.from !== number.number || number.provider !== row.provider || number.providerAccountId !== row.providerAccountId || (!localDemo && !number.providerNumberId)) throw new Error('Original outbound sender/provider identity is missing or changed');
    if (!['DELIVERED', 'UNDELIVERABLE', 'FAILED'].includes(s(row.status)) && !(localDemo && row.status === 'SENT')) throw new Error('Unfinished outbound operation must settle in source before import; never replay send');
    if (row.claimUntil != null) throw new Error('Source outbound claim has not been cleared');
    const payload = b.request('OutboundMessage', row), targetId = b.mapped('OutboundMessage', id(row));
    if (await b.fact('OutboundMessage', row, targetId, null, { request: payload, allocationId: id(period), provenance })) b.write('OutboundMessage', row, 'outbound_messages', { id: targetId, lease_id: b.mapped('Lease', id(lease)), allocation_id: id(period), user_id: b.mapped('User', lease.userId), number_id: b.mapped('PhoneNumber', id(number)), upstream_account_id: provenance.accountId, provider: provenance.provider, external_number_id: number.providerNumberId, sender_number: canonicalPhoneNumber(row.from), recipient: row.to, content: row.content, request_payload: payload, idempotency_key: row.idempotencyKey, provider_message_id: row.providerMessageId, status: row.status, attempts: row.attempts, claim_token: null, claim_deadline: null, last_event_at: row.lastEventAt, last_checked_at: row.lastCheckedAt, error_message: row.lastError, created_at: row.createdAt, updated_at: row.updatedAt, import_batch_id: b.decisions.batchId });
  });
  await b.each('WebhookEvent', async row => {
    const payload = record(row.payload), targetId = b.mapped('WebhookEvent', id(row));
    const localLease = row.leaseId ? b.find('Lease', row.leaseId) : null;
    const localInbox = Boolean(localLease && row.provider === `demo-inbox:${s(localLease.userId)}` && row.providerAccountId === '');
    const number = localInbox ? b.find('PhoneNumber', localLease!.phoneNumberId) : b.source.PhoneNumber.find(p => p.provider === row.provider && p.providerAccountId === row.providerAccountId && p.providerNumberId === row.providerNumberId);
    if (localInbox && (!number || number.provider !== 'demo' || payload.leaseId !== row.leaseId)) throw new Error('Local demo inbox does not match its original user/lease/resource');
    const provenance = b.provenance(localInbox ? number! : row);
    const messageId = localInbox ? payload.providerMessageId : row.providerMessageId;
    if (localInbox && (typeof messageId !== 'string' || !messageId)) throw new Error('Local demo event lacks original payload message identity');
    const outbound = row.outboundMessageId ? b.find('OutboundMessage', row.outboundMessageId) : null;
    const isOutbound = Boolean(outbound) || payload.type === 'send' || payload.direction === 'OUTBOUND' || payload.kind === 'OUTBOUND' || 'sendStatus' in payload;
    const messages = !isOutbound && messageId ? b.source.Message.filter(m => m.provider === row.provider && m.providerAccountId === row.providerAccountId && m.providerMessageId === messageId) : [];
    if (messages.length > 1) throw new Error('Global external message identity has multiple delivered source messages; reviewed conflict disposition is required');
    const message = messages[0];
    const normalized = b.request('WebhookEvent', row);
    if (normalized.provider !== row.provider || normalized.upstreamAccountId !== provenance.accountId || normalized.externalNumberId !== row.providerNumberId || normalized.externalMessageId !== messageId) throw new Error('Reviewed normalized event changes original provider/account/number/message identity');
    if (localInbox) {
      const expected = { kind: 'INBOUND', provider: row.provider, upstreamAccountId: provenance.accountId, externalProjectId: null, externalNumberId: null, externalMessageId: messageId, phoneNumber: canonicalPhoneNumber(number!.number), sender: payload.sender, title: payload.title, content: payload.body, code: payload.code ?? null, occurredAt: new Date(s(payload.receivedAt)).toISOString() };
      if (!await b.jsonEqual(normalized, expected)) throw new Error('Local demo event normalization differs from its original payload and canonical imported receipt');
    }
    if (!isOutbound && message && row.status !== 'QUARANTINED' && (normalized.content !== message.body || normalized.sender !== message.sender || normalized.title !== message.title || normalized.code !== message.code || Date.parse(s(normalized.occurredAt)) !== Date.parse(s(message.receivedAt)))) throw new Error('Event and delivered message have conflicting source facts');
    const mappedStatus = ({ RECEIVED: 'PENDING', PENDING: 'PENDING', PROCESSING: 'PENDING', IMPORTED: 'IMPORTED', PROCESSED: 'IMPORTED', UNMATCHED: 'UNMATCHED', FAILED: 'FAILED', QUARANTINED: 'QUARANTINED', IGNORED: 'IGNORED' } as Record<string, string>)[s(row.status)];
    if (!mappedStatus) throw new Error(`Unknown original event state ${s(row.status)}`);
    if (mappedStatus === 'IMPORTED' && !outbound && !message) throw new Error('Imported inbound event lacks original delivered message identity');
    if (await b.fact('WebhookEvent', row, targetId, null, { normalized, provenance })) {
      if (!isOutbound && messageId && !message && !localInbox) b.write('WebhookEvent', row, 'provider_message_receipts', { provider: row.provider, external_message_id: messageId, upstream_account_id: provenance.accountId, message_id: null, allocation_id: null, fingerprint: row.payloadHash, normalized_payload: normalized, raw_payload: payload, external_project_id: null, external_number_id: row.providerNumberId, upstream_created_at: row.occurredAt, created_at: row.receivedAt, received_at: row.receivedAt, ingested_at: null, processing_status: mappedStatus === 'QUARANTINED' ? 'QUARANTINED' : 'UNMATCHED', processed_at: row.processedAt, failure_reason: row.lastError, import_batch_id: b.decisions.batchId }, { provider: row.provider, external_message_id: messageId });
      b.write('WebhookEvent', row, 'provider_event_receipts', { id: targetId, provider: row.provider, event_id: row.eventId, event_kind: isOutbound ? 'OUTBOUND' : 'INBOUND', external_message_id: isOutbound || (localInbox && !message) ? null : messageId, upstream_account_id: provenance.accountId, number_id: number ? b.mapped('PhoneNumber', id(number)) : null, outbound_id: outbound ? b.mapped('OutboundMessage', id(outbound)) : null, provider_message_id: isOutbound ? row.providerMessageId : null, payload, normalized_payload: normalized, status: mappedStatus, attempts: row.attempts, next_attempt_at: row.nextAttemptAt, last_error: row.lastError, received_at: row.receivedAt, processed_at: row.processedAt, created_at: row.receivedAt, updated_at: null, delivery_count: 1 + Number(row.conflictCount), import_batch_id: b.decisions.batchId }, { provider: row.provider, event_id: row.eventId });
      if (Number(row.conflictCount) > 0) {
        // Source retains only the last conflicting hash/time. Preserve that evidence without inventing a lost body.
        await b.fact('WebhookConflictEvidence', { id: id(row), conflictCount: row.conflictCount, lastConflictHash: row.lastConflictHash, lastConflictAt: row.lastConflictAt }, targetId, null, { retainedSource: true });
        if (mappedStatus !== 'QUARANTINED') b.block('UNRESOLVED_EVENT_CONFLICT', 'WebhookEvent', id(row), { event: row, message: message ?? null });
      }
    }
  });
  await b.each('WebhookAttempt', async row => {
    if (await b.fact('WebhookAttempt', row, b.mapped('WebhookAttempt', id(row)))) b.write('WebhookAttempt', row, 'provider_event_attempts', { id: b.mapped('WebhookAttempt', id(row)), event_id: b.mapped('WebhookEvent', row.eventId), from_status: row.beforeStatus, to_status: row.afterStatus, reason: JSON.stringify({ source: row.source, error: row.error, durationMs: row.durationMs }), created_at: row.createdAt });
  });
}
