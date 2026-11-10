import { Database } from './database.js';
import { Environment } from './environment.js';

/** Verify the preconfigured logical database before any Nest worker lifecycle can run. */
export async function prepareRuntimeDatabase(environment: Environment): Promise<Database> {
  const database = new Database(environment);
  try {
    const { rows: [identity] } = await database.query<{ site_id: string | null }>(
      "SELECT current_setting('app.site_id', true) AS site_id");
    if (!identity?.site_id) {
      throw new Error(`Database site marker app.site_id is missing. Configure the intended ${environment.siteId} database during authorized database setup before starting API or worker; runtime never initializes this marker.`);
    }
    if (identity.site_id !== environment.siteId) {
      throw new Error(`Database site marker mismatch: expected ${environment.siteId}, received ${identity.site_id}. Select this site's DATABASE_URL and database role before starting API or worker.`);
    }
    return database;
  } catch (error) {
    await database.onModuleDestroy();
    throw error;
  }
}
