import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbService } from './db.service';
import { cursorPosition, pageResult } from './business';

// The lease supplies user/local-number identity; existing inbound/outbound tables retain provider identity.
export const peerKey = (value: string) => value.replace(/[\s()_-]/g, '').replace(/^\+/, '');
export type ChatRow = {id: string; peer: string; direction: string; body: string; status: string; error: string | null;
  time: Date; createdAt: Date; readAt: Date | null; demo: boolean};
const incomingPeer = Prisma.sql`ltrim(regexp_replace(sender, '[[:space:]()_-]', '', 'g'), '+')`;
const outgoingPeer = Prisma.sql`ltrim(regexp_replace("to", '[[:space:]()_-]', '', 'g'), '+')`;

@Injectable()
export class ChatService {
  constructor(private readonly db: DbService) {}
  async owned(userId: string, leaseId: string) {
    const lease = await this.db.lease.findFirst({where: {id: leaseId, userId}});
    if (!lease) throw new NotFoundException('Lease not found');
    return lease;
  }
  private union(leaseId: string) {
    return Prisma.sql`
      SELECT id, ${incomingPeer} AS peer, 'INBOUND' AS direction, body, 'RECEIVED' AS status,
        NULL::text AS error, "receivedAt" AS time, "createdAt", "readAt", provider LIKE 'demo%' AS demo
      FROM "Message" WHERE "leaseId" = ${leaseId}::uuid
      UNION ALL
      SELECT id, ${outgoingPeer} AS peer, 'OUTBOUND' AS direction, content AS body, status,
        "lastError" AS error, "createdAt" AS time, "createdAt", NULL::timestamptz AS "readAt", provider = 'demo' AS demo
      FROM "OutboundMessage" WHERE "leaseId" = ${leaseId}::uuid`;
  }
  async conversations(userId: string, leaseId: string) {
    await this.owned(userId, leaseId);
    return this.db.$queryRaw<Array<{peer: string; body: string; time: Date; unread: number; direction: string}>>(Prisma.sql`
      WITH messages AS (${this.union(leaseId)}), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY peer ORDER BY time DESC, id ASC) AS rank,
          count(*) FILTER (WHERE direction='INBOUND' AND "readAt" IS NULL) OVER (PARTITION BY peer)::int AS unread
        FROM messages)
      SELECT peer, body, time, unread, direction FROM ranked WHERE rank=1 ORDER BY time DESC, peer ASC`);
  }
  async messages(userId: string, leaseId: string, peer: string, limit: number, cursor?: string) {
    await this.owned(userId, leaseId);
    const scope = `chat:${userId}:${leaseId}:${peerKey(peer)}`, position = cursorPosition(cursor, scope);
    const rows = await this.db.$queryRaw<ChatRow[]>(Prisma.sql`
      WITH messages AS (${this.union(leaseId)}) SELECT * FROM messages
      WHERE peer=${peerKey(peer)} ${position ? Prisma.sql`AND (time < ${position.time} OR (time=${position.time} AND id > ${position.id}::uuid))` : Prisma.empty}
      ORDER BY time DESC, id ASC LIMIT ${limit + 1}`);
    return pageResult(rows, limit, scope, row => row.time);
  }
  async read(userId: string, leaseId: string, ids: string[]) {
    await this.owned(userId, leaseId);
    // Only mark rows actually rendered by this client; a delayed webhook must remain unread.
    await this.db.message.updateMany({where: {leaseId, id: {in: ids}, readAt: null}, data: {readAt: new Date()}});
    return {ok: true};
  }
  async version(userId: string, leaseId: string) {
    await this.owned(userId, leaseId);
    const [incoming, outgoing] = await Promise.all([
      this.db.message.aggregate({where: {leaseId}, _count: {id: true, readAt: true}, _max: {createdAt: true, readAt: true}}),
      this.db.outboundMessage.aggregate({where: {leaseId}, _count: true, _max: {updatedAt: true}}),
    ]);
    return JSON.stringify([incoming._count, incoming._max, outgoing._count, outgoing._max]);
  }
}
