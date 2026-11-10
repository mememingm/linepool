import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { releaseExpired } from './platform-inventory.js';
import { Database } from './database.js';
import { safeErrorDetails } from './error-summary.js';
import { Environment } from './environment.js';
import { ApiFailure } from './http.js';

/** Local service expiry only: never calls a supplier and never enables resale. */
@Injectable()
export class AllocationExpiry implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;
  async runBatch(limit = 100) {
    if (!this.environment.isWorker || this.environment.siteId !== 'linepool' || !this.environment.isModuleEnabled('SMS_CODE')) {
      throw new ApiFailure(409, 'WORKER_REQUIRED', 'Platform service expiry requires the enabled LinePool worker');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Expiry batch limit must be 1..500');
    return this.db.transaction(async client => {
      const result = await releaseExpired(client, undefined, limit);
      return { released: result.rowCount };
    });
  }
  onApplicationBootstrap() {
    if (!this.environment.isWorker || this.environment.siteId !== 'linepool' || !this.environment.isModuleEnabled('SMS_CODE')) return;
    const tick = () => {
      if (this.running) return;
      this.running = this.runBatch().catch(error => console.error('Local allocation expiry failed; next scan will retry', safeErrorDetails(error)))
        .finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 30000);
    tick();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
