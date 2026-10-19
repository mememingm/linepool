import { createHmac, timingSafeEqual } from 'node:crypto';

// Only this adapter can produce local test events. It never contacts a network or sends SMS.
export class MockSmsProvider {
  mode = 'mock';
  assertResource(resource) {
    if (resource.source !== 'mock' || !resource.online) throw new Error('Mock resource is offline or belongs to another provider.');
  }
  eventFor({ assignment, task, code, at, eventId }) {
    return { provider: 'mock', eventId, messageId: `mock-${eventId}`, resourceId: assignment.resource_id,
      serviceId: task.service_id, assignmentId: assignment.id, occurredAt: new Date(at).toISOString(),
      text: `[TEST SMS / ${task.service}] Verification code: ${code}. No real SMS was received.` };
  }
}

// Contract boundary only: fail closed until upstream identity/correlation guarantees are confirmed.
export class PingCodeProvider {
  mode = 'unavailable';
  assertResource() { throw new Error('PingCode live integration is not configured or verified.'); }
  normalizeInbound() { throw new Error('PingCode callback correlation and signature contract must be confirmed first.'); }
}

export function signWebhook(secret, timestamp, raw) {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
}
export function verifyWebhook(secret, timestamp, raw, signature, at = Date.now()) {
  if (!secret || typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp) ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const milliseconds = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (Math.abs(at - milliseconds) > 300_000) return false;
  return timingSafeEqual(Buffer.from(signWebhook(secret, timestamp, raw), 'hex'), Buffer.from(signature, 'hex'));
}
