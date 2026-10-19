import { Body, Controller, Get, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure, SchemaPipe } from './http.js';
import { SessionGuard, type SessionRequest } from './authentication.js';
import { ReceivingSync } from './providers/receiving-sync.js';
import { MockFulfillment } from './mock-fulfillment.js';
const outcome = z.enum(['SUCCESS','FAILED','UNKNOWN']);
const inboundSchema=z.object({id:z.uuid(),numberId:z.uuid(),outcome,resolve:z.boolean().optional()}).strict();
const fulfillmentSchema=z.object({orderId:z.uuid(),outcome}).strict();

@Injectable()
export class Sandbox {
 constructor(private readonly db:Database,private readonly environment:Environment,private readonly receiving:ReceivingSync){}
 get enabled(){return this.environment.values.LOCAL_SANDBOX;}
 private guard(){if(!this.enabled)throw new ApiFailure(404,'NOT_FOUND','Local sandbox is disabled');}
 async credit(userId:string){
  this.guard();return this.db.transaction(async client=>{
   const {rows:[user]}=await client.query<{points_balance:number}>('SELECT points_balance FROM users WHERE id=$1 FOR UPDATE',[userId]);
   const prior=await client.query('SELECT ledger_id FROM sandbox_grants WHERE user_id=$1',[userId]);
   if(prior.rowCount)return {status:'ALREADY_GRANTED'};
   const balance=user!.points_balance+100;
   const {rows:[entry]}=await client.query("INSERT INTO point_ledger(user_id,type,delta,balance_after,description) VALUES($1,'SEED_CREDIT',100,$2,'Local sandbox credit (no payment)') RETURNING id",[userId,balance]);
   await client.query('INSERT INTO sandbox_grants(user_id,ledger_id) VALUES($1,$2)',[userId,entry!.id]);
   await client.query('UPDATE users SET points_balance=$2 WHERE id=$1',[userId,balance]);return {status:'GRANTED'};
  });
 }
 async fulfill(userId:string,input:z.infer<typeof fulfillmentSchema>){
  this.guard();const owned=await this.db.query('SELECT id FROM orders WHERE id=$1 AND user_id=$2',[input.orderId,userId]);
  if(!owned.rowCount)throw new ApiFailure(404,'ORDER_NOT_FOUND','Order not found');
  const simulator=new MockFulfillment(this.db),claim=await simulator.claim(input.orderId);
  return simulator.resolve(input.orderId,input.outcome==='SUCCESS'?'SUCCEEDED':input.outcome==='UNKNOWN'?'UNCERTAIN':'FAILED','Explicit local sandbox result',claim.token??undefined);
 }
 async inbound(userId:string,input:z.infer<typeof inboundSchema>){
  this.guard();
  const saved=await this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`sandbox:${input.id}`]);
   const {rows:[prior]}=await client.query('SELECT * FROM sandbox_inbound WHERE id=$1',[input.id]);
   if(prior){
    if(prior.user_id!==userId||prior.number_id!==input.numberId)throw new ApiFailure(409,'IDEMPOTENCY_CONFLICT','Mock event belongs to a different request');
    if(input.resolve&&prior.outcome==='UNKNOWN'){
     await client.query("UPDATE sandbox_inbound SET outcome='SUCCESS' WHERE id=$1",[input.id]);prior.outcome='SUCCESS';
    }else if(prior.outcome!==input.outcome&&!(input.resolve&&prior.outcome==='SUCCESS'))throw new ApiFailure(409,'IDEMPOTENCY_CONFLICT','Mock event outcome differs');
    return prior;
   }
   if(input.resolve)throw new ApiFailure(404,'NOT_FOUND','Mock event not found');
   const {rows:[number]}=await client.query(`SELECT n.service,a.id AS allocation_id FROM phone_numbers n JOIN number_allocations a
    ON a.number_id=n.id AND a.user_id=n.assigned_user_id AND a.released_at IS NULL
    WHERE n.id=$1 AND n.assigned_user_id=$2 AND n.expires_at>now() FOR UPDATE OF n,a`,[input.numberId,userId]);
   if(!number)throw new ApiFailure(409,'PROVIDER_ALLOCATION_INACTIVE','Service is not active for this account');
   const {rows:[event]}=await client.query(`INSERT INTO sandbox_inbound(id,user_id,number_id,allocation_id,service,outcome)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[input.id,userId,input.numberId,number.allocation_id,number.service,input.outcome]);return event!;
  });
  if(saved.outcome!=='SUCCESS')return {status:saved.outcome==='UNKNOWN'?'UNCERTAIN':'FAILED'};
  const {rows:[number]}=await this.db.query<{phone_number:string}>('SELECT phone_number FROM phone_numbers WHERE id=$1',[saved.number_id]);
  const externalNumberId=String(BigInt('0x'+saved.number_id.replaceAll('-','')));
  await this.receiving.bindMockNumber(saved.number_id,{externalNumberId,phoneNumber:number!.phone_number,iccid:null,status:'ACTIVE',resourceExpiresAt:null});
  return this.receiving.receiveMock({numberId:saved.number_id,allocationId:saved.allocation_id,service:saved.service},{externalMessageId:`IN-${saved.id}`,externalNumberId,phoneNumber:number!.phone_number,sender:saved.service,body:`[SANDBOX] ${saved.service} synthetic verification 482913`,receivedAt:new Date(saved.received_at).toISOString(),upstreamCreatedAt:null},{eventId:`sandbox-${saved.id}`,test:false});
 }
}
@Controller('sandbox')
@UseGuards(SessionGuard)
export class SandboxController {
 constructor(private readonly sandbox:Sandbox){}
 @Get()status(){return {data:{enabled:this.sandbox.enabled}};}
 @Post('credit')async credit(@Req()r:SessionRequest){return {data:await this.sandbox.credit(r.user.id)};}
 @Post('fulfill')async fulfill(@Req()r:SessionRequest,@Body(new SchemaPipe(fulfillmentSchema))input:z.infer<typeof fulfillmentSchema>){return {data:await this.sandbox.fulfill(r.user.id,input)};}
 @Post('inbound')async inbound(@Req()r:SessionRequest,@Body(new SchemaPipe(inboundSchema))input:z.infer<typeof inboundSchema>){return {data:await this.sandbox.inbound(r.user.id,input)};}
}
