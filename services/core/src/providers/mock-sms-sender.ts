import { Injectable } from '@nestjs/common';
import { Database } from '../database.js';
import { ApiFailure } from '../http.js';
import type { MockSmsScenario } from '../once/message-access.js';
import { terminalOutbound, type OutboundStatus } from '../once/message-state.js';

export type MockSmsRequest = { leaseId: string; to: string; content: string; scenario: MockSmsScenario };
export type MockSmsResult = { providerMessageId: string; status: OutboundStatus; occurredAt: Date; errorCode: string | null };
type MockOperation = { outbound_id: string; request_payload: MockSmsRequest; scenario: MockSmsScenario;
  provider_message_id: string; status: OutboundStatus; created_at: Date; updated_at: Date };
export class MockSmsUnknown extends Error {}

/** Mock acceptance commits independently before the application observes the response. No network transport. */
@Injectable()
export class MockSmsSender {
  constructor(private readonly db: Database) {}
  async send(outboundId: string, request: MockSmsRequest) {
    const saved = await this.db.transaction(async client => {
      const accepted = await client.query(`SELECT id FROM outbound_messages WHERE id=$1 AND provider='pingcode-mock'
        AND request_payload=$2::jsonb`, [outboundId, JSON.stringify(request)]);
      if (!accepted.rowCount) throw new ApiFailure(409, 'MOCK_SMS_IDENTITY_CONFLICT', 'Mock operation does not match the accepted SMS');
      await client.query(`INSERT INTO mock_sms_operations(outbound_id,request_payload,scenario,provider_message_id,status)
        VALUES($1,$2::jsonb,$3,$4,$5) ON CONFLICT(outbound_id) DO NOTHING`,
      [outboundId, JSON.stringify(request), request.scenario, `OUT-${outboundId}`,
        request.scenario.endsWith('FAILURE') ? 'FAILED' : 'QUEUED']);
      const { rows: [row] } = await client.query<MockOperation & { same: boolean }>(`SELECT *,request_payload=$2::jsonb AS same
        FROM mock_sms_operations WHERE outbound_id=$1 FOR UPDATE`, [outboundId, JSON.stringify(request)]);
      if (!row?.same) throw new ApiFailure(409, 'MOCK_SMS_IDENTITY_CONFLICT', 'Mock operation ID was reused');
      return row;
    });
    if (saved.scenario.startsWith('UNKNOWN_')) throw new MockSmsUnknown('MOCK_SMS_RESPONSE_UNKNOWN');
    return this.view(saved);
  }
  async lookup(outboundId: string): Promise<MockSmsResult | null> {
    return this.db.transaction(async client => {
      const { rows: [row] } = await client.query<MockOperation>('SELECT * FROM mock_sms_operations WHERE outbound_id=$1 FOR UPDATE', [outboundId]);
      if (!row) return null; // A positive absence observation permits continuing this same stable operation, subject to current authorization.
      if (!terminalOutbound[row.status]) {
        const age = Date.now() - row.created_at.getTime();
        const status = age >= 2000 ? 'DELIVERED' : age >= 1000 ? 'SENT' : row.status;
        if (status !== row.status) {
          const { rows: [updated] } = await client.query<MockOperation>('UPDATE mock_sms_operations SET status=$2,updated_at=now() WHERE outbound_id=$1 RETURNING *', [outboundId, status]);
          return this.view(updated!);
        }
      }
      return this.view(row);
    });
  }
  async status(outboundId: string, status: 'DELIVERED' | 'UNDELIVERABLE' | 'FAILED') {
    return this.db.transaction(async client => {
      const { rows: [row] } = await client.query<MockOperation>('SELECT * FROM mock_sms_operations WHERE outbound_id=$1 FOR UPDATE', [outboundId]);
      if (!row) throw new ApiFailure(404, 'MOCK_SMS_NOT_FOUND', 'Mock SMS operation was not accepted');
      if (terminalOutbound[row.status] && row.status !== status) throw new ApiFailure(409, 'MOCK_SMS_TERMINAL_CONFLICT', 'Mock terminal result is already determined');
      const { rows: [updated] } = await client.query<MockOperation>('UPDATE mock_sms_operations SET status=$2,updated_at=now() WHERE outbound_id=$1 RETURNING *', [outboundId, status]);
      return this.view(updated!);
    });
  }
  private view(row: MockOperation): MockSmsResult {
    return { providerMessageId: row.provider_message_id, status: row.status, occurredAt: row.updated_at,
      errorCode: row.status === 'FAILED' ? 'MOCK_SMS_REJECTED' : row.status === 'UNDELIVERABLE' ? 'MOCK_SMS_UNDELIVERABLE' : null };
  }
}
