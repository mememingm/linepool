import { Body, Controller, Get, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure, SchemaPipe } from './http.js';
import { SessionGuard, type SessionRequest } from './authentication.js';
import { ReceivingSync } from './providers/receiving-sync.js';
import { MockFulfillment } from './mock-fulfillment.js';
import { creditPoints, lockPointAccount } from './points-wallet.js';
import { MockReceivingProvider } from './providers/mock-receiving-provider.js';
const outcome = z.enum(['SUCCESS','FAILED','UNKNOWN']);
const inboundSchema=z.object({id:z.uuid(),numberId:z.uuid(),allocationId:z.uuid().optional(),outcome,resolve:z.boolean().optional()}).strict();
const fulfillmentSchema=z.object({orderId:z.uuid(),outcome}).strict();

@Injectable()
export class Sandbox {
 constructor(private readonly db:Database,private readonly environment:Environment,private readonly receiving:ReceivingSync,private readonly provider:MockReceivingProvider){}
 get enabled(){return this.environment.values.NODE_ENV !== 'production' && this.environment.values.LOCAL_SANDBOX;}
 private guard(){if(!this.enabled)throw new ApiFailure(404,'NOT_FOUND','Local sandbox is disabled');}
 async credit(userId:string){
  this.guard();return this.db.transaction(async client=>{
   const account=await lockPointAccount(client,userId);
   const prior=await client.query('SELECT ledger_id FROM sandbox_grants WHERE user_id=$1',[userId]);
   if(prior.rowCount)return {status:'ALREADY_GRANTED'};
   const entry=await creditPoints(client,account,{points:100,type:'SEED_CREDIT',businessId:`sandbox:${userId}`,description:'Local sandbox credit (no payment)'});
   await client.query('INSERT INTO sandbox_grants(user_id,ledger_id) VALUES($1,$2)',[userId,entry.id]);
   return {status:'GRANTED'};
  });
 }
 async fulfill(userId:string,input:z.infer<typeof fulfillmentSchema>){
  this.guard();const owned=await this.db.query("SELECT id FROM orders WHERE id=$1 AND user_id=$2 AND product_type='SMS_CODE' AND sales_storefront_id='linepool'",[input.orderId,userId]);
  if(!owned.rowCount)throw new ApiFailure(404,'ORDER_NOT_FOUND','Order not found');
  const simulator=new MockFulfillment(this.db,undefined,this.provider),claim=await simulator.claim(input.orderId);
  return simulator.resolve(input.orderId,input.outcome==='SUCCESS'?'SUCCEEDED':input.outcome==='UNKNOWN'?'UNCERTAIN':'FAILED','Explicit local sandbox result',claim.token??undefined);
 }
 async inbound(userId:string,input:z.infer<typeof inboundSchema>){
  this.guard();
  const saved=await this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`sandbox:${input.id}`]);
   const {rows:[prior]}=await client.query('SELECT * FROM sandbox_inbound WHERE id=$1',[input.id]);
   if(prior){
    if(prior.user_id!==userId||prior.number_id!==input.numberId||(input.allocationId&&prior.allocation_id!==input.allocationId))throw new ApiFailure(409,'IDEMPOTENCY_CONFLICT','Mock event belongs to a different request');
    if(input.resolve&&prior.outcome==='UNKNOWN'){
     await client.query("UPDATE sandbox_inbound SET outcome='SUCCESS' WHERE id=$1",[input.id]);prior.outcome='SUCCESS';
    }else if(prior.outcome!==input.outcome&&!(input.resolve&&prior.outcome==='SUCCESS'))throw new ApiFailure(409,'IDEMPOTENCY_CONFLICT','Mock event outcome differs');
    return prior;
   }
   if(input.resolve)throw new ApiFailure(404,'NOT_FOUND','Mock event not found');
   const {rows:numbers}=await client.query(`SELECT a.platform_id AS service,a.id AS allocation_id FROM phone_numbers n JOIN number_allocations a
    ON a.number_id=n.id AND a.allocation_type='PLATFORM' AND a.released_at IS NULL
    JOIN upstream_accounts ua ON ua.id=n.upstream_account_id AND ua.storefront_id='linepool' AND ua.owner_kind='SELF_SERVICE'
    WHERE n.id=$1 AND a.user_id=$2 AND a.assigned_at<=now() AND a.expires_at>now()
      AND (a.receiving_mode='HOSTED' OR a.receiving_status='WAITING') AND ($3::uuid IS NULL OR a.id=$3)
    FOR UPDATE OF n,a`,[input.numberId,userId,input.allocationId??null]);
   const number=numbers.length===1?numbers[0]:undefined;
   if(!number)throw new ApiFailure(409,'PROVIDER_ALLOCATION_INACTIVE','Choose one active platform service for this account');
   const {rows:[event]}=await client.query(`INSERT INTO sandbox_inbound(id,user_id,number_id,allocation_id,service,outcome)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[input.id,userId,input.numberId,number.allocation_id,number.service,input.outcome]);return event!;
  });
  if(saved.outcome!=='SUCCESS')return {status:saved.outcome==='UNKNOWN'?'UNCERTAIN':'FAILED'};
  const {rows:[number]}=await this.db.query<{phone_number:string;external_number_id:string;receiving_mode:string;code_rule_snapshot:{rule:{senderAllowlist:string[];bodyPrefix:string;bodySuffix:string;codeLength:number}}|null}>(
   `SELECT n.phone_number,b.external_number_id,a.receiving_mode,a.code_rule_snapshot FROM phone_numbers n JOIN provider_resource_bindings b ON b.number_id=n.id
    JOIN number_allocations a ON a.number_id=n.id AND a.id=$2 WHERE n.id=$1 AND b.provider='pingcode-mock'`,[saved.number_id,saved.allocation_id]);
  if(!number)throw new ApiFailure(409,'RESOURCE_NOT_SYNCED','Sync the Mock resource connection before creating an inbound event');
  const externalNumberId=number.external_number_id;
  const rule=number.code_rule_snapshot?.rule;
  if(number.receiving_mode==='ONE_TIME'&&!rule)throw new ApiFailure(409,'PLATFORM_CODE_RULE_REQUIRED','The original platform rule is unavailable');
  const sender=rule?rule.senderAllowlist[0]!:saved.service;
  const body=rule?`${rule.bodyPrefix}${'48291375'.slice(0,rule.codeLength)}${rule.bodySuffix}`:`[SANDBOX] ${saved.service} synthetic verification 482913`;
  return this.receiving.receiveMock({numberId:saved.number_id,allocationId:saved.allocation_id,service:saved.service},{externalMessageId:`IN-${saved.id}`,externalNumberId,phoneNumber:number.phone_number,sender,body,receivedAt:new Date(saved.received_at).toISOString(),upstreamCreatedAt:null},{eventId:`sandbox-${saved.id}`,test:false});
 }
}
@Controller('sandbox')
@UseGuards(SessionGuard)
export class SandboxController {
 constructor(private readonly sandbox:Sandbox){}
 @Get()status(){if(!this.sandbox.enabled)throw new ApiFailure(404,'NOT_FOUND','Not found');return {data:{enabled:true}};}
 @Post('credit')async credit(@Req()r:SessionRequest){return {data:await this.sandbox.credit(r.user.id)};}
 @Post('fulfill')async fulfill(@Req()r:SessionRequest,@Body(new SchemaPipe(fulfillmentSchema))input:z.infer<typeof fulfillmentSchema>){return {data:await this.sandbox.fulfill(r.user.id,input)};}
 @Post('inbound')async inbound(@Req()r:SessionRequest,@Body(new SchemaPipe(inboundSchema))input:z.infer<typeof inboundSchema>){return {data:await this.sandbox.inbound(r.user.id,input)};}
}
