import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { Database } from '../database.js';
import { Administration } from '../administration.js';
import { ApiFailure } from '../http.js';
import { adminPasswordResetInputSchema, userStatusInputSchema } from '@linepool/contracts/admin';
import { OnceLeases } from './leases.js';
import { OnceLeasePlans } from './lease-plans.js';
import { OnceMessages } from './messages.js';
import { OnceAdminViews, onceNumberReferences } from './admin-views.js';
import { OnceAdminOperations, adminId, adminKey, adminReason, conflict, missing, parse } from './admin-operations.js';

const reasonBody=z.strictObject({reason:adminReason});
const numberFields={number:z.string().trim().min(1).max(40),countryCode:z.enum(['US','CA']),regionId:z.string().trim().toLowerCase().regex(/^[a-z]{2,8}$/),regionName:z.string().trim().min(1).max(40),note:z.string().trim().max(200).default(''),providerNumberId:z.string().trim().min(1).max(200).optional(),resourceExpiresAt:z.iso.datetime({offset:true})};
const numberCreate=z.strictObject({...numberFields,reason:adminReason});
const numberEdit=z.strictObject({...numberFields,number:numberFields.number.optional(),providerNumberId:numberFields.providerNumberId,resourceExpiresAt:numberFields.resourceExpiresAt.optional(),reason:adminReason});
const planBody=z.strictObject({days:z.number().int().min(1).max(365),priceMinor:z.number().int().min(0).max(100000000),pointsPrice:z.number().int().positive().max(2147483647),currency:z.string().regex(/^[A-Z]{3}$/),label:z.string().trim().min(1).max(20),note:z.string().trim().max(60).default(''),active:z.boolean(),sortOrder:z.number().int().min(-10000).max(10000).default(0),version:z.number().int().positive().optional(),reason:adminReason});
const compensation={amountMinor:z.literal(0).optional(),note:z.string().trim().max(200).optional(),reason:adminReason};
type AdminNumberInput = z.infer<typeof numberCreate> & {providerNumberId:string};
function normalizeNumber(value:string) {
  let digits=value.replace(/[\s()+_-]/g,''); if(digits.length===10) digits='1'+digits;
  if(!/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) throw new ApiFailure(400,'VALIDATION_ERROR','Expected a valid North American telephone number');
  return '+'+digits;
}
function normalized(input:z.infer<typeof numberCreate>):AdminNumberInput {
  const number=normalizeNumber(input.number);
  return {...input,number,providerNumberId:input.providerNumberId??`once-manual:${number}`};
}

@Injectable()
export class OnceAdmin {
  constructor(private readonly db:Database,private readonly core:Administration,private readonly operations:OnceAdminOperations,private readonly views:OnceAdminViews,
    private readonly leases:OnceLeases,private readonly leasePlans:OnceLeasePlans,private readonly messages:OnceMessages) {}
  list(section:string,query:Record<string,unknown>) {return section==='webhooks'?this.messages.adminEvents(query):this.views.list(section,query);}
  async detail(section:'users'|'numbers'|'leases'|'orders',id:string) {
    parse(adminId,id); const row=await this.views.record(section,id);
    if(section==='orders') return row;
    if(section==='users') {const [leases,orders]=await Promise.all([this.views.list('leases',{userId:id,pageSize:50}),this.views.list('orders',{userId:id,pageSize:50})]);return {user:row,leases:leases.items,orders:orders.items};}
    if(section==='numbers') {
      const {rows}=await this.db.query<{id:string}>(`SELECT id FROM leases WHERE number_id=$1 ORDER BY created_at DESC,id`,[id]);
      const leases=await Promise.all(rows.map(l=>this.views.record('leases',l.id)));return {number:row,leases};
    }
    const [orders,messages,periods]=await Promise.all([this.views.list('orders',{leaseId:id,pageSize:50}),this.views.list('messages',{leaseId:id,pageSize:20}),this.views.periods(id)]);
    return {lease:row,orders:orders.items,messages:messages.items,periods};
  }
  async summary() {
    const [account,accountIds]=await Promise.all([this.operations.findAccount(),this.operations.readAccounts()]);
    const [numbers,leases,orders,webhooks,stock]=await Promise.all([this.views.list('numbers',{pageSize:10}),this.views.list('leases',{status:'EXPIRING',pageSize:10}),this.views.list('orders',{pageSize:10}),this.messages.adminEventSummary(),this.numberStats()]);
    const {rows:[counts]}=await this.db.query(`SELECT (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM leases l JOIN phone_numbers n ON n.id=l.number_id WHERE n.upstream_account_id=ANY($1::uuid[]) AND l.status='ACTIVE' AND EXISTS(SELECT 1 FROM number_allocations p WHERE p.lease_id=l.id AND p.assigned_at<=now() AND p.expires_at>now() AND (p.released_at IS NULL OR p.released_at>now()))) AS "activeLeases",
      (SELECT count(*)::int FROM orders o JOIN phone_numbers n ON n.id=o.target_number_id WHERE n.upstream_account_id=ANY($1::uuid[]) AND o.sales_storefront_id='once' AND o.product_type='NUMBER_LEASE' AND o.created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS "todayOrders",
      (SELECT count(*)::int FROM outbound_messages m JOIN phone_numbers n ON n.id=m.number_id WHERE n.upstream_account_id=ANY($1::uuid[]) AND m.status IN ('FAILED','UNCERTAIN')) AS "failedOutbound",
      (SELECT count(*)::int FROM orders o JOIN phone_numbers n ON n.id=o.target_number_id LEFT JOIN mock_fulfillment_operations op ON op.order_id=o.id WHERE n.upstream_account_id=ANY($1::uuid[]) AND o.sales_storefront_id='once' AND o.product_type='NUMBER_LEASE' AND (o.fulfillment_status IN ('PROCESSING','FAILED') OR op.status='UNCERTAIN')) AS "uncertainOrders"`,[accountIds]);
    return {...counts,availableNumbers:stock.reduce((sum,r)=>sum+r.available,0),heldNumbers:stock.reduce((sum,r)=>sum+r.held,0),expiredHeldNumbers:stock.reduce((sum,r)=>sum+r.expiredHeld,0),unavailableNumbers:stock.reduce((sum,r)=>sum+r.unavailable,0),lowStock:stock.filter(r=>r.available<=3),lowStockThreshold:3,todayRevenueMinor:null,revenueAvailable:false,currency:null,cashRefundAvailable:false,sourceBreakdownAvailable:false,recentOrders:orders.items.slice(0,6),expiring:leases.items.slice(0,6),expiringLeases:leases.totalItems,failedWebhooks:(webhooks.counts.FAILED??0)+(webhooks.counts.QUARANTINED??0),webhooks,inventoryTotal:numbers.totalItems,integrations:{demoMode:this.operations.provider==='pingcode-mock',pingcodeConfigured:account!==null,pingcodeEnabled:account?.status==='ACTIVE',pingcodeAuthorized:account?.status==='ACTIVE'&&account.auth_status==='ACTIVE'&&account.access_expires_at!==null&&account.access_expires_at.getTime()>Date.now(),receiveWebhookConfigured:false,receivingMode:'worker-polling',paymentsConnected:false}};
  }
  numberStats() { return this.views.numberStats(); }
  async userStatus(actorId:string,id:string,body:unknown,key:unknown) {const input=parse(userStatusInputSchema,body);return this.operations.mutate(actorId,'ONCE_USER_STATUS',id,input,key,client=>this.core.userStatus(actorId,id,input,client));}
  async resetPassword(actorId:string,id:string,body:unknown,key:unknown) {
    const input=parse(adminPasswordResetInputSchema,body);
    const result=await this.operations.mutate(actorId,'ONCE_USER_PASSWORD_RESET',id,{reason:input.reason},key,async client=>{
      const changed=await this.core.resetPassword(actorId,id,input,client);
      const {rows:[credential]}=await client.query<{password_hash:string}>('SELECT password_hash FROM users WHERE id=$1',[id]);
      if(!credential) throw missing();
      await this.operations.audit(client,actorId,'ONCE_USER_PASSWORD_RESET',id,input.reason,null,changed);
      return {...changed,credentialVerifier:credential.password_hash};
    },false,async(_client,accepted)=>{
      if(typeof accepted.credentialVerifier!=='string'||!await compare(input.newPassword,accepted.credentialVerifier)) {
        throw conflict('IDEMPOTENCY_CONFLICT','Password request differs from the accepted operation');
      }
    });
    return {changed:result.changed};
  }
  plans(){return this.leasePlans.list(true);}
  savePlan(actorId:string,id:string|null,body:unknown,key:unknown) {const input=parse(planBody,body);parse(adminKey,key);if(id&&!input.version)throw conflict('QUOTE_VERSION_REQUIRED','Current plan version is required');return this.leasePlans.save(actorId,id,{...input,idempotencyKey:key as string});}
  async settings(){this.operations.site();const {rows:[row]}=await this.db.query('SELECT cooldown_days AS "cooldownDays",version,updated_at AS "updatedAt" FROM once_settings WHERE storefront_id=\'once\'');return row??{cooldownDays:null,version:0,updatedAt:null};}
  updateSettings(actorId:string,body:unknown,key:unknown) {
    const input=parse(z.strictObject({cooldownDays:z.number().int().min(0).max(365).nullable(),version:z.number().int().nonnegative(),reason:adminReason}),body);
    return this.operations.mutate(actorId,'ONCE_SETTINGS_UPDATE','once',input,key,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['once:settings']);
      const {rows:[current]}=await client.query<{version:number}>('SELECT version FROM once_settings WHERE storefront_id=\'once\' FOR UPDATE');
      if((current?.version??0)!==input.version)throw conflict('SETTINGS_VERSION_CONFLICT','Settings changed; reload before saving');
      const {rows:[row]}=await client.query(`INSERT INTO once_settings(storefront_id,cooldown_days,version,updated_by) VALUES('once',$1,1,$2) ON CONFLICT(storefront_id) DO UPDATE SET cooldown_days=excluded.cooldown_days,version=once_settings.version+1,updated_by=excluded.updated_by,updated_at=now() RETURNING cooldown_days AS "cooldownDays",version,updated_at AS "updatedAt"`,[input.cooldownDays,actorId]);return row;
    });
  }
  assignNumber(actorId:string,id:string,body:unknown,key:unknown) {const input=parse(z.strictObject({userId:adminId,term:z.number().int().min(1).max(365),...compensation}),body);parse(adminKey,key);return this.leases.adminAssign(actorId,id,input,key as string);}
  extendLease(actorId:string,id:string,body:unknown,key:unknown) {const input=parse(z.strictObject({days:z.number().int().min(1).max(365),...compensation}),body);parse(adminKey,key);return this.leases.adminExtend(actorId,id,input,key as string);}
  endLease(actorId:string,id:string,body:unknown,key:unknown) {const input=parse(reasonBody,body);parse(adminKey,key);return this.leases.adminEnd(actorId,id,input.reason,key as string);}
  webhookSummary(){return this.messages.adminEventSummary();}
  webhookDetail(id:string){return this.messages.adminEvent(id);}
  async retryWebhook(actorId:string,id:string,body:unknown,key:unknown) {
    const input=parse(reasonBody,body),account=await this.operations.account();
    const event=await this.db.query('SELECT 1 FROM provider_event_receipts WHERE id=$1 AND upstream_account_id=$2 AND provider=$3',[id,account.id,this.operations.provider]);
    if(!event.rowCount) throw missing();
    return this.operations.external(actorId,'ONCE_WEBHOOK_RETRY',id,input,key,()=>this.messages.adminRetry(actorId,id,input.reason));
  }
  private numberInput(body:unknown):AdminNumberInput {this.operations.requireMock();return normalized(parse(numberCreate,body));}
  private async insertNumber(client:PoolClient,input:AdminNumberInput) {
    this.operations.requireMock();
    const account=await this.operations.account(client);if(account.status!=='ACTIVE')throw conflict('ONCE_ACCOUNT_UNAVAILABLE','Trusted ONCE account is inactive');
    if(Date.parse(input.resourceExpiresAt)<=Date.now())throw conflict('RESOURCE_EXPIRED','Mock resources require an explicit future expiry');
    const collision=await client.query(`SELECT 1 FROM phone_numbers WHERE phone_number=$1 UNION ALL SELECT 1 FROM provider_resource_bindings WHERE provider='pingcode-mock' AND external_number_id=$2`,[input.number,input.providerNumberId]);
    if(collision.rowCount)throw conflict('NUMBER_EXISTS','Number or global external resource ID already exists');
    const id=randomUUID(),metadata={regionId:input.regionId,regionName:input.regionName,note:input.note,source:'ADMIN'};
    try {
      await client.query(`INSERT INTO phone_numbers(id,region_id,phone_number,upstream_account_id,capability,resource_status,resource_expires_at,display_metadata,pc_capabilities) VALUES($1,$2,$3,$4,$7,'ONLINE',$5,$6,$8)`,[id,input.countryCode.toLowerCase(),input.number,account.id,input.resourceExpiresAt,metadata,account.capabilities.includes('SEND_SMS')?'SEND_RECEIVE':'RECEIVE',account.capabilities.filter(capability=>['NUMBER_LEASE','SEND_SMS'].includes(capability))]);
      await client.query(`INSERT INTO provider_resource_bindings(provider,external_number_id,number_id,external_project_id) VALUES('pingcode-mock',$1,$2,NULL)`,[input.providerNumberId,id]);
    } catch(error) {
      if (typeof error==='object' && error!==null && 'code' in error && error.code==='23505') throw conflict('NUMBER_EXISTS','Number or global external resource ID already exists');
      throw error;
    }
    return {id,number:input.number,providerNumberId:input.providerNumberId,resourceExpiresAt:input.resourceExpiresAt,...metadata,countryCode:input.countryCode,provider:'pingcode-mock',mock:true};
  }
  createNumber(actorId:string,body:unknown,key:unknown) {const input=this.numberInput(body);return this.operations.mutate(actorId,'ONCE_NUMBER_CREATE',input.number,input,key,client=>this.insertNumber(client,input));}
  async previewImport(body:unknown) {
    this.operations.requireMock();
    await this.operations.account();
    const input=parse(z.strictObject({rows:z.array(z.unknown()).min(1).max(1000)}),body);
    const candidates:{line:number;row:AdminNumberInput}[]=[],errors:{line:number;message:string}[]=[],seenNumbers=new Set<string>(),seenExternal=new Set<string>();
    for(const [index,row] of input.rows.entries()) {
      try {
        const parsed=this.numberInput({...row as Record<string,unknown>,reason:'Import preview'});
        if(Date.parse(parsed.resourceExpiresAt)<=Date.now()) throw conflict('RESOURCE_EXPIRED','Mock resources require a future expiry');
        if(seenNumbers.has(parsed.number)||seenExternal.has(parsed.providerNumberId)) throw conflict('NUMBER_EXISTS','Duplicate number or external ID in import');
        seenNumbers.add(parsed.number);seenExternal.add(parsed.providerNumberId);candidates.push({line:index+1,row:parsed});
      } catch { errors.push({line:index+1,message:'Invalid number metadata, expiry or duplicate identity'}); }
    }
    const existing=await this.db.query<{phone_number:string;external_number_id:string|null}>(`SELECT n.phone_number,b.external_number_id FROM phone_numbers n LEFT JOIN provider_resource_bindings b ON b.number_id=n.id WHERE n.phone_number=ANY($1::text[]) OR (b.provider='pingcode-mock' AND b.external_number_id=ANY($2::text[]))`,[[...seenNumbers],[...seenExternal]]);
    const numbers=new Set(existing.rows.map(row=>row.phone_number)),external=new Set(existing.rows.map(row=>row.external_number_id));
    const valid:Omit<AdminNumberInput,'reason'>[]=[];
    for(const {line,row} of candidates) {
      if(numbers.has(row.number)||external.has(row.providerNumberId)) errors.push({line,message:'Number or external ID already exists'});
      else {const {reason:_,...item}=row;valid.push(item);}
    }
    return {valid,errors:errors.sort((a,b)=>a.line-b.line)};
  }
  importNumbers(actorId:string,body:unknown,key:unknown) {
    const input=parse(z.strictObject({rows:z.array(z.unknown()).min(1).max(1000),reason:adminReason}),body);
    const rows=input.rows.map(row=>this.numberInput({...row as Record<string,unknown>,reason:input.reason}));
    return this.operations.mutate(actorId,'ONCE_NUMBER_IMPORT','import',{...input,rows},key,async(client,reason)=>{const ids:string[]=[];for(const row of rows){const created=await this.insertNumber(client,row);ids.push(created.id);await this.operations.audit(client,actorId,'ONCE_NUMBER_CREATE',created.id,reason,null,created);}return {created:ids.length,ids};});
  }
  private async lockedNumber(client:PoolClient,id:string) {const account=await this.operations.account(client);const {rows:[row]}=await client.query(`SELECT n.*,b.external_number_id FROM phone_numbers n LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=$3 WHERE n.id=$1 AND n.upstream_account_id=$2 FOR UPDATE OF n`,[id,account.id,this.operations.provider]);if(!row)throw missing();return row;}
  async updateNumber(actorId:string,id:string,body:unknown,key:unknown) {
    const input=parse(numberEdit,body);
    if(input.resourceExpiresAt)this.operations.requireMock();
    return this.operations.mutate(actorId,'ONCE_NUMBER_UPDATE',id,input,key,async client=>{const before=await this.lockedNumber(client,id);
      if(input.number&&normalizeNumber(input.number)!==before.phone_number||input.providerNumberId&&input.providerNumberId!==before.external_number_id||input.countryCode.toLowerCase()!==before.region_id)throw conflict('RESOURCE_IDENTITY_IMMUTABLE','Number, country, account and external identity cannot be rebound');
      const metadata={...before.display_metadata,regionId:input.regionId,regionName:input.regionName,note:input.note};
      if(input.resourceExpiresAt) {
        this.operations.requireMock();
        if(Date.parse(input.resourceExpiresAt)<=Date.now()) throw conflict('RESOURCE_EXPIRED','Mock resources require an explicit future expiry');
        const coverage=await client.query(`SELECT 1 FROM number_allocations WHERE number_id=$1 AND LEAST(expires_at,COALESCE(released_at,expires_at))>$2::timestamptz LIMIT 1`,[id,input.resourceExpiresAt]);
        if(coverage.rowCount) throw conflict('RESOURCE_COVERAGE_INSUFFICIENT','Mock expiry cannot truncate already granted service');
      }
      await client.query('UPDATE phone_numbers SET display_metadata=$2,resource_expires_at=COALESCE($3::timestamptz,resource_expires_at) WHERE id=$1',[id,metadata,input.resourceExpiresAt??null]);return {id,number:before.phone_number,...metadata,resourceExpiresAt:input.resourceExpiresAt??before.resource_expires_at};
    });
  }
  private async lockOwners(client:PoolClient,ids:string[]) {await client.query(`SELECT u.id FROM users u WHERE u.id IN (SELECT l.user_id FROM leases l WHERE l.number_id=ANY($1::uuid[])) ORDER BY u.id FOR UPDATE`,[ids]);}
  private async changeHold(client:PoolClient,id:string,hold:boolean,reason:string) {
    const before=await this.lockedNumber(client,id);
    const pending=await client.query(`SELECT 1 FROM whole_number_reservations WHERE number_id=$1 UNION ALL SELECT 1 FROM orders o LEFT JOIN mock_fulfillment_operations operation ON operation.order_id=o.id WHERE o.target_number_id=$1 AND (o.fulfillment_status='PROCESSING' OR operation.status IN ('PENDING','PROCESSING','UNCERTAIN'))`,[id]);
    const active=await client.query(`SELECT 1 FROM number_allocations WHERE number_id=$1 AND LEAST(expires_at,COALESCE(released_at,expires_at))>GREATEST(assigned_at,now())`,[id]);
    if(pending.rowCount||active.rowCount)throw conflict('NUMBER_IN_USE','Number has active/future service or an unresolved order');
    let releasedLeaseIds:string[]=[];
    if(!hold) {
      const released=await client.query<{id:string}>(`UPDATE leases SET status='RELEASED',released_at=now(),updated_at=now() WHERE number_id=$1 AND status IN ('ACTIVE','EXPIRED_HELD') RETURNING id`,[id]);
      releasedLeaseIds=released.rows.map(lease=>lease.id);
    } else {
      const retained=await client.query("SELECT 1 FROM leases WHERE number_id=$1 AND status IN ('ACTIVE','EXPIRED_HELD')",[id]);
      if(retained.rowCount) throw conflict('NUMBER_IN_USE','Number remains held by its lease');
    }
    await client.query('UPDATE phone_numbers SET manual_hold=$2,hold_reason=$3,hold_updated_at=now() WHERE id=$1',[id,hold,hold?reason:null]);
    return {id,number:before.phone_number,hold,holdReason:hold?reason:null,releasedLeaseIds,previousHold:before.manual_hold,previousHoldReason:before.hold_reason};
  }
  holdNumber(actorId:string,id:string,body:unknown,key:unknown) {const input=parse(z.strictObject({hold:z.boolean(),reason:adminReason}),body);return this.operations.mutate(actorId,'ONCE_NUMBER_HOLD',id,input,key,async(client,reason)=>{await this.lockOwners(client,[id]);return this.changeHold(client,id,input.hold,reason);});}
  batchNumbers(actorId:string,body:unknown,key:unknown) {
    const input=parse(z.strictObject({ids:z.array(adminId).min(1).max(200),action:z.enum(['hold','release']),reason:adminReason}),body);
    const ids=[...new Set(input.ids)].sort();
    return this.operations.mutate(actorId,input.action==='hold'?'ONCE_NUMBER_HOLD_BATCH':'ONCE_NUMBER_RELEASE_BATCH','batch',{...input,ids},key,async(client,reason)=>{
      await this.lockOwners(client,ids);
      const changed:string[]=[],skipped:{id:string;number:string;message:string}[]=[];
      for(const id of ids) {
        let number='';
        try {
          const row=await this.lockedNumber(client,id);number=row.phone_number;
          if(input.action==='hold'&&row.manual_hold) {skipped.push({id,number,message:'Already on hold'});continue;}
          const result=await this.changeHold(client,id,input.action==='hold',reason);
          changed.push(id);
          await this.operations.audit(client,actorId,input.action==='hold'?'ONCE_NUMBER_HOLD':'ONCE_NUMBER_RELEASE',id,reason,{hold:row.manual_hold,holdReason:row.hold_reason},result);
        } catch(error) {
          if(error instanceof ApiFailure && [404,409].includes(error.getStatus())) {
            const response=error.getResponse() as {error:{message:string}};
            skipped.push({id,number,message:response.error.message});
          } else throw error;
        }
      }
      return {changed:changed.length,ids:changed,skipped};
    });
  }
  deleteNumber(actorId:string,id:string,body:unknown,key:unknown) {
    const input=parse(reasonBody,body);
    return this.operations.mutate(actorId,'ONCE_NUMBER_DELETE',id,input,key,async client=>{
      const before=await this.lockedNumber(client,id);
      const refs=await client.query(`SELECT 1 FROM phone_numbers n WHERE n.id=$1 AND (${onceNumberReferences})`,[id]);
      if(refs.rowCount) throw conflict('NUMBER_IN_USE','Referenced resources cannot be deleted; place the number on hold');
      await client.query('DELETE FROM provider_resource_bindings WHERE number_id=$1',[id]);
      await client.query('DELETE FROM phone_numbers WHERE id=$1',[id]);
      return {id,number:before.phone_number};
    });
  }
}
