import { Injectable } from '@nestjs/common';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { PcHttpProvider } from '../pc/http-provider.js';
import type { PcSmsResult } from '../pc/protocol.js';
import type { OutboundRow } from '../once/message-state.js';

type SenderConnection = { access_token: string; upstream_account_id: string; external_number_id: string;
  sender_number: string; recipient: string; content: string; provider_message_id: string | null };

/** Raised before any request: the worker may keep the same local item queued. */
export class PcSmsNotSubmitted extends ApiFailure {
  constructor(message: string) { super(409, 'PC_SMS_CONNECTION_UNAVAILABLE', message); }
}

/** Uses the original connected inventory and existing access token; PcWorker owns refresh rotation. */
@Injectable()
export class PcSmsSender {
  constructor(private readonly db: Database, private readonly environment: Environment, private readonly provider: PcHttpProvider) {}
  private async connection(row: OutboundRow) {
    if (!this.environment.isWorker || this.environment.pcProvider !== 'pingcode' || this.environment.siteId !== 'once'
      || row.provider !== 'pingcode' || row.import_batch_id) {
      throw new PcSmsNotSubmitted('Real SMS requires the original live worker connection');
    }
    const { rows: [connection] } = await this.db.query<SenderConnection>(`SELECT a.access_token,o.upstream_account_id,
      o.external_number_id,o.sender_number,o.recipient,o.content,o.provider_message_id
      FROM outbound_messages o JOIN upstream_accounts a ON a.id=o.upstream_account_id
      JOIN storefronts f ON f.id=a.storefront_id JOIN phone_numbers n ON n.id=o.number_id AND n.upstream_account_id=a.id
      JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=a.provider
        AND b.external_number_id=o.external_number_id AND b.external_project_id IS NULL
      WHERE o.id=$1 AND o.provider='pingcode' AND o.import_batch_id IS NULL AND a.provider=o.provider
        AND n.phone_number=o.sender_number AND a.storefront_id='once' AND f.product='NUMBER_LEASE'
        AND a.owner_kind='SELF_SERVICE' AND a.agent_id IS NULL AND NOT a.historical_only
        AND a.external_account_id=$2 AND a.application_id=$3 AND a.issuer=$4 AND a.subject IS NOT NULL
        AND a.status='ACTIVE' AND a.auth_status='ACTIVE' AND a.access_expires_at>now()
        AND a.access_token IS NOT NULL AND a.access_token<>'' AND a.refresh_claim_id IS NULL
        AND 'SEND_SMS'=ANY(a.capabilities) AND 'SEND_SMS'=ANY(a.enabled_capabilities)`,
      [row.id, this.environment.selfServiceExternalAccountId, this.environment.values.PC_APPLICATION_ID, this.environment.values.PC_ISSUER]);
    if (!connection || connection.upstream_account_id !== row.upstream_account_id
      || connection.external_number_id !== row.external_number_id || connection.sender_number !== row.sender_number
      || connection.recipient !== row.recipient || connection.content !== row.content
      || connection.provider_message_id !== row.provider_message_id) {
      throw new PcSmsNotSubmitted('The original SMS connection or sender identity is unavailable');
    }
    return connection;
  }
  private validate(row: OutboundRow, result: PcSmsResult) {
    if (!/^OUT-\d+$/.test(result.providerMessageId) || (row.provider_message_id && result.providerMessageId !== row.provider_message_id)
      || result.externalNumberId !== row.external_number_id || result.senderNumber !== row.sender_number
      || result.recipient !== row.recipient || result.content !== row.content) {
      throw new ApiFailure(409, 'PC_SMS_RESULT_IDENTITY_CONFLICT', 'Upstream SMS does not match the original sender, recipient, body and task identity');
    }
    return result;
  }
  async send(row: OutboundRow): Promise<PcSmsResult> {
    if (row.provider_message_id || row.attempts !== 1) throw new ApiFailure(409, 'PC_SMS_RESUBMISSION_FORBIDDEN', 'An ambiguous real SMS cannot be resubmitted automatically');
    const connection = await this.connection(row).catch(() => {
      throw new PcSmsNotSubmitted('The original SMS connection could not be verified before submission');
    });
    const result = await this.provider.send(connection.access_token,
      { phoneNumber: row.sender_number, to: row.recipient, content: row.content }, row.id);
    this.validate(row, result);
    return result;
  }
  async lookup(row: OutboundRow): Promise<PcSmsResult> {
    if (!row.provider_message_id || !/^OUT-\d+$/.test(row.provider_message_id)) {
      throw new ApiFailure(409, 'PC_SMS_TASK_ID_REQUIRED', 'The original OUT task ID is required for status lookup');
    }
    const connection = await this.connection(row);
    const result = await this.provider.lookup(connection.access_token, row.provider_message_id);
    this.validate(row, result);
    return result;
  }
}
