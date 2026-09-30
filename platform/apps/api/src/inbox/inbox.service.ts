import type {
  PaginatedResponse,
  PaginationQuery,
  SmsMessage,
} from '@linepool/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { ApiException } from '../errors/api-exception.js';

interface MessageRow {
  id: string;
  phone_number_id: string;
  phone_number: string;
  sender: string;
  body: string;
  verification_code: string | null;
  received_at: Date;
  is_read: boolean;
}

function mapMessage(row: MessageRow): SmsMessage {
  return {
    id: row.id,
    phoneNumberId: row.phone_number_id,
    phoneNumber: row.phone_number,
    sender: row.sender,
    body: row.body,
    verificationCode: row.verification_code,
    receivedAt: row.received_at.toISOString(),
    isRead: row.is_read,
  };
}

@Injectable()
export class InboxService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    userId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<SmsMessage>> {
    const offset = (query.page - 1) * query.pageSize;
    const [messages, count] = await Promise.all([
      this.database.query<MessageRow>(
        `
          SELECT m.id, m.phone_number_id, n.phone_number, m.sender, m.body,
                 m.verification_code, m.received_at, m.is_read
          FROM sms_messages m
          JOIN phone_numbers n ON n.id = m.phone_number_id
          WHERE m.user_id = $1
          ORDER BY m.received_at DESC, m.id DESC
          LIMIT $2 OFFSET $3
        `,
        [userId, query.pageSize, offset],
      ),
      this.database.query<{ count: string }>(
        'SELECT count(*) FROM sms_messages WHERE user_id = $1',
        [userId],
      ),
    ]);
    const totalItems = Number(count.rows[0]?.count ?? 0);
    return {
      data: messages.rows.map(mapMessage),
      pagination: {
        ...query,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async markRead(userId: string, messageId: string): Promise<SmsMessage> {
    const result = await this.database.query<MessageRow>(
      `
        UPDATE sms_messages AS m
        SET is_read = true
        FROM phone_numbers AS n
        WHERE m.id = $1 AND m.user_id = $2 AND n.id = m.phone_number_id
        RETURNING m.id, m.phone_number_id, n.phone_number, m.sender, m.body,
                  m.verification_code, m.received_at, m.is_read
      `,
      [messageId, userId],
    );
    const message = result.rows[0];
    if (!message) {
      throw new ApiException(
        'MESSAGE_NOT_FOUND',
        '短信不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    return mapMessage(message);
  }
}
