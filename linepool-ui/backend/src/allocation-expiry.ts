import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Database } from './database.js';

/** Local service expiry only: never calls a supplier and never enables resale. */
@Injectable()
export class AllocationExpiry implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly db: Database) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;
  async runBatch(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Expiry batch limit must be 1..500');
    return this.db.transaction(async client => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM phone_numbers
        WHERE assigned_user_id IS NOT NULL AND expires_at<=now()
        ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
      if (!rows.length) return { released: 0 };
      const ids = rows.map(row => row.id);
      await client.query(`INSERT INTO number_lifecycle_events(allocation_id,reason)
        SELECT id,'EXPIRED' FROM number_allocations WHERE number_id=ANY($1::uuid[]) AND released_at IS NULL
        ON CONFLICT(allocation_id) DO NOTHING`, [ids]);
      const result = await client.query(`UPDATE phone_numbers SET assigned_user_id=NULL,order_id=NULL,
        assigned_at=NULL,expires_at=NULL,sale_enabled=false
        WHERE id=ANY($1::uuid[]) AND assigned_user_id IS NOT NULL AND expires_at<=now()`, [ids]);
      return { released: result.rowCount };
    });
  }
  onApplicationBootstrap() {
    const tick = () => {
      if (this.running) return;
      this.running = this.runBatch().catch(() => console.error('Local allocation expiry failed; next scan will retry'))
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
