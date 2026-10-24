import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Database } from './database.js';

/** Expires local agent holdings only; it never calls PingCode or performs a purchase. */
@Injectable()
export class AgentInventoryExpiry implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly db: Database) {}
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  async runBatch(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Agent holding expiry batch limit must be 1..500');
    return this.db.transaction(async client => {
      const { rows } = await client.query<{ holding_id: string; stock_id: string }>(
        `SELECT h.id AS holding_id,s.id AS stock_id
         FROM number_holdings h
         JOIN agent_number_stock s ON s.holding_id=h.id
         WHERE h.status='ACTIVE' AND h.expires_at IS NOT NULL AND h.expires_at <= now()
         ORDER BY h.expires_at,h.id
         FOR UPDATE OF h,s SKIP LOCKED
         LIMIT $1`, [limit]);
      for (const row of rows) {
        await client.query("UPDATE service_entitlements SET status='EXPIRED' WHERE holding_id=$1 AND status='ACTIVE'", [row.holding_id]);
        await client.query("UPDATE number_holdings SET status='RETIRED',transferred_at=COALESCE(transferred_at,now()) WHERE id=$1", [row.holding_id]);
        await client.query("UPDATE agent_number_stock SET status='AVAILABLE',holding_id=NULL WHERE id=$1", [row.stock_id]);
        await client.query(
          `INSERT INTO agent_number_stock_events(stock_id,holding_id,action,reason,actor_user_id,metadata)
           VALUES($1,$2,'EXPIRE',$3,(SELECT id FROM users WHERE role='ADMIN' ORDER BY created_at,id LIMIT 1),$4)`,
          [row.stock_id, row.holding_id, 'Agent holding expired', JSON.stringify({ automatic: true })],
        );
      }
      return { released: rows.length };
    });
  }

  onApplicationBootstrap() {
    const tick = () => {
      if (this.running) return;
      this.running = this.runBatch().catch(() => console.error('Agent holding expiry failed; next scan will retry'))
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
