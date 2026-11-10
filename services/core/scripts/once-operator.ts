import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { prepareRuntimeDatabase } from '../src/runtime-database.js';
import { Environment } from '../src/environment.js';
import { ApiFailure } from '../src/http.js';
import { Workspace } from '../src/workspace.js';
import { Ordering } from '../src/ordering.js';
import { LinePoolReceiving } from '../src/linepool-receiving.js';
import { MockFulfillment } from '../src/mock-fulfillment.js';
import { ProviderSyncService } from '../src/provider-sync.js';
import { MockWholeNumberProvider } from '../src/providers/mock-whole-number-provider.js';
import { MockReceivingProvider } from '../src/providers/mock-receiving-provider.js';
import { OnceAdminOperations, adminId, adminKey, adminReason, parse } from '../src/once/admin-operations.js';
import { OnceIntegration } from '../src/once/integration.js';
import { OnceInventory } from '../src/once/inventory.js';
import { OnceLeasePlans } from '../src/once/lease-plans.js';
import { OnceLeaseOrdering } from '../src/once/lease-ordering.js';
import { OncePurchaseIntents } from '../src/once/purchase-intents.js';
import { OnceLeases } from '../src/once/leases.js';
import { OnceOperator } from '../src/once/operator.js';

const usage = `Usage: once:operator check|sync|assign --actor-id=UUID --idempotency-key=UUID --reason="operation reason"
  sync:   optional --mode=FULL|INCREMENTAL|MANUAL (queues work for the worker)
  assign: --file=assignment.json with {numberId,userId,term,amountMinor?:0,note?}
Existing active administrator access is required. Assign grants local zero-cost service from configured Mock inventory.
Administrator bootstrap remains the existing admin:grant command. No live PC provisioning is performed.`;
const options = z.strictObject({
  'actor-id': adminId, 'idempotency-key': adminKey, reason: adminReason,
  mode: z.enum(['FULL', 'INCREMENTAL', 'MANUAL']).optional(), file: z.string().trim().min(1).optional(),
});

export async function main(args: string[] = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && ['--help', '-h', 'help'].includes(args[0]!)) {
    console.log(usage);
    return;
  }
  const [command, ...flags] = args;
  if (!['check', 'sync', 'assign'].includes(command!)) throw new Error(usage);
  const values: Record<string, string> = {};
  for (const flag of flags) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(flag);
    if (!match || Object.hasOwn(values, match[1]!)) throw new Error(usage);
    values[match[1]!] = match[2]!;
  }
  const input = parse(options, values);
  if (command !== 'sync' && input.mode || command !== 'assign' && input.file || command === 'assign' && !input.file) {
    throw new Error(usage);
  }
  let assignment: unknown;
  if (input.file) {
    try { assignment = JSON.parse(await readFile(input.file, 'utf8')); }
    catch { throw new Error('Assignment file must be readable JSON'); }
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) throw new Error('Assignment file must contain one JSON object');
  }

  // Construction is explicit, with no app/worker module bootstrap or import-time database access.
  const environment = new Environment();
  const target=new URL(environment.values.DATABASE_URL);
  if(environment.siteId!=='once'||environment.values.NODE_ENV==='production'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)) {
    throw new ApiFailure(403,'LOCAL_ONCE_OPERATOR_REQUIRED','Operator commands require a local non-production ONCE database');
  }
  const db = await prepareRuntimeDatabase(environment);
  try {
    const operations = new OnceAdminOperations(db, environment);
    const integration = new OnceIntegration(db, operations, new ProviderSyncService(db, environment));
    const inventory = new OnceInventory(db, environment), plans = new OnceLeasePlans(db);
    const whole = new MockWholeNumberProvider(db, environment, inventory);
    const intents = new OncePurchaseIntents(db, inventory, environment);
    const leaseOrdering = new OnceLeaseOrdering(db, environment, inventory, intents);
    const ordering = new Ordering(db, new Workspace(db, environment), new MockReceivingProvider(environment), environment, new LinePoolReceiving(db, environment), leaseOrdering);
    const fulfillment = new MockFulfillment(db, whole);
    const leases = new OnceLeases(db, environment, ordering, fulfillment, plans, inventory, whole);
    const operator = new OnceOperator(operations, integration, leases);
    const actor = input['actor-id'], key = input['idempotency-key'];
    const result = command === 'check'
      ? await operator.check(actor, { reason: input.reason }, key)
      : command === 'sync'
        ? await operator.sync(actor, { reason: input.reason, mode: input.mode ?? 'FULL' }, key)
        : await operator.assign(actor, { ...assignment as Record<string, unknown>, reason: input.reason }, key);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.onModuleDestroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    if (error instanceof ApiFailure) {
      const result = error.getResponse() as { error: { code: string; message: string } };
      console.error(`${result.error.code}: ${result.error.message}`);
    } else {
      console.error(error instanceof Error && (error.message === usage || error.message.startsWith('Assignment file'))
        ? error.message : 'Operator command failed; inspect the audited operation and configured local database');
    }
    process.exitCode = 1;
  });
}
