import { help, parseArguments } from './once-import/arguments.js';
import { executeImport } from './once-import/execute.js';

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'help') process.stdout.write(help);
  else {
    // Client construction and application/environment work exist only inside this explicit command path.
    await executeImport(options);
  }
} catch (error) {
  const failure = error as { message?: string; code?: string; constraint?: string; table?: string };
  // Never print driver objects, connection configuration, SQL parameters, source credentials or PG DETAIL.
  const message = error instanceof Error ? error.message : 'Import failed';
  process.stderr.write(JSON.stringify({ error: message, ...(failure.code ? { code: failure.code } : {}), ...(failure.constraint ? { constraint: failure.constraint } : {}), ...(failure.table ? { table: failure.table } : {}) }) + '\n');
  process.exitCode = 1;
}
