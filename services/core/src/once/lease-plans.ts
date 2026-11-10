import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { audit, fail, leaseTerm, requireLeaseAdmin } from './lease-common.js';
export type LeasePlan={id:string;days:number;price_minor:string;points_price:number;currency:string;version:number;label:string;note:string;active:boolean;sort_order:number};
const planInput=z.object({days:leaseTerm,priceMinor:z.number().int().nonnegative().safe(),pointsPrice:z.number().int().positive().max(2147483647),currency:z.string().regex(/^[A-Z]{3}$/),label:z.string().trim().min(1).max(100),note:z.string().max(1000).default(''),active:z.boolean(),sortOrder:z.number().int(),version:z.number().int().positive().optional(),reason:z.string().trim().min(3).max(1000),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional()}).strict();
export function planView(p:LeasePlan){return {id:p.id,days:p.days,price:Number(p.price_minor)/100,priceMinor:Number(p.price_minor),pointsPrice:p.points_price,version:p.version,currency:p.currency,label:p.label,note:p.note,active:p.active,sortOrder:p.sort_order};}
export async function quotedPlan(client:Pick<PoolClient,'query'>,days:number,version?:number,active=true,lock=true){
  const {rows:[p]}=await client.query<LeasePlan>(`SELECT * FROM lease_plans WHERE storefront_id='once' AND days=$1 ${active?'AND active':''} ${lock?'FOR SHARE':''}`,[days]);
  if(!p)fail('PLAN_UNAVAILABLE','Plan is unavailable');
  if(version!==undefined&&version!==p.version)fail('QUOTE_CHANGED','Plan price changed; request a current quote');
  return p;
}
@Injectable()
export class OnceLeasePlans {
  constructor(private readonly db:Database){}
  async list(includeInactive=false){const {rows}=await this.db.query<LeasePlan>(`SELECT * FROM lease_plans WHERE storefront_id='once' AND ($1 OR active) ORDER BY sort_order,days,id`,[includeInactive]);return rows.map(planView);}
  async save(actorId:string,idOrNull:string|null,input:unknown){
    const value=planInput.parse(input);
    return this.db.transaction(async client=>{
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actorId]);
      await requireLeaseAdmin(client,actorId);
      const payload={action:'PLAN_SAVE',target:idOrNull,input:value};
      if(value.idempotencyKey){const {rows:[prior]}=await client.query("SELECT result,request_payload=$4::jsonb AS same FROM once_admin_idempotency WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3",[actorId,'PLAN_SAVE',value.idempotencyKey,JSON.stringify(payload)]);if(prior){if(!prior.same)fail('IDEMPOTENCY_CONFLICT','Plan request changed');return prior.result;}}
      await client.query("SELECT id FROM storefronts WHERE id='once' FOR UPDATE");
      if(!idOrNull&&(await client.query("SELECT 1 FROM lease_plans WHERE storefront_id='once' AND days=$1",[value.days])).rowCount)fail('PLAN_EXISTS','A self-service plan with this duration already exists');
      const {rows:[before]}=idOrNull?await client.query<LeasePlan>("SELECT * FROM lease_plans WHERE id=$1 AND storefront_id='once' FOR UPDATE",[idOrNull]):{rows:[]};
      if(idOrNull&&!before)fail('PLAN_NOT_FOUND','Plan not found',404);
      if(before&&(before.days!==value.days||value.version!==before.version))fail('PLAN_VERSION_CONFLICT','Days are immutable and current version is required');
      const {rows:[after]}=before?await client.query<LeasePlan>(`UPDATE lease_plans SET price_minor=$2,points_price=$3,currency=$4,label=$5,note=$6,active=$7,sort_order=$8,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[before.id,value.priceMinor,value.pointsPrice,value.currency,value.label,value.note,value.active,value.sortOrder]):await client.query<LeasePlan>(`INSERT INTO lease_plans(storefront_id,days,price_minor,points_price,currency,version,label,note,active,sort_order) VALUES('once',$1,$2,$3,$4,1,$5,$6,$7,$8) RETURNING *`,[value.days,value.priceMinor,value.pointsPrice,value.currency,value.label,value.note,value.active,value.sortOrder]);
      const result=planView(after!);
      await audit(client,actorId,'ONCE_PLAN_SAVE',after!.id,value.reason,before??null,after);
      if(value.idempotencyKey)await client.query('INSERT INTO once_admin_idempotency(actor_id,action,idempotency_key,target_id,request_payload,result) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[actorId,'PLAN_SAVE',value.idempotencyKey,after!.id,JSON.stringify(payload),JSON.stringify(result)]);
      return result;
    });
  }
}
