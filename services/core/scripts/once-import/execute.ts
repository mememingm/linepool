import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { applyPlan, assertReviewedReport, completedReplay } from './apply.js';
import type { Options } from './arguments.js';
import { clean, identityFromUrl, sameDatabase, type Client, type Identity, type Report } from './model.js';
import { createReport, digest } from './preflight.js';
import { assertReadOnly, assertSourceIdentity, parseDecisions, readSource, readTarget, targetTables } from './snapshot.js';

export async function executeImport(options: Exclude<Options, { command: 'help' }>): Promise<void> {
  if (process.env.SITE_ID !== 'once') throw new Error('Database commands require explicitly configured SITE_ID=once');
  const sourceUrl = process.env.ONCE_IMPORT_SOURCE_URL, targetUrl = process.env.ONCE_IMPORT_TARGET_URL;
  if (!sourceUrl || !targetUrl) throw new Error('Set ONCE_IMPORT_SOURCE_URL and ONCE_IMPORT_TARGET_URL explicitly; DATABASE_URL is never used');
  const sourceIdentity = identityFromUrl(sourceUrl), targetIdentity = identityFromUrl(targetUrl);
  if (sameDatabase(sourceIdentity, targetIdentity)) throw new Error('Source and target must be separate databases, regardless of role or loopback hostname');
  if (options.command === 'apply' && options.confirmTarget !== targetIdentity.database) throw new Error('--confirm-target must exactly equal the independent ONCE target database name');
  const decisions = options.decisions ? parseDecisions(JSON.parse(await readFile(options.decisions, 'utf8'))) : null;
  const reviewed = options.command === 'apply' ? assertReviewedReport(JSON.parse(await readFile(options.report, 'utf8')), decisions!) : null;
  if (decisions && (digest(decisions.source) !== digest(sourceIdentity) || digest(decisions.target) !== digest(targetIdentity))) throw new Error('Decisions must name the exact configured source and target identities');
  const source = new pg.Client({ connectionString: sourceUrl, application_name: 'once-import-source', options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 10000 });
  const target = new pg.Client({ connectionString: targetUrl, application_name: options.command === 'preflight' ? 'once-import-preflight' : 'once-import-apply', options: options.command === 'preflight' ? '-c default_transaction_read_only=on' : undefined, connectionTimeoutMillis: 10000 });
  let sourceOpen = false, targetOpen = false, sourceTransaction = false, targetTransaction = false;
  try {
    await source.connect(); sourceOpen = true;
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); sourceTransaction = true;
    await assertReadOnly(source); await assertSourceIdentity(source, sourceIdentity);
    await target.connect(); targetOpen = true;
    await target.query(options.command === 'preflight' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE'); targetTransaction = true;
    if (options.command === 'preflight') await assertReadOnly(target);
    else {
      await target.query(`SET LOCAL lock_timeout='10s'`);
      // Target writers must already be stopped. Locks enforce that assumption during this transaction.
      await target.query(`LOCK TABLE ${targetTables.map(table => `public."${table}"`).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const sourceServer = await serverIdentity(source, sourceIdentity), targetServer = await serverIdentity(target, targetIdentity);
    if (sameDatabase(sourceServer, targetServer)) throw new Error('Connected source and target resolve to the same PostgreSQL database');
    const sourceFacts = await readSource(source), targetFacts = await readTarget(target, targetIdentity);
    if (targetFacts.siteId !== 'once') throw new Error('Target durable database setting app.site_id must equal once; provisioning is a separate authorized action');
    if (reviewed && (reviewed.sourceDigest !== digest(sourceFacts) || reviewed.decisionsDigest !== digest(decisions))) throw new Error('Source or decisions changed since the reviewed preflight');
    if (options.command === 'apply' && completedReplay(targetFacts, decisions!, digest(sourceFacts))) {
      await target.query('ROLLBACK'); targetTransaction = false;
      await source.query('ROLLBACK'); sourceTransaction = false;
      process.stdout.write(JSON.stringify({ status: 'REPLAYED', batchId: decisions!.batchId, writes: 0, creditedPoints: 0 }) + '\n');
      return;
    }
    const report = await createReport(sourceFacts, targetFacts, sourceIdentity, decisions, target);
    if (options.command === 'preflight') {
      await target.query('ROLLBACK'); targetTransaction = false;
      await source.query('ROLLBACK'); sourceTransaction = false;
      // The report includes only allowlisted/sanitized source facts; no connection URL or usable hash is written.
      await writeFile(options.report, JSON.stringify(clean(report), null, 2) + '\n', { mode: 0o600 });
      if (options.template) await writeFile(options.template, JSON.stringify(report.template, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      process.stdout.write(JSON.stringify({ status: report.plan.blockers.length ? 'BLOCKED' : 'READY', blockers: report.plan.blockers.length, sourceCounts: report.counts, plannedWrites: report.plan.writes.length, sourceDigest: report.sourceDigest, report: options.report }) + '\n');
      if (report.plan.blockers.length) process.exitCode = 2;
      return;
    }
    if (report.plan.blockers.length) throw new Error(`Fresh preflight has ${report.plan.blockers.length} blocker(s); run preflight for the reviewable report`);
    if (reviewed!.targetDigest !== report.targetDigest) throw new Error('Target changed since the reviewed preflight; generate and review a fresh report');
    await applyPlan(target, report, decisions!);
    await target.query('COMMIT'); targetTransaction = false;
    await source.query('ROLLBACK'); sourceTransaction = false;
    process.stdout.write(JSON.stringify({ status: 'COMPLETED', batchId: decisions!.batchId, facts: report.plan.facts.length, writes: report.plan.writes.length, walletBalances: report.plan.balances, sourceDigest: report.sourceDigest }) + '\n');
  } finally {
    // If COMMIT's outcome is unknown, rerunning this exact batch reads the registry; no blind credit retry exists.
    if (targetTransaction) await target.query('ROLLBACK').catch(() => undefined);
    if (sourceTransaction) await source.query('ROLLBACK').catch(() => undefined);
    if (targetOpen) await target.end();
    if (sourceOpen) await source.end();
  }
}

async function serverIdentity(client: Client, expected: Identity): Promise<Identity> {
  const { rows } = await client.query<{ database: string; role: string; port: number }>('SELECT current_database() AS database,current_user AS role,inet_server_port() AS port');
  const actual = rows[0];
  if (actual.database !== expected.database || actual.role !== expected.user || !actual.port) throw new Error('Connected server identity differs from the explicit local database/role');
  return { ...expected, port: actual.port };
}
