import pg from 'pg';
import { Environment } from '../src/environment.js';

const usage = `Usage (requires the core build; select the site's configuration with --env-file):
  node --env-file=<site env> dist/core/scripts/pc-self-service.js --external-account-id=PC_SUBJECT
    Read-only preview of the site's current self-service connection and the planned switch.
  Repeat with --apply after reviewing the preview.
    In one transaction: retire the current active self-service connection (kept as history, stripped
    of authorization) and provision an UNAUTHORIZED self-service connection for the configured
    provider and the given PC account. An administrator then authorizes it through PinClode.

Only local non-production *_sandbox/*_test databases are accepted. The PC account must not already
belong to any connection or agent identity on this site. PINGCODE_EXTERNAL_ACCOUNT_ID must be set to
the same account before the API can start that authorization.`;

class CommandError extends Error {}
type Row = { id: string; provider: string; external_account_id: string; auth_status: string; numbers: number };

function parse(args: string[]) {
  let apply = false; let account = '';
  for (const arg of args) {
    if (arg === '--apply' && !apply) { apply = true; continue; }
    const match = /^--external-account-id=([A-Za-z0-9._:-]{1,200})$/.exec(arg);
    if (match && !account) { account = match[1]!; continue; }
    throw new CommandError('Invalid or duplicate argument; use --help');
  }
  if (!account) throw new CommandError('--external-account-id is required');
  return { apply, account };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) { console.log(usage); return; }
  const input = parse(args);
  const environment = new Environment();
  const url = new URL(environment.values.DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (environment.values.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/_(sandbox|test)$/.test(database)) throw new CommandError('Only a local *_sandbox or *_test database is accepted');
  const site = environment.siteId;
  const provider = environment.pcProvider;
  const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const { rows: [marker] } = await client.query<{ site: string | null }>("SELECT current_setting('app.site_id', true) AS site");
    if (marker?.site !== site) throw new CommandError('Database app.site_id does not match SITE_ID');
    await client.query(input.apply ? 'BEGIN' : 'BEGIN READ ONLY');
    if (input.apply) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`pc-self-service:${site}`]);
    const { rows: [current] } = await client.query<Row>(`SELECT a.id,a.provider,a.external_account_id,a.auth_status,
        (SELECT count(*)::int FROM phone_numbers n WHERE n.upstream_account_id=a.id) AS numbers
      FROM upstream_accounts a WHERE a.storefront_id=$1 AND a.owner_kind='SELF_SERVICE' AND NOT a.historical_only
      ${input.apply ? 'FOR UPDATE OF a' : ''}`, [site]);
    console.log(`Database: ${url.hostname}:${url.port || '5432'}/${database}, site=${site}, provider=${provider}`);
    console.log(current ? `Current self-service: ${current.id} ${current.provider}/${current.external_account_id} auth=${current.auth_status} numbers=${current.numbers}`
      : 'Current self-service: none');
    if (current && current.provider === provider && current.external_account_id === input.account) {
      console.log('Already configured; no changes.'); await client.query('ROLLBACK'); return;
    }
    const { rows: taken } = await client.query<{ id: string; owner_kind: string }>(
      'SELECT id,owner_kind FROM upstream_accounts WHERE provider=$1 AND external_account_id=$2', [provider, input.account]);
    if (taken.length) throw new CommandError(`PC account ${input.account} already belongs to connection ${taken[0]!.id} (${taken[0]!.owner_kind})`);
    const { rowCount: identity } = await client.query('SELECT 1 FROM pc_agent_identities WHERE site_id=$1 AND subject=$2 AND application_id=$3',
      [site, input.account, environment.values.PC_APPLICATION_ID]);
    if (identity) throw new CommandError(`PC subject ${input.account} is already an agent identity on this site`);
    console.log(`Plan: ${current ? `retire ${current.id} (history and numbers kept), ` : ''}provision ${provider}/${input.account} as UNAUTHORIZED self-service`);
    if (!input.apply) { await client.query('ROLLBACK'); console.log('Preview only; repeat with --apply to make these changes.'); return; }
    if (current) {
      await client.query(`UPDATE upstream_accounts SET historical_only=true,status='INACTIVE',auth_status='UNAUTHORIZED',
        access_token=NULL,refresh_token=NULL,access_expires_at=NULL,refresh_expires_at=NULL,capabilities='{}',enabled_capabilities='{}',
        refresh_claim_id=NULL,refresh_claim_deadline=NULL,poll_claim_id=NULL,poll_claim_deadline=NULL,next_poll_at=NULL,problem=NULL
        WHERE id=$1`, [current.id]);
    }
    const { rows: [created] } = await client.query<{ id: string }>(`INSERT INTO upstream_accounts(id,provider,external_account_id,storefront_id,owner_kind,status,auth_status)
      VALUES(gen_random_uuid(),$1,$2,$3,'SELF_SERVICE','ACTIVE','UNAUTHORIZED') RETURNING id`, [provider, input.account, site]);
    await client.query('COMMIT');
    console.log(`Applied: new self-service connection ${created!.id}${current ? `; retired ${current.id}` : ''}.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}

main().catch(error => {
  console.error(error instanceof CommandError ? error.message : `pc-self-service failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
