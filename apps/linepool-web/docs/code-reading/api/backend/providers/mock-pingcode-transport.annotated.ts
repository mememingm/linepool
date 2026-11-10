/**
 * mock-pingcode-transport.ts 中文分区导读副本：模拟 PingCode 请求传输
 * 原文件：backend/src/providers/mock-pingcode-transport.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】用传入的号码和短信集合模拟部分 PingCode 读取接口及分页。
 * 【为什么这样组织】让适配器在没有真实供应商时也能读取预设数据；不把读模拟当作真实购买。
 * 【调用链】PingCodeAdapter → MockPingCodeTransport.request → 预置数组。
 * 【修改提示】模拟分页看 page；不支持的路径或写动作按本文件分支返回，不会调用真实上游。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { normalizePhone, type PingCodeRequest, type PingCodeResponse, type PingCodeTransport } from '../../../../../backend/src/providers/pingcode-adapter.js';

/**
 * MockNumber = 模拟供应商号码数据。这里只描述结构，执行操作需看后面的函数。
 */
type MockNumber = { id: number; phoneNumber?: string; iccid?: string; status: string; expiresAt?: string };
/**
 * MockSms = 模拟供应商短信数据。这里只描述结构，执行操作需看后面的函数。
 */
type MockSms = { id: string; numberId: number; phoneNumber?: string; direction: string; counterparty: string;
  content: string; status: string; occurredAt: string; createdAt: string };
/** Synthetic fixtures shaped only like documented responses. Cursors below are Mock-only tokens. */
/**
 * ==================== 01 模拟 PingCode 请求传输 / MockPingCodeTransport ====================
 * MockPingCodeTransport = 模拟 PingCode 请求传输。用传入的号码和短信集合模拟部分 PingCode 读取接口及分页。
 */
export class MockPingCodeTransport implements PingCodeTransport {
  readonly requests: PingCodeRequest[] = [];
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly fixtures: { numbers: MockNumber[]; messages: MockSms[] } = { numbers: [], messages: [] }) {}
  /**
   * request = 用预置数组模拟 /me、/numbers 和 /sms 读取，记录请求供排查；不存在的路径返回模拟 404，不发网络请求。
   */
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
  /**
   * result = 把找到的模拟数据包装为 200；未找到包装为 404，复制数据避免调用方修改原预置集合。
   */
  private result(value: unknown): PingCodeResponse {
    return value === undefined ? { status: 404, body: { error: { code: 'MOCK_NOT_FOUND', message: 'Fixture not found' } } }
      : { status: 200, body: structuredClone(value) };
  }
  /**
   * page = 模拟游标分页。默认 50 条，mock-数字 是本地偏移游标，不是供应商真实游标协议。
   */
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
