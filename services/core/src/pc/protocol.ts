import type { OutboundStatus } from '../once/message-state.js';

/** An observed upstream SMS task, including the identity checked before accepting it locally. */
export type PcSmsResult = {
  providerMessageId: string;
  status: OutboundStatus;
  occurredAt: Date;
  errorCode: string | null;
  externalNumberId: string;
  senderNumber: string | null;
  recipient: string;
  content: string;
};
