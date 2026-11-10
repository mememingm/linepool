import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { historyQuerySchema, messageCursor, messagePage, ownedMessageLease, parseInput } from './message-access.js';

export const peerKey = (value: string) => value.replace(/[\s()_-]/g, '').replace(/^\+/, '');
export const chatQuerySchema = historyQuerySchema.extend({ peer: z.string().min(1).max(120) });
export const chatReadSchema = z.strictObject({ ids: z.array(z.uuid()).max(200) });
export type OnceChatRow = { id: string; peer: string; direction: 'INBOUND' | 'OUTBOUND'; body: string; status: string;
  error: string | null; time: Date; createdAt: Date | null; readAt: Date | null; demo: boolean; isRead: boolean };

/** Reads the existing inbound/outbound records; the lease only supplies historical ownership. */
@Injectable()
export class OnceChat {
  constructor(private readonly db: Database, private readonly environment: Environment) {}

  private readonly union = `SELECT m.id,ltrim(regexp_replace(m.sender,'[[:space:]()_-]','','g'),'+') AS peer,
    'INBOUND'::text AS direction,m.body,'RECEIVED'::text AS status,NULL::text AS error,m.received_at AS time,
    m.ingested_at AS "createdAt",m.read_at AS "readAt",m.is_read AS "isRead",
    EXISTS(SELECT 1 FROM provider_message_receipts r WHERE r.message_id=m.id AND (r.provider='pingcode-mock' OR r.provider LIKE 'demo%')) AS demo
    FROM sms_messages m JOIN number_allocations a ON a.id=m.allocation_id AND a.number_id=m.number_id AND a.user_id=m.user_id
    WHERE a.lease_id=$1 AND a.allocation_type='WHOLE_NUMBER' AND m.user_id=$2
    UNION ALL SELECT o.id,ltrim(regexp_replace(o.recipient,'[[:space:]()_-]','','g'),'+') AS peer,
    'OUTBOUND'::text,o.content,o.status,o.error_message,o.created_at,o.created_at,NULL::timestamptz,true,
    (o.provider='pingcode-mock' OR o.provider LIKE 'demo%') FROM outbound_messages o WHERE o.lease_id=$1 AND o.user_id=$2`;

  async conversations(userId: string, leaseId: string) {
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    const { rows } = await this.db.query<{ peer: string; body: string; time: Date; unread: number; direction: string }>(
      `WITH messages AS (${this.union}),ranked AS (SELECT *,row_number() OVER(PARTITION BY peer ORDER BY time DESC,id ASC) AS rank,
        count(*) FILTER(WHERE direction='INBOUND' AND NOT "isRead") OVER(PARTITION BY peer)::int AS unread FROM messages)
       SELECT peer,body,time,unread,direction FROM ranked WHERE rank=1 ORDER BY time DESC,peer ASC`, [leaseId, userId]);
    return rows;
  }

  async messages(userId: string, leaseId: string, input: unknown) {
    const query = parseInput(chatQuerySchema, input), peer = peerKey(query.peer);
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    const scope = `chat:${userId}:${leaseId}:${peer}`, position = messageCursor(query.cursor, scope);
    const { rows } = await this.db.query<OnceChatRow>(`WITH messages AS (${this.union}) SELECT * FROM messages
      WHERE peer=$3 AND ($4::timestamptz IS NULL OR time<$4 OR (time=$4 AND id>$5::uuid))
      ORDER BY time DESC,id ASC LIMIT $6`, [leaseId, userId, peer, position?.time ?? null, position?.id ?? null, query.limit + 1]);
    return messagePage(rows, query.limit, scope, row => row.time);
  }

  async read(userId: string, leaseId: string, input: unknown) {
    const { ids } = parseInput(chatReadSchema, input);
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    await this.db.query(`UPDATE sms_messages m SET is_read=true,read_at=COALESCE(m.read_at,now())
      FROM number_allocations a WHERE a.id=m.allocation_id AND a.number_id=m.number_id AND a.user_id=m.user_id
      AND a.lease_id=$1 AND a.allocation_type='WHOLE_NUMBER' AND m.user_id=$2 AND m.id=ANY($3::uuid[])
      AND (NOT m.is_read OR m.read_at IS NULL)`, [leaseId, userId, ids]);
    return { ok: true };
  }

  async version(userId: string, leaseId: string) {
    await ownedMessageLease(this.db, this.environment, userId, leaseId);
    // Persisted row revisions include late ingestion and changes committed by any API/worker instance.
    const { rows: [revision] } = await this.db.query<{ inbound_count: string; inbound_revision: string; outbound_count: string; outbound_revision: string }>(
      `SELECT (SELECT count(*)::text FROM sms_messages m JOIN number_allocations a ON a.id=m.allocation_id
          WHERE a.lease_id=$1 AND m.user_id=$2) AS inbound_count,
        (SELECT COALESCE(sum(hashtextextended(concat_ws('|',m.id::text,m.is_read::text,m.read_at::text,m.ingested_at::text),0)::numeric),0)::text
          FROM sms_messages m JOIN number_allocations a ON a.id=m.allocation_id WHERE a.lease_id=$1 AND m.user_id=$2) AS inbound_revision,
        (SELECT count(*)::text FROM outbound_messages WHERE lease_id=$1 AND user_id=$2) AS outbound_count,
        (SELECT COALESCE(sum(hashtextextended(concat_ws('|',id::text,status,error_message,last_event_at::text,updated_at::text),0)::numeric),0)::text
          FROM outbound_messages WHERE lease_id=$1 AND user_id=$2) AS outbound_revision`, [leaseId, userId]);
    return JSON.stringify(revision);
  }
}
