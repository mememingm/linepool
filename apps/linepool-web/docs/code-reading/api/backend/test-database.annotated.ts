/**
 * test-database.ts 中文分区导读副本：测试环境数据库配置校验辅助
 * 原文件：backend/src/test-database.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】校验测试连接、管理员连接及隔离 schema 的名称，并检查测试连接目标。
 * 【为什么这样组织】环境配置在 NODE_ENV=test 时引用，避免测试误连到普通数据库；阅读本文件不会运行测试。
 * 【调用链】Environment 的测试分支 → validateTestDatabase / validateTestSchema；其他辅助函数供测试基础设施使用。
 * 【修改提示】本次仅制作源码副本，不调用这些函数、不连接数据库，也不运行测试。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
/**
 * Variables = 环境变量键值集合。这里只描述结构，执行操作需看后面的函数。
 */
type Variables = Record<string, string | undefined>;
/**
 * localHosts = 允许用于测试数据库的本机主机名集合，包括 IPv4/IPv6 回环地址。
 */
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
/**
 * endpointHost = 把不同回环主机写法归为 loopback，便于检查是否其实连到同一数据库。
 */
const endpointHost = (hostname: string) => localHosts.has(hostname) ? 'loopback' : hostname;

/**
 * localPostgresUrl = 检查测试连接必须显式使用本机 PostgreSQL、非 5432 端口及明确凭据，禁止 URL 参数干扰隔离。
 */
function localPostgresUrl(value: string | undefined): URL {
  let url: URL;
  try { url = new URL(value ?? ''); } catch { throw new Error('Explicit local PostgreSQL test URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !localHosts.has(url.hostname)
    || !Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535
    || url.port === '5432' || url.search || url.hash || !url.username || !url.password) {
    throw new Error('Test database must use explicit local PostgreSQL credentials and a non-5432 port, without URL options');
  }
  return url;
}

/**
 * validateTestDatabase = 检查测试数据库名以 _test 结尾，并确认与业务数据库目标分开；生产环境拒绝此操作。
 */
export function validateTestDatabase(variables: Variables) {
  if (variables.NODE_ENV === 'production') throw new Error('Test database operations are disabled in production');
  const url = localPostgresUrl(variables.TEST_DATABASE_URL);
  const database = url.pathname.slice(1);
  if (!/^[a-z][a-z0-9_]{0,56}_test$/.test(database)) {
    throw new Error('Test database name must be a lowercase identifier ending in _test');
  }
  if (variables.DATABASE_URL) {
    let business: URL;
    try { business = new URL(variables.DATABASE_URL); } catch { throw new Error('Cannot validate separation from business database'); }
    if (business.search || business.hash) throw new Error('Business database URL options make isolation ambiguous');
    let businessPath: string;
    try { businessPath = decodeURIComponent(business.pathname); } catch { throw new Error('Cannot validate separation from business database'); }
    if (businessPath === url.pathname && (business.port || '5432') === url.port
      && endpointHost(business.hostname) === endpointHost(url.hostname)) {
      throw new Error('TEST_DATABASE_URL must not point to the business database');
    }
  }
  return { connectionString: url.href, database, port: Number(url.port), url };
}

/**
 * validateTestAdmin = 检查测试管理员连接指向同一测试服务的 postgres 维护库，并要求显式确认数据库名。
 */
export function validateTestAdmin(variables: Variables, target: ReturnType<typeof validateTestDatabase>) {
  const admin = localPostgresUrl(variables.TEST_DATABASE_ADMIN_URL);
  if (admin.pathname !== '/postgres' || endpointHost(admin.hostname) !== endpointHost(target.url.hostname)
    || admin.port !== target.url.port) {
    throw new Error('Test admin URL must use the postgres maintenance database on the test server');
  }
  if (variables.TEST_DATABASE_CONFIRM !== target.database) {
    throw new Error('TEST_DATABASE_CONFIRM must explicitly match the _test database name');
  }
  return admin.href;
}

/**
 * validateTestSchema = 检查可选的隔离 schema 名称符合 lp_test_ 加固定随机十六进制的格式。
 */
export function validateTestSchema(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^lp_test_[a-f0-9]{32}$/.test(value)) throw new Error('Invalid isolated test schema');
  return value;
}

/**
 * assertTestConnection = 通过传入 query 检查实际数据库名和端口与隔离目标一致；本次阅读不调用此函数。
 */
export async function assertTestConnection(
  query: (sql: string) => Promise<{ rows: { database: string; port: number }[] }>,
  target: ReturnType<typeof validateTestDatabase>,
) {
  const { rows: [identity] } = await query('SELECT current_database() AS database, inet_server_port() AS port');
  if (!identity || identity.database !== target.database || identity.port !== target.port || identity.port === 5432) {
    throw new Error('Connected database does not match the isolated test target');
  }
}
