import { Injectable,type OnModuleInit,type OnModuleDestroy } from '@nestjs/common';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { MockFulfillment } from '../mock-fulfillment.js';
import { lockPointAccount } from '../points-wallet.js';
@Injectable()
export class OnceMaintenance implements OnModuleInit,OnModuleDestroy {
  private timer?:NodeJS.Timeout;
  private running=false;
  constructor(private readonly db:Database,private readonly environment:Environment,private readonly fulfillment:MockFulfillment){}
  onModuleInit(){if(this.environment.isWorker&&this.environment.siteId==='once')this.timer=setInterval(()=>{void this.recover().catch(()=>console.error('ONCE maintenance failed'));},10000);}
  onModuleDestroy(){clearInterval(this.timer);}
  async recover(){
    if(!this.environment.isWorker||this.environment.siteId!=='once'||this.running)return;this.running=true;
    try{
      const {rows:pending}=await this.db.query<{id:string;user_id:string}>(`SELECT o.id,o.user_id FROM orders o JOIN mock_fulfillment_operations op ON op.order_id=o.id JOIN phone_numbers n ON n.id=o.target_number_id JOIN upstream_accounts u ON u.id=n.upstream_account_id
        WHERE o.product_type='NUMBER_LEASE' AND o.sales_storefront_id='once' AND u.storefront_id='once' AND u.provider=$2 AND u.external_account_id=$1 AND u.owner_kind='SELF_SERVICE' AND u.agent_id IS NULL AND NOT u.historical_only
        AND (op.status IN ('PENDING','UNCERTAIN') OR(op.status='PROCESSING' AND op.claim_until<=now())) ORDER BY op.updated_at,o.id LIMIT 100`,[this.environment.selfServiceExternalAccountId,this.environment.pcProvider]);
      for(const order of pending){try{await this.fulfillment.runWhole(order.user_id,order.id);}catch{console.error('ONCE order recovery requires review');}}
      const {rows}=await this.db.query<{id:string;user_id:string;number_id:string}>(`SELECT l.id,l.user_id,l.number_id FROM leases l JOIN phone_numbers n ON n.id=l.number_id JOIN upstream_accounts u ON u.id=n.upstream_account_id LEFT JOIN once_settings s ON s.storefront_id='once' WHERE u.storefront_id='once' AND u.provider=$2 AND u.external_account_id=$1 AND u.owner_kind='SELF_SERVICE' AND u.agent_id IS NULL AND NOT u.historical_only AND (
        (l.status='ACTIVE' AND EXISTS(SELECT 1 FROM number_allocations a WHERE a.lease_id=l.id AND a.released_at IS NULL AND a.expires_at<=now())) OR
        (l.status='EXPIRED_HELD' AND s.cooldown_days IS NOT NULL AND NOT n.manual_hold AND l.held_at+s.cooldown_days*interval '24 hours'<=now()
          AND NOT EXISTS(SELECT 1 FROM whole_number_reservations w WHERE w.number_id=n.id)
          AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.target_number_id=n.id AND o.fulfillment_status='PROCESSING'))
        ) ORDER BY l.id LIMIT 1000`,[this.environment.selfServiceExternalAccountId,this.environment.pcProvider]);
      for(const row of rows)await this.expire(row);
    }finally{this.running=false;}
  }
  private async expire(row:{id:string;user_id:string;number_id:string}){return this.db.transaction(async client=>{
    await lockPointAccount(client,row.user_id,true);
    const pending=await client.query<{id:string}>("SELECT id FROM orders WHERE target_number_id=$1 AND fulfillment_status='PROCESSING' ORDER BY id FOR UPDATE",[row.number_id]);
    if(pending.rows.length)await client.query('SELECT order_id FROM mock_fulfillment_operations WHERE order_id=ANY($1::uuid[]) ORDER BY order_id FOR UPDATE',[pending.rows.map(o=>o.id)]);
    const {rows:[n]}=await client.query<{manual_hold:boolean}>('SELECT manual_hold FROM phone_numbers WHERE id=$1 FOR UPDATE',[row.number_id]);
    const {rows:[lease]}=await client.query<{status:string}>('SELECT status FROM leases WHERE id=$1 FOR UPDATE',[row.id]);
    if(!lease||!['ACTIVE','EXPIRED_HELD'].includes(lease.status))return;
    await client.query('SELECT id FROM number_allocations WHERE lease_id=$1 ORDER BY id FOR UPDATE',[row.id]);
    await client.query("UPDATE number_allocations SET released_at=expires_at,release_reason='EXPIRED' WHERE lease_id=$1 AND released_at IS NULL AND expires_at<=now()",[row.id]);
    const {rows:[period]}=await client.query<{ends:Date|null;future:boolean}>(`SELECT max(LEAST(expires_at,COALESCE(released_at,expires_at))) AS ends,COALESCE(bool_or(released_at IS NULL AND expires_at>now()),false) AS future FROM number_allocations WHERE lease_id=$1`,[row.id]);
    if(period!.future)return;
    if(lease.status==='ACTIVE')await client.query("UPDATE leases SET status='EXPIRED_HELD',held_at=$2,updated_at=now() WHERE id=$1",[row.id,period!.ends]);
    const {rows:[setting]}=await client.query<{cooldown_days:number|null}>("SELECT cooldown_days FROM once_settings WHERE storefront_id='once'");
    if(setting?.cooldown_days===null||setting?.cooldown_days===undefined||!period!.ends||n!.manual_hold||pending.rowCount)return;
    if(new Date(period!.ends).getTime()+setting.cooldown_days*86400000>Date.now())return;
    if((await client.query('SELECT number_id FROM whole_number_reservations WHERE number_id=$1 FOR UPDATE',[row.number_id])).rowCount)return;
    await client.query("UPDATE leases SET status='RELEASED',released_at=now(),updated_at=now() WHERE id=$1 AND status='EXPIRED_HELD'",[row.id]);
  });}
}
