import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { lockPointAccount,reserveOrderPoints } from '../points-wallet.js';
import { OnceInventory,assertWholeAvailable } from './inventory.js';
import { OncePurchaseIntents } from './purchase-intents.js';
import { fail,intentInput,leaseKey,scenarioSchema,type IntentInput,type Scenario } from './lease-common.js';
export function requireOnceMock(environment:Environment){if(environment.pcProvider!=='pingcode-mock'||environment.siteId!=='once'||environment.values.NODE_ENV==='production'||!environment.values.LOCAL_SANDBOX)fail('ONCE_MOCK_DISABLED','Explicit lease simulation requires Mock mode in the isolated ONCE local sandbox',403);}
@Injectable()
export class OnceLeaseOrdering {
  constructor(private readonly db:Database,private readonly environment:Environment,private readonly inventory:OnceInventory,private readonly intents:OncePurchaseIntents){}
  async create(userId:string,raw:IntentInput&{purchaseIntentId?:string},key:string,scenario:Scenario='SUCCESS',demo=false){
    if(this.environment.siteId!=='once')fail('NOT_FOUND','Whole-number ordering is unavailable on this site',404);
    if(demo||scenario!=='SUCCESS')requireOnceMock(this.environment);
    leaseKey.parse(key);scenarioSchema.parse(scenario);
    const {purchaseIntentId,...selection}=raw,input=intentInput.parse(selection);
    const payload=this.environment.pcProvider==='pingcode-mock'?{...input,...(purchaseIntentId?{purchaseIntentId}:{}),scenario,demo,settlement:'POINTS_V1'}:{...input,...(purchaseIntentId?{purchaseIntentId}:{}),provider:this.environment.pcProvider,settlement:'POINTS_V1'};
    return this.db.transaction(async client=>{
      const account=await lockPointAccount(client,userId,true);
      const {rows:[prior]}=await client.query<{id:string;same:boolean;product_type:string}>(`SELECT id,product_type,request_payload=$3::jsonb AS same FROM orders WHERE user_id=$1 AND idempotency_key=$2 FOR UPDATE`,[userId,key,JSON.stringify(payload)]);
      if(prior){if(prior.product_type!=='NUMBER_LEASE'||!prior.same)fail('IDEMPOTENCY_CONFLICT','Idempotency key was used for a different request');return {orderId:prior.id,replayed:true};}
      if(account.status!=='ACTIVE'||!(await client.query("SELECT 1 FROM users WHERE id=$1 AND account_status='ACTIVE' AND auth_kind='LOCAL'",[userId])).rowCount)fail('SELF_SERVICE_ACCOUNT_REQUIRED','An active local self-service account is required',403);
      if(purchaseIntentId){
        const {rows:[intent]}=await client.query<{order_id:string|null;same:boolean;expires_at:Date}>(`SELECT order_id,expires_at,(request_payload-'quoteVersion')=($3::jsonb-'quoteVersion') AS same FROM purchase_intents WHERE id=$1 AND user_id=$2 AND storefront_id='once' FOR UPDATE`,[purchaseIntentId,userId,JSON.stringify(input)]);
        if(!intent||!intent.same||new Date(intent.expires_at)<=new Date())fail('INTENT_CHANGED','Purchase intent expired or selection changed');
        if(intent.order_id)return {orderId:intent.order_id,replayed:true};
      }
      const {number,plan}=await this.intents.selection(client,userId,input,false);
      // Lock before inserting the order: its number FK would otherwise take a shared lock that competing buyers both upgrade.
      const locked=await this.inventory.detail(number.id,client,true);
      const orderId=randomUUID();
      // The provisional order is transaction-local; deferred wallet identity binds its real reservation before commit.
      await insertLeaseOrder(client,{id:orderId,userId,number,plan,days:input.term,kind:input.kind,leaseId:input.kind==='RENEW'?input.leaseId:null,key,payload,sourceChannel:demo?'SANDBOX':'DIRECT'});
      const reservation=await reserveOrderPoints(client,account,{orderId,points:plan.points_price,description:'ONCE whole-number purchase'});
      await client.query('UPDATE orders SET point_reservation_id=$2 WHERE id=$1',[orderId,reservation.id]);
      if(input.kind==='RENEW'){
        const {rows:[lease]}=await client.query<{status:string;number_id:string}>('SELECT status,number_id FROM leases WHERE id=$1 AND user_id=$2 FOR UPDATE',[input.leaseId,userId]);
        if(!lease||lease.number_id!==number.id||!['ACTIVE','EXPIRED_HELD'].includes(lease.status))fail('LEASE_NOT_RENEWABLE','Lease no longer holds this number');
      }
      await assertWholeAvailable(client,locked,input.kind==='RENEW'?input.leaseId:null,input.term,orderId);
      await client.query('INSERT INTO whole_number_reservations(number_id,order_id,lease_id) VALUES($1,$2,$3)',[number.id,orderId,input.kind==='RENEW'?input.leaseId:null]);
      await client.query('INSERT INTO mock_fulfillment_operations(order_id,request_id,source,scenario) VALUES($1,$1,$2,$3)',[orderId,this.environment.pcProvider==='pingcode'?'local-service':'mock',this.environment.pcProvider==='pingcode'?null:scenario]);
      if(purchaseIntentId)await client.query('UPDATE purchase_intents SET order_id=$2 WHERE id=$1',[purchaseIntentId,orderId]);
      return {orderId,replayed:false};
    });
  }
}
export async function insertLeaseOrder(client:PoolClient,i:{id:string;userId:string;number:{id:string;phone_number:string;region_id:string;provider:string};plan:{id:string;label:string;price_minor:string;points_price:number;currency:string;version:number}|null;days:number;kind:string;leaseId:string|null;key:string;payload:unknown;compensation?:boolean;currency?:string|null;sourceChannel?:'SANDBOX'|'DIRECT'}){
  const points=i.compensation?0:i.plan!.points_price,amount=i.compensation?0:i.plan!.price_minor;
  await client.query(`INSERT INTO orders(id,order_number,user_id,region_id,service,plan,plan_name,quantity,unit_points,total_points,duration_days,idempotency_key,product_snapshot,source_channel,fulfillment_status,product_type,operation_kind,settlement_type,sales_storefront_id,lease_plan_id,lease_id,target_number_id,number_snapshot,quote_version,amount_minor,currency,request_payload)
    VALUES($1,$2,$3,$4,NULL,NULL,$5,1,$6,$6,$7,$8,$9::jsonb,$20,'PROCESSING','NUMBER_LEASE',$10,$11,'once',$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,[i.id,`ONCE-${i.id.toUpperCase()}`,i.userId,i.number.region_id,i.plan?.label??'Administrative extension',points,i.days,i.key,JSON.stringify({number:i.number.phone_number,days:i.days,plan:i.plan,source:'LOCAL_SERVICE',upstreamResource:i.number.provider}),i.kind,i.compensation?'COMPENSATION':'POINTS',i.plan?.id??null,i.leaseId,i.number.id,i.number.phone_number,i.plan?.version??null,amount,i.plan?.currency??i.currency??null,JSON.stringify(i.payload),i.sourceChannel??'DIRECT']);
}
