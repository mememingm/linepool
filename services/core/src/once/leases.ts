import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { Ordering } from '../ordering.js';
import { MockFulfillment } from '../mock-fulfillment.js';
import { MockWholeNumberProvider } from '../providers/mock-whole-number-provider.js';
import { lockPointAccount } from '../points-wallet.js';
import { OnceInventory,assertWholeAvailable,numberView,type OnceNumber } from './inventory.js';
import { OnceLeasePlans,quotedPlan } from './lease-plans.js';
import { insertLeaseOrder,requireOnceMock } from './lease-ordering.js';
import { audit,fail,historyPage,historyPosition,historyQuery,leaseInput,leaseKey,leaseTerm,renewInput,requireLeaseAdmin,type LeaseInput,type RenewInput,type Scenario } from './lease-common.js';
const leaseFrom=`FROM leases l JOIN phone_numbers n ON n.id=l.number_id JOIN upstream_accounts u ON u.id=n.upstream_account_id JOIN regions r ON r.id=n.region_id JOIN orders initial ON initial.id=l.initial_order_id
 LEFT JOIN LATERAL(SELECT min(a.assigned_at) AS started_at,max(a.expires_at) AS expires_at,
 bool_or(a.assigned_at<=now() AND now()<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))) AS current FROM number_allocations a WHERE a.lease_id=l.id) periods ON true`;
const leaseFields=`l.*,n.phone_number,n.region_id,r.name AS country,r.prefix,n.display_metadata,n.hold_reason,n.manual_hold,n.capability,n.resource_status,n.resource_expires_at,n.sale_enabled,n.upstream_account_id,n.source_missing,n.pc_capabilities,u.status AS upstream_status,u.provider,u.historical_only,u.external_account_id,
 (u.provider=$3 AND u.external_account_id=$4 AND u.application_id=$5 AND u.issuer=$6 AND NOT u.historical_only AND u.status='ACTIVE' AND u.auth_status='ACTIVE' AND u.access_expires_at>now() AND 'NUMBER_LEASE'=ANY(u.enabled_capabilities) AND 'SEND_SMS'=ANY(u.enabled_capabilities)) AS upstream_ready,
 initial.duration_days AS term,initial.amount_minor,initial.currency,periods.started_at,periods.expires_at,COALESCE(periods.current,false) AS current`;
// Historical facts remain visible after an account is archived or the configured connection changes.
const leaseScope=`u.storefront_id='once' AND u.owner_kind='SELF_SERVICE' AND u.agent_id IS NULL`;
type LeaseRow=OnceNumber&{provider:string;historical_only:boolean;external_account_id:string;user_id:string;number_id:string;initial_order_id:string;status:string;term:number;amount_minor:string|null;currency:string|null;started_at:Date|null;expires_at:Date|null;current:boolean;created_at:Date;held_at:Date|null;released_at:Date|null;ended_at:Date|null};
function leaseView(l:LeaseRow){
  const status=l.status==='ACTIVE'&&!l.current?'EXPIRED_HELD':l.status,demo=l.provider==='pingcode-mock'&&!l.historical_only;
  const sendEnabled=l.current&&l.status==='ACTIVE'&&l.upstream_ready&&!l.source_missing&&!l.manual_hold&&l.capability==='SEND_RECEIVE'&&l.pc_capabilities.includes('SEND_SMS')&&['LOCAL','ONLINE'].includes(l.resource_status)&&l.resource_expires_at!==null&&new Date(l.resource_expires_at)>new Date();
  return {id:l.id,number:l.phone_number,countryCode:l.region_id.toUpperCase(),countryName:l.country,regionName:l.display_metadata?.regionName??null,term:l.term,price:l.amount_minor===null?null:Number(l.amount_minor)/100,currency:l.currency,startedAt:l.started_at,expiresAt:l.expires_at,demo,historicalOnly:l.historical_only,externalAccountId:l.external_account_id,smsSend:{enabled:Boolean(sendEnabled),demo,reason:sendEnabled?(demo?'支持模拟短信发送':'支持短信发送'):'当前租约或上游连接不支持发送'},status,holdReason:l.hold_reason??(status==='EXPIRED_HELD'?'LEASE_EXPIRED_HELD':null)};
}
const orderFrom=`FROM orders o LEFT JOIN mock_fulfillment_operations op ON op.order_id=o.id LEFT JOIN point_reservations pr ON pr.id=o.point_reservation_id`;
const orderFields=`o.*,op.status AS operation_status,op.request_id,op.scenario,op.attempts,op.claim_until,op.evidence,op.evidence_data,op.provider_order_id,op.checked_at,pr.status AS funds_status`;
type OrderRow={id:string;user_id:string;import_batch_id:string|null;product_snapshot:{upstreamResource?:string}|null;lease_id:string|null;number_snapshot:string;operation_kind:string;duration_days:number;amount_minor:string|null;total_points:number;settlement_type:string;funds_status:string|null;fulfillment_status:string;operation_status:string|null;quote_version:number;currency:string|null;scenario:string|null;attempts:number;claim_until:Date|null;evidence:string|null;evidence_data:unknown;provider_order_id:string|null;checked_at:Date|null;completed_at:Date|null;created_at:Date;request_id:string|null};
function purchaseView(o:OrderRow){
  const demo=o.import_batch_id===null&&o.product_snapshot?.upstreamResource!=='pingcode';
  return {orderId:o.id,leaseId:o.lease_id,number:o.number_snapshot,status:o.operation_status==='SUCCEEDED'||o.fulfillment_status==='COMPLETED'?(demo?'DEMO_CONFIRMED':'COMPLETED'):o.operation_status??o.fulfillment_status,term:o.duration_days,amount:o.amount_minor===null?null:Number(o.amount_minor)/100,points:o.total_points,fundsStatus:o.funds_status??'NOT_REQUIRED',settlementType:o.settlement_type,quoteVersion:o.quote_version,currency:o.currency,demo,requestId:o.request_id??o.id,...(demo?{scenario:o.scenario}:{}),attempts:o.attempts??0,claimUntil:o.claim_until,lastError:['UNCERTAIN','FAILED'].includes(o.operation_status??'')?o.evidence:null,checkedAt:o.checked_at,completedAt:o.completed_at,createdAt:o.created_at,providerOrderId:o.provider_order_id,evidence:o.evidence_data??o.evidence,reconcilable:o.request_id!==null};
}
function billView(o:OrderRow){const p=purchaseView(o);return {id:o.id,leaseId:o.lease_id,kind:o.operation_kind==='RENT'?'号码租赁':o.operation_kind==='RENEW'?'同号续费':o.operation_kind==='ADMIN_ASSIGN'?'管理分配':'管理延长',number:o.number_snapshot,term:o.duration_days,amount:p.amount,currency:o.currency,points:o.total_points,settlementType:o.settlement_type,fundsStatus:p.fundsStatus,status:p.status==='DEMO_CONFIRMED'?'演示已确认':p.status,createdAt:o.created_at};}
const compensation=z.object({amountMinor:z.number().int().default(0),note:z.string().trim().max(200).optional(),reason:z.string().trim().min(3).max(1000)});
const assignSchema=compensation.extend({userId:z.uuid(),term:leaseTerm}).strict();
const extendSchema=compensation.extend({days:leaseTerm}).strict();
@Injectable()
export class OnceLeases {
  constructor(private readonly db:Database,private readonly environment:Environment,private readonly ordering:Ordering,private readonly fulfillment:MockFulfillment,private readonly leasePlans:OnceLeasePlans,private readonly stock:OnceInventory,private readonly whole:MockWholeNumberProvider){}
  plans(){return this.leasePlans.list();}
  inventory(){return this.stock.list();}
  private async rows(userId:string,client:Pick<Database,'query'>=this.db,id?:string){return (await client.query<LeaseRow>(`SELECT ${leaseFields} ${leaseFrom} WHERE ${leaseScope} AND l.user_id=$1 AND ($2::uuid IS NULL OR l.id=$2) ORDER BY l.created_at DESC,l.id ASC`,[userId,id??null,this.environment.pcProvider,this.environment.selfServiceExternalAccountId,this.environment.values.PC_APPLICATION_ID,this.environment.values.PC_ISSUER])).rows;}
  async list(userId:string){return (await this.rows(userId)).map(leaseView);}
  async detail(userId:string,id:string){const [l]=await this.rows(userId,this.db,id);if(!l)fail('LEASE_NOT_FOUND','Lease not found',404);const {rows:periods}=await this.db.query('SELECT id,order_id AS "orderId",assigned_at AS "assignedAt",expires_at AS "expiresAt",released_at AS "releasedAt",release_reason AS "releaseReason" FROM number_allocations WHERE lease_id=$1 ORDER BY assigned_at,id',[id]);const view=leaseView(l);return {...view,userId:l.user_id,phoneNumberId:l.number_id,termDays:l.term,priceMinor:l.amount_minor===null?null:Number(l.amount_minor),createdAt:l.created_at,endedAt:l.ended_at,phoneNumber:{...numberView({...l,id:l.number_id}),provider:l.provider,occupied:['ACTIVE','EXPIRED_HELD'].includes(l.status),holdReason:l.hold_reason,smsEnabled:!l.historical_only&&['RECEIVE','SEND_RECEIVE'].includes(l.capability),smsSendEnabled:view.smsSend.enabled},periods};}
  async state(userId:string,leaseId?:string){return this.db.transaction(async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const leases=(await this.rows(userId,client)).map(leaseView);if(leaseId&&!leases.some(l=>l.id===leaseId))fail('LEASE_NOT_FOUND','Lease not found',404);
    const lease=(leaseId?leases.find(l=>l.id===leaseId):leases[0])??null;
    const {rows:messages}=lease?await client.query(`SELECT m.id,m.sender,m.title,m.body,m.verification_code AS code,m.received_at AS "receivedAt",m.read_at AS "readAt" FROM sms_messages m JOIN number_allocations a ON a.id=m.allocation_id WHERE a.lease_id=$1 AND m.user_id=$2 ORDER BY m.received_at DESC,m.id ASC LIMIT 200`,[lease.id,userId]):{rows:[]};
    const {rows:[mc]}=await client.query<{count:number}>('SELECT count(*)::int AS count FROM sms_messages m JOIN number_allocations a ON a.id=m.allocation_id WHERE a.lease_id=$1 AND m.user_id=$2',[lease?.id??null,userId]);
    const {rows:[bc]}=await client.query<{count:number}>("SELECT count(*)::int AS count FROM orders WHERE user_id=$1 AND product_type='NUMBER_LEASE' AND sales_storefront_id='once'",[userId]);
    const bills=(await this.orderRows(userId,client)).map(billView);
    return {lease,leases,messageCount:mc!.count,billsCount:bc!.count,messages,bills,demo:leases.every(l=>l.demo),truncated:{messages:mc!.count>messages.length,bills:bc!.count>bills.length}};
  });}
  async rent(userId:string,raw:LeaseInput,key:string,scenario:Scenario='SUCCESS'){const input=leaseInput.parse(raw),accepted=await this.ordering.createLease(userId,{kind:'RENT',...input},key,scenario);const before=await this.purchase(userId,accepted.orderId);if(before.status==='PENDING'||before.status==='PROCESSING'||before.status==='UNCERTAIN')await this.fulfillment.runWhole(userId,accepted.orderId);return {...await this.purchase(userId,accepted.orderId),replayed:accepted.replayed};}
  async renew(userId:string,leaseId:string,raw:RenewInput,key:string,scenario:Scenario='SUCCESS'){const input=renewInput.parse(raw),accepted=await this.ordering.createLease(userId,{kind:'RENEW',leaseId,...input},key,scenario);const before=await this.purchase(userId,accepted.orderId);if(before.status==='PENDING'||before.status==='PROCESSING'||before.status==='UNCERTAIN')await this.fulfillment.runWhole(userId,accepted.orderId);return {...await this.purchase(userId,accepted.orderId),replayed:accepted.replayed};}
  async demoOrder(userId:string,raw:LeaseInput,key:string,scenario:Scenario){requireOnceMock(this.environment);const input=leaseInput.parse(raw),accepted=await this.ordering.createLease(userId,{kind:'RENT',...input},key,scenario,true);return {...await this.purchase(userId,accepted.orderId),replayed:accepted.replayed};}
  async demoPurchase(userId:string,id:string){requireOnceMock(this.environment);if(!(await this.db.query("SELECT 1 FROM orders WHERE id=$1 AND user_id=$2 AND source_channel='SANDBOX' AND product_type='NUMBER_LEASE' AND sales_storefront_id='once'",[id,userId])).rowCount)fail('ORDER_NOT_FOUND','Demo order not found',404);return this.purchase(userId,id);}
  async processDemoPurchase(userId:string,id:string){await this.demoPurchase(userId,id);return this.checkPurchase(userId,id);}
  async purchase(userId:string,id:string){const {rows:[o]}=await this.db.query<OrderRow>(`SELECT ${orderFields} ${orderFrom} WHERE o.id=$1 AND o.user_id=$2 AND o.product_type='NUMBER_LEASE' AND o.sales_storefront_id='once'`,[id,userId]);if(!o)fail('ORDER_NOT_FOUND','Order not found',404);return purchaseView(o);}
  async checkPurchase(userId:string,id:string){const prior=await this.purchase(userId,id);if(!['PENDING','PROCESSING','UNCERTAIN'].includes(prior.status))return prior;if(!prior.reconcilable)fail('HISTORICAL_RECONCILIATION_REQUIRED','This historical order requires operator reconciliation');await this.fulfillment.runWhole(userId,id);return this.purchase(userId,id);}
  private async orderRows(userId:string,client:Pick<Database,'query'>=this.db){return (await client.query<OrderRow>(`SELECT ${orderFields} ${orderFrom} WHERE o.user_id=$1 AND o.product_type='NUMBER_LEASE' AND o.sales_storefront_id='once' ORDER BY o.created_at DESC,o.id ASC LIMIT 200`,[userId])).rows;}
  async orders(userId:string){return (await this.orderRows(userId)).map(billView);}
  async orderHistory(userId:string,raw:unknown){const q=historyQuery.parse(raw);if(q.leaseId)await this.detail(userId,q.leaseId);const scope=`orders:${userId}:${q.leaseId??'*'}`,p=historyPosition(q.cursor,scope);const {rows}=await this.db.query<OrderRow>(`SELECT ${orderFields} ${orderFrom} WHERE o.user_id=$1 AND o.product_type='NUMBER_LEASE' AND o.sales_storefront_id='once' AND ($2::uuid IS NULL OR o.lease_id=$2) AND ($3::timestamptz IS NULL OR o.created_at<$3 OR(o.created_at=$3 AND o.id>$4::uuid)) ORDER BY o.created_at DESC,o.id ASC LIMIT $5`,[userId,q.leaseId??null,p?.time??null,p?.id??null,q.limit+1]);const page=historyPage(rows,q.limit,scope);return {...page,items:page.items.map(billView)};}
  async adminAssign(actorId:string,numberId:string,raw:unknown,key:string){const input=assignSchema.parse(raw);return this.compensate(actorId,numberId,input,key,'ADMIN_ASSIGN');}
  async adminExtend(actorId:string,leaseId:string,raw:unknown,key:string){const input=extendSchema.parse(raw);return this.compensate(actorId,leaseId,input,key,'ADMIN_EXTEND');}
  private async compensate(actorId:string,target:string,input:z.infer<typeof assignSchema>|z.infer<typeof extendSchema>,key:string,action:'ADMIN_ASSIGN'|'ADMIN_EXTEND'){
    if(this.environment.siteId!=='once')fail('NOT_FOUND','Whole-number compensation is unavailable on this site',404);leaseKey.parse(key);if(input.amountMinor!==undefined&&input.amountMinor!==0)fail('POINTS_REQUIRED','Nonzero assignment requires the paid points flow');
    const payload={action,target,input};
    const reference=action==='ADMIN_EXTEND'?(await this.db.query<{user_id:string;number_id:string;currency:string|null}>('SELECT l.user_id,l.number_id,initial.currency FROM leases l JOIN orders initial ON initial.id=l.initial_order_id WHERE l.id=$1',[target])).rows[0]:null;
    if(action==='ADMIN_EXTEND'&&!reference)fail('LEASE_NOT_FOUND','Lease not found',404);
    const userId='userId' in input?input.userId:reference!.user_id,numberId=reference?.number_id??target;
    return this.db.transaction(async client=>{
      await client.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[actorId,userId]]);
      await requireLeaseAdmin(client,actorId);
      await lockPointAccount(client,userId,true);
      const prior=await this.adminReplay(client,actorId,action,key,payload);if(prior)return prior;
      if(!(await client.query("SELECT 1 FROM users WHERE id=$1 AND account_status='ACTIVE' AND auth_kind='LOCAL'",[userId])).rowCount)fail('SELF_SERVICE_ACCOUNT_REQUIRED','An active local self-service account is required',403);
      const days='term' in input?input.term:input.days,plan='term' in input?await quotedPlan(client,input.term,undefined,false):null;
      const leaseId=reference?target:null;
      const n=await this.stock.detail(numberId,client,true);
      const orderId=randomUUID();
      await insertLeaseOrder(client,{id:orderId,userId,number:n,plan,days,kind:action,leaseId,key:`admin:${actorId}:${action}:${key}`,payload,compensation:true,currency:reference?.currency});
      if(leaseId){const {rows:[l]}=await client.query<{status:string}>('SELECT status FROM leases WHERE id=$1 FOR UPDATE',[leaseId]);if(!l||!['ACTIVE','EXPIRED_HELD'].includes(l.status))fail('LEASE_NOT_RENEWABLE','Lease no longer held');}
      await assertWholeAvailable(client,n,leaseId,days,orderId);
      await client.query('INSERT INTO whole_number_reservations(number_id,order_id,lease_id) VALUES($1,$2,$3)',[numberId,orderId,leaseId]);
      const assigned=await this.whole.allocate(client,{id:orderId,user_id:userId,target_number_id:numberId,lease_id:leaseId,duration_days:days,operation_kind:action});
      if(!assigned)fail('RESOURCE_REQUIRES_RECONCILIATION','Resource cannot cover compensation');
      await client.query("UPDATE orders SET fulfillment_status='COMPLETED',completed_at=now() WHERE id=$1",[orderId]);
      const result={orderId,leaseId:assigned,number:n.phone_number,status:n.provider==='pingcode-mock'?'DEMO_CONFIRMED':'COMPLETED',settlementType:'COMPENSATION',points:0,amount:0};
      await audit(client,actorId,action,target,input.reason,null,{...result,note:input.note??null,days});
      await this.adminSave(client,actorId,action,key,target,payload,result);return result;
    });
  }
  async adminEnd(actorId:string,leaseId:string,reason:string,key:string){reason=z.string().trim().min(3).max(1000).parse(reason);leaseKey.parse(key);const action='ADMIN_END',payload={action,target:leaseId,input:{reason}};
    const {rows:[reference]}=await this.db.query<{user_id:string;number_id:string}>('SELECT user_id,number_id FROM leases WHERE id=$1',[leaseId]);if(!reference)fail('LEASE_NOT_FOUND','Lease not found',404);
    return this.db.transaction(async client=>{
      await client.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[actorId,reference.user_id]]);
      await requireLeaseAdmin(client,actorId);
      await lockPointAccount(client,reference.user_id,true);const prior=await this.adminReplay(client,actorId,action,key,payload);if(prior)return prior;
      // Pending orders are locked before the resource. Their existence blocks ending, including unknown results.
      const pending=await client.query("SELECT id FROM orders WHERE target_number_id=$1 AND fulfillment_status='PROCESSING' ORDER BY id FOR UPDATE",[reference.number_id]);
      if(pending.rows.length)await client.query('SELECT order_id FROM mock_fulfillment_operations WHERE order_id=ANY($1::uuid[]) ORDER BY order_id FOR UPDATE',[pending.rows.map((o:{id:string})=>o.id)]);
      await this.stock.detail(reference.number_id,client,true,false);
      const {rows:[lease]}=await client.query('SELECT * FROM leases WHERE id=$1 FOR UPDATE',[leaseId]);
      if(pending.rowCount||(await client.query('SELECT 1 FROM whole_number_reservations WHERE number_id=$1',[reference.number_id])).rowCount)fail('ORDER_PENDING','Resolve pending purchase before ending lease');
      if(!lease||!['ACTIVE','EXPIRED_HELD'].includes(lease.status))fail('LEASE_ALREADY_ENDED','Lease is already ended');
      await client.query('SELECT id FROM number_allocations WHERE lease_id=$1 ORDER BY id FOR UPDATE',[leaseId]);
      await client.query("UPDATE number_allocations SET released_at=GREATEST(assigned_at,LEAST(now(),expires_at)),release_reason='MANUAL' WHERE lease_id=$1 AND released_at IS NULL",[leaseId]);
      await client.query("UPDATE leases SET status='ENDED',ended_at=now(),updated_at=now() WHERE id=$1",[leaseId]);
      await client.query("UPDATE phone_numbers SET manual_hold=true,hold_reason='ADMIN_ENDED_REQUIRES_REVIEW',hold_updated_at=now() WHERE id=$1",[reference.number_id]);
      const result={id:leaseId,status:'ENDED',holdReason:'ADMIN_ENDED_REQUIRES_REVIEW'};await audit(client,actorId,action,leaseId,reason,lease,result);await this.adminSave(client,actorId,action,key,leaseId,payload,result);return result;
    });
  }
  private async adminReplay(client:PoolClient,actor:string,action:string,key:string,payload:unknown){const {rows:[p]}=await client.query('SELECT result,request_payload=$4::jsonb AS same FROM once_admin_idempotency WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3 FOR UPDATE',[actor,action,key,JSON.stringify(payload)]);if(p&&!p.same)fail('IDEMPOTENCY_CONFLICT','Administrator request changed');return p?.result;}
  private async adminSave(client:PoolClient,actor:string,action:string,key:string,target:string,payload:unknown,result:unknown){await client.query('INSERT INTO once_admin_idempotency(actor_id,action,idempotency_key,target_id,request_payload,result) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[actor,action,key,target,JSON.stringify(payload),JSON.stringify(result)]);}
}
