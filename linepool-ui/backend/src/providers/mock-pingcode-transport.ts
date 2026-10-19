import { normalizePhone, type PingCodeRequest, type PingCodeResponse, type PingCodeTransport } from './pingcode-adapter.js';

type MockNumber = { id: number; phoneNumber?: string; iccid?: string; status: string; expiresAt?: string };
type MockSms = { id: string; numberId: number; phoneNumber?: string; direction: string; counterparty: string;
  content: string; status: string; occurredAt: string; createdAt: string };
/** Synthetic fixtures shaped only like documented responses. Cursors below are Mock-only tokens. */
export class MockPingCodeTransport implements PingCodeTransport {
  readonly requests: PingCodeRequest[] = [];
  constructor(private readonly fixtures: { numbers: MockNumber[]; messages: MockSms[] } = { numbers: [], messages: [] }) {}
  async request(input: PingCodeRequest): Promise<PingCodeResponse> {
    this.requests.push(structuredClone(input));
    const path = input.path.replace(/^\/pingcode\/api\/open\/v1/, '');
    if (path === '/me') return { status: 200, body: { id: 1, username: 'linepool-mock', scopes: ['numbers:read', 'sms:read'] } };
    if (path === '/numbers') return this.page(this.fixtures.numbers.filter(number => !input.query.status || number.status === input.query.status)
      .sort((a, b) => b.id - a.id), input.query);
    if (path === '/numbers/by-phone') return this.result(this.fixtures.numbers.find(number => number.phoneNumber
      && normalizePhone(number.phoneNumber) === normalizePhone(input.query.phoneNumber)));
    if (path === '/sms') return this.page(this.fixtures.messages.filter(message =>
      (!input.query.direction || message.direction === input.query.direction)
      && (!input.query.phoneNumber || (message.phoneNumber && normalizePhone(message.phoneNumber) === normalizePhone(input.query.phoneNumber)))
      && (!input.query.createdAfter || message.createdAt >= input.query.createdAfter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), input.query);
    if (path.startsWith('/sms/')) return this.result(this.fixtures.messages.find(message => message.id === decodeURIComponent(path.slice(5))));
    return { status: 404, body: { error: { code: 'MOCK_ROUTE_NOT_FOUND', message: 'No fixture for this documented route' } } };
  }
  private result(value: unknown): PingCodeResponse {
    return value === undefined ? { status: 404, body: { error: { code: 'MOCK_NOT_FOUND', message: 'Fixture not found' } } }
      : { status: 200, body: structuredClone(value) };
  }
  private page(values: unknown[], query: Record<string, string>): PingCodeResponse {
    const limit = Number(query.limit ?? 50);
    const offset = query.cursor ? Number(query.cursor.replace(/^mock-/, '')) : 0;
    if (!Number.isInteger(offset) || offset < 0 || (query.cursor && !/^mock-\d+$/.test(query.cursor))) {
      return { status: 400, body: { error: { code: 'MOCK_CURSOR_INVALID', message: 'Unknown fixture cursor' } } };
    }
    const hasMore = offset + limit < values.length;
    return { status: 200, body: structuredClone({ data: values.slice(offset, offset + limit),
      page: { limit, hasMore, ...(hasMore ? { nextCursor: `mock-${offset + limit}` } : {}) } }) };
  }
}
