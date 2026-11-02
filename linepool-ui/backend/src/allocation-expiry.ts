import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { releaseExpired } from './platform-inventory.js';
import { Database } from './database.js';
import { safeErrorDetails } from './error-summary.js';

/** Local service expiry only: never calls a supplier and never enables resale. */
@Injectable()
export class AllocationExpiry implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly db: Database) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;
  async runBatch(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Expiry batch limit must be 1..500');
    return this.db.transaction(async client => {
      const result = await releaseExpired(client, undefined, limit);
      return { released: result.rowCount };
    });
  }
  onApplicationBootstrap() {
    const tick = () => {
      if (this.running) return;
      this.running = this.runBatch().catch(error => console.error('Local allocation expiry failed; next scan will retry', safeErrorDetails(error)))
        .finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
    tick();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
