import { DbService } from './db.service';

/** One trace for each actual handler invocation. Payloads and credentials never enter this table. */
export async function traceWebhook<T>(db: DbService, id: string, source: string, run: () => Promise<T>): Promise<T> {
  const before = await db.webhookEvent.findUniqueOrThrow({ where: { id } });
  if (['PROCESSED', 'QUARANTINED'].includes(before.status)) return run();
  const started = Date.now();
  try {
    return await run();
  } finally {
    const after = await db.webhookEvent.findUniqueOrThrow({ where: { id } });
    await db.webhookAttempt.create({ data: { eventId: id, source, beforeStatus: before.status,
      afterStatus: after.status, error: after.lastError, durationMs: Math.min(2147483647, Date.now() - started) } });
  }
}
