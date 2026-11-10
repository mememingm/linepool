import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { OnceInventory, assertWholeAvailable, onceNumberFrom, trustedOnce } from './inventory.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { planView, quotedPlan, type LeasePlan } from './lease-plans.js';
import { fail, intentInput, type IntentInput } from './lease-common.js';
export type PurchaseIntent={id:string;user_id:string;storefront_id:string;kind:'RENT'|'RENEW';number_id:string|null;lease_id:string|null;number_snapshot:string|null;term:number;quote_version:number;points_price:number;request_payload:IntentInput;order_id:string|null;expires_at:Date;created_at:Date};
function view(i:PurchaseIntent){return {id:i.id,kind:i.kind,number:i.number_snapshot,leaseId:i.lease_id,term:i.term,termDays:i.term,quoteVersion:i.quote_version,pointsPrice:i.points_price,orderId:i.order_id,createdAt:i.created_at,expiresAt:i.expires_at,expired:new Date(i.expires_at)<=new Date()};}
@Injectable()
export class OncePurchaseIntents {
  constructor(private readonly db:Database,private readonly inventory:OnceInventory,private readonly environment:Environment){}
  async selection(client:PoolClient,userId:string,input:IntentInput,availability=true){
    let numberId:string;
    if(input.kind==='RENT'){
      const {rows:[n]}=await client.query<{id:string}>(`SELECT n.id ${onceNumberFrom} WHERE ${trustedOnce} AND n.phone_number=$3`,[this.environment.selfServiceExternalAccountId,this.environment.pcProvider,input.number]);
      if(!n)fail('NUMBER_NOT_FOUND','Number not found',404);numberId=n.id;
    }else{
      const {rows:[l]}=await client.query<{number_id:string;status:string}>('SELECT number_id,status FROM leases WHERE id=$1 AND user_id=$2',[input.leaseId,userId]);
      if(!l)fail('LEASE_NOT_FOUND','Lease not found',404);
      if(!['ACTIVE','EXPIRED_HELD'].includes(l.status))fail('LEASE_NOT_RENEWABLE','Lease is no longer held');numberId=l.number_id;
    }
    const number=await this.inventory.detail(numberId,client);
    const plan=await quotedPlan(client,input.term,input.quoteVersion,true,!availability);
    if(availability)await assertWholeAvailable(client,number,input.kind==='RENEW'?input.leaseId:null,input.term);
    return {number,plan};
  }
  async create(userId:string,raw:unknown){const input=intentInput.parse(raw);return this.db.transaction(async client=>{
    if(!(await client.query("SELECT 1 FROM users WHERE id=$1 AND account_status='ACTIVE' AND auth_kind='LOCAL' FOR SHARE",[userId])).rowCount)fail('SELF_SERVICE_ACCOUNT_REQUIRED','A local self-service account is required',403);
    const {number,plan}=await this.selection(client,userId,input);
    const {rows:[i]}=await client.query<PurchaseIntent>(`INSERT INTO purchase_intents(user_id,storefront_id,kind,number_id,lease_id,number_snapshot,term,quote_version,points_price,request_payload,expires_at) VALUES($1,'once',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now()+interval '24 hours') RETURNING *`,[userId,input.kind,number.id,input.kind==='RENEW'?input.leaseId:null,number.phone_number,input.term,plan.version,plan.points_price,JSON.stringify(input)]);
    return view(i!);
  });}
  async get(userId:string,id:string){return this.db.transaction(async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows:[i]}=await client.query<PurchaseIntent>("SELECT * FROM purchase_intents WHERE id=$1 AND user_id=$2 AND storefront_id='once'",[id,userId]);
    if(!i)fail('INTENT_NOT_FOUND','Purchase intent not found',404);
    let currentPlan:LeasePlan|null=null,availability='AVAILABLE';
    try{
      const plan=await quotedPlan(client,i.term,undefined,false,false);
      currentPlan=plan;
      await this.selection(client,userId,intentInput.parse({...i.request_payload,quoteVersion:plan.version}));
    }catch(error){
      if(!(error instanceof ApiFailure))throw error;
      // ApiFailure constructs this response shape in-process.
      const response=error.getResponse() as {error:{code:string}};
      availability=response.error.code;
    }
    return {...view(i),priceChanged:currentPlan!==null&&currentPlan.version!==i.quote_version,availability,currentPlan:currentPlan?planView(currentPlan):null};
  });}
  async validateForRecharge(client:PoolClient,userId:string,id:string){
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const {rows:[i]}=await client.query<PurchaseIntent>("SELECT * FROM purchase_intents WHERE id=$1 AND user_id=$2 AND storefront_id='once'",[id,userId]);
    if(!i||new Date(i.expires_at)<=new Date())fail('INTENT_EXPIRED','Purchase intent is missing or expired');
    if(i.order_id)fail('INTENT_ALREADY_BOUND','Purchase intent already has an order');
    const currentPlan=await quotedPlan(client,i.term,undefined,true,false);
    await this.selection(client,userId,intentInput.parse({...i.request_payload,quoteVersion:currentPlan.version}));
    return i;
  }
}
