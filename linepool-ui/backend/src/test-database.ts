type Variables = Record<string, string | undefined>;
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const endpointHost = (hostname: string) => localHosts.has(hostname) ? 'loopback' : hostname;

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

export function validateTestSchema(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^lp_test_[a-f0-9]{32}$/.test(value)) throw new Error('Invalid isolated test schema');
  return value;
}

export async function assertTestConnection(
  query: (sql: string) => Promise<{ rows: { database: string; port: number }[] }>,
  target: ReturnType<typeof validateTestDatabase>,
) {
  const { rows: [identity] } = await query('SELECT current_database() AS database, inet_server_port() AS port');
  if (!identity || identity.database !== target.database || identity.port !== target.port || identity.port === 5432) {
    throw new Error('Connected database does not match the isolated test target');
  }
}
