import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { Environment } from '../src/environment.js';

const usage = `Usage from the repository root (requires the existing core build):
  npm run admin:grant -- --email=existing-local-account@example.com
    Bootstrap the first administrator from an existing ACTIVE LOCAL account only.

  npm run admin:grant -- --pc --database=127.0.0.1:5433/linepool_v42_sandbox --site=linepool --application=linepool --issuer=http://120.55.75.51/pingcode --subject=EXACT_TRUSTED_SUBJECT
    Read-only preview of one existing trusted PC identity and its local target UUID.
  Repeat the same PC command with --target=REVIEWED_USER_UUID --apply only after reviewing and approving that target.
    Grant ADMIN to that exact ACTIVE PINCLODE user, revoke its sessions and audit the change.
    Existing administrators do not prevent this explicit PC grant; repeated grants make no changes.

CORE_ENV_FILE selects the same configuration file as run-runtime (relative to services/core or absolute).
It defaults to .env; select the intended real LP configuration explicitly before preview/apply.
PC mode requires a local non-production database, SITE_ID=linepool, PC_MODE=real,
PC_APPLICATION_ID=linepool and an exact configured issuer. --database is host:port/database,
without credentials; it must exactly match DATABASE_URL. No identities or connections are created.
PC usernames, email addresses and upstream role fields never confer LP administrator access.
--help / -h exits before loading configuration, constructing Environment or connecting to a database.`;

class CommandError extends Error {}
type Input = { mode: 'LOCAL'; email: string } | {
  mode: 'PC'; database: string; site: string; application: string; issuer: string; subject: string;
  target?: string; apply: boolean;
};
type PcTarget = {
  identity_id: string; user_id: string; agent_id: string; connection_id: string; external_account_id: string;
  role: 'USER' | 'ADMIN'; account_status: string; agent_status: string; connection_status: string; auth_status: string;
};

function parseInput(args: string[]): Input {
  const values: Record<string, string> = {};
  let pc = false, apply = false;
  for (const arg of args) {
    if (arg === '--pc' && !pc) { pc = true; continue; }
    if (arg === '--apply' && !apply) { apply = true; continue; }
    const match = /^--(email|database|site|application|issuer|subject|target)=(.*)$/s.exec(arg);
    if (!match || Object.hasOwn(values, match[1]!) || !match[2] || /[\r\n\0]/.test(match[2])) {
      throw new CommandError('Invalid or duplicate argument; use --help for the exact command syntax');
    }
    values[match[1]!] = match[2];
  }
  if (!pc) {
    if (apply || Object.keys(values).length !== 1 || !values.email) throw new CommandError('Use either --email for LOCAL bootstrap or --pc with an exact identity scope; see --help');
    const email = values.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CommandError('An existing LOCAL account email is required');
    return { mode: 'LOCAL', email };
  }
  if (values.email || ['database', 'site', 'application', 'issuer', 'subject'].some(key => !values[key])) {
    throw new CommandError('PC mode requires --database, --site, --application, --issuer and --subject; --email cannot select a PC identity');
  }
  if (Object.values(values).some(value => value !== value.trim()) || values.application!.length > 200
    || values.issuer!.length > 500 || values.subject!.length > 200) throw new CommandError('PC scope must use the exact unmodified trusted identifiers');
  if (values.target && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(values.target)) {
    throw new CommandError('--target must be the reviewed local user UUID from the preview');
  }
  if (apply && !values.target) throw new CommandError('Review the PC preview first, then supply --target=REVIEWED_USER_UUID --apply');
  return { mode: 'PC', database: values.database!, site: values.site!, application: values.application!,
    issuer: values.issuer!, subject: values.subject!, target: values.target?.toLowerCase(), apply };
}

function databaseTarget(environment: Environment, input: Input) {
  const database = new URL(environment.values.DATABASE_URL);
  const target = { host: database.hostname, port: Number(database.port || '5432'),
    database: decodeURIComponent(database.pathname.slice(1)), databaseRole: decodeURIComponent(database.username) };
  if (!target.database || !target.databaseRole) throw new CommandError('DATABASE_URL must explicitly select a database and database role');
  const address = `${target.host}:${target.port}/${target.database}`;
  if (input.mode === 'PC') {
    if (environment.values.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.host)
      || database.search || database.hash) throw new CommandError('PC grants require a local non-production DATABASE_URL without query parameters or a fragment');
    if (input.database !== address) throw new CommandError('--database must exactly match the configured local host:port/database; no connection was opened');
    if (input.site !== 'linepool' || environment.siteId !== input.site || input.application !== 'linepool'
      || environment.values.PC_APPLICATION_ID !== input.application || environment.values.PC_ISSUER !== input.issuer
      || environment.values.PC_MODE !== 'real') throw new CommandError('PC scope must match the configured real linepool site, linepool application and exact issuer');
  }
  return { ...target, address };
}

export async function main(args: string[] = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(usage); return; }
  const input = parseInput(args);
  const coreDirectory = fileURLToPath(new URL('../../../', import.meta.url));
  try { loadEnvFile(resolve(coreDirectory, process.env.CORE_ENV_FILE ?? '.env')); }
  catch { throw new CommandError('Cannot load the selected core environment file; check CORE_ENV_FILE without printing credentials'); }
  let environment: Environment;
  try { environment = new Environment(); }
  catch { throw new CommandError('Invalid core environment configuration; review the selected environment file without printing credentials'); }
  const target = databaseTarget(environment, input);
  const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let transaction = false;
  try {
    await client.connect();
    await client.query(input.mode === 'PC' && !input.apply ? 'BEGIN READ ONLY' : 'BEGIN');
    transaction = true;
    const { rows: [actual] } = await client.query<{ database: string; database_role: string; port: number; site_id: string | null }>(
      "SELECT current_database() AS database,current_user AS database_role,inet_server_port() AS port,current_setting('app.site_id',true) AS site_id");
    if (!actual || actual.database !== target.database || actual.database_role !== target.databaseRole
      || actual.port !== target.port || actual.site_id !== environment.siteId) {
      throw new CommandError('Connected database, role, port or app.site_id differs from the configured target; no grant was made');
    }
    if (input.mode === 'PC') {
      const scopeValues = [input.site, input.application, input.issuer, input.subject];
      if (input.apply) {
        await client.query('SELECT pg_advisory_xact_lock(734102611)');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [scopeValues.join(':')]);
      }
      const { rows: [identity] } = await client.query<PcTarget>(`SELECT i.id AS identity_id,i.user_id,i.agent_id,c.id AS connection_id,
        c.external_account_id,u.role,u.account_status,a.status AS agent_status,c.status AS connection_status,c.auth_status
        FROM pc_agent_identities i JOIN users u ON u.id=i.user_id
        JOIN agents a ON a.id=i.agent_id AND a.user_id=u.id
        JOIN upstream_accounts c ON c.agent_id=a.id JOIN storefronts s ON s.id=i.site_id
        WHERE i.site_id=$1 AND i.application_id=$2 AND i.issuer=$3 AND i.subject=$4
          AND u.auth_kind='PINCLODE' AND u.account_status='ACTIVE' AND u.role IN ('USER','ADMIN') AND a.status='ACTIVE'
          AND s.product='SMS_CODE' AND c.storefront_id=i.site_id AND c.application_id=i.application_id
          AND c.issuer=i.issuer AND c.subject=i.subject AND c.provider=$5 AND c.owner_kind='AGENT'
          AND NOT c.historical_only AND c.status='ACTIVE' AND c.auth_status='ACTIVE'
        ${input.apply ? 'FOR UPDATE OF i,u,a,c FOR SHARE OF s' : ''}`, [...scopeValues, environment.pcProvider]);
      if (!identity) throw new CommandError('An existing ACTIVE trusted PINCLODE user, agent and matching real LP connection are required; no identity was created or rebound');
      if (input.target && identity.user_id !== input.target) throw new CommandError('The trusted identity does not match the reviewed --target user UUID; no grant was made');
      const scope = { database: target.address, databaseRole: target.databaseRole, site: input.site,
        application: input.application, issuer: input.issuer, subject: input.subject, provider: environment.pcProvider };
      const reviewedTarget = { identityId: identity.identity_id, userId: identity.user_id, agentId: identity.agent_id,
        connectionId: identity.connection_id, externalAccountId: identity.external_account_id, authKind: 'PINCLODE',
        accountStatus: identity.account_status, agentStatus: identity.agent_status,
        connectionStatus: identity.connection_status, authorizationStatus: identity.auth_status };
      let sessionsRevoked = 0;
      if (input.apply && identity.role !== 'ADMIN') {
        await client.query("UPDATE users SET role='ADMIN' WHERE id=$1", [identity.user_id]);
        const revoked = await client.query('DELETE FROM sessions WHERE user_id=$1', [identity.user_id]);
        sessionsRevoked = revoked.rowCount ?? 0;
        // admin_audit requires a user actor; the metadata explicitly identifies the local database operator.
        const audit = { scope, target: reviewedTarget, authority: { kind: 'LOCAL_DATABASE_OPERATOR',
          databaseRole: target.databaseRole, authenticatedLpActor: null, actorIdReferencesTarget: true } };
        await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
          VALUES($1::uuid,'ADMIN_PC_GRANT',$1::text,'Explicit local operator grant to the reviewed trusted PC identity',$2::jsonb,$3::jsonb)`,
        [identity.user_id, JSON.stringify({ ...audit, role: identity.role }), JSON.stringify({ ...audit, role: 'ADMIN', sessionsRevoked })]);
      }
      await client.query(input.apply ? 'COMMIT' : 'ROLLBACK');
      transaction = false;
      console.log(JSON.stringify({ mode: input.apply ? 'PC_APPLY' : 'PC_PREVIEW', scope, target: reviewedTarget,
        beforeRole: identity.role, afterRole: 'ADMIN', changed: input.apply && identity.role !== 'ADMIN',
        wouldChange: identity.role !== 'ADMIN', sessionsRevoked,
        nextAction: !input.apply ? 'Review and approve this scope and target, then repeat with --target=<userId> --apply'
          : identity.role === 'ADMIN' ? 'Already ADMIN; no role, session or audit changes were made' : 'Sign in again through the same trusted PinClode identity' }, null, 2));
      return;
    }
    await client.query('SELECT pg_advisory_xact_lock(734102611)');
    const { rows: [user] } = await client.query<{ id: string; role: 'USER' | 'ADMIN'; account_status: string }>(
      "SELECT id,role,account_status FROM users WHERE email=$1 AND auth_kind='LOCAL' FOR UPDATE", [input.email]);
    if (!user || user.account_status !== 'ACTIVE') throw new CommandError('An existing ACTIVE LOCAL account is required; --email never grants a PC identity');
    let granted = false;
    if (user.role !== 'ADMIN') {
      const { rowCount } = await client.query("SELECT id FROM users WHERE role='ADMIN'");
      if (rowCount) throw new CommandError('An administrator already exists; LOCAL bootstrap cannot grant additional administrators');
      await client.query("UPDATE users SET role='ADMIN' WHERE id=$1", [user.id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      const scope = { database: target.address, databaseRole: target.databaseRole, site: environment.siteId, authKind: 'LOCAL' };
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1::uuid,'ADMIN_BOOTSTRAP',$1::text,'Explicit local operator bootstrap',$2::jsonb,$3::jsonb)`,
      [user.id, JSON.stringify({ scope, role: user.role }), JSON.stringify({ scope, role: 'ADMIN' })]);
      granted = true;
    }
    await client.query('COMMIT');
    transaction = false;
    console.log(granted ? 'Platform administrator granted; sign in again with the existing LOCAL account password'
      : 'LOCAL account already has platform administrator access');
  } catch (failure) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined);
    throw failure;
  } finally { await client.end().catch(() => undefined); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(failure => {
    console.error(failure instanceof CommandError ? failure.message
      : 'Administrator command failed; inspect the selected local database and configuration without printing credentials');
    process.exitCode = 1;
  });
}
