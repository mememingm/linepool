import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';

export const adminReason = z.string().trim().min(3).max(500);
export const adminKey = z.string().uuid();
export const adminId = z.string().uuid();
export const adminPage = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10),z.literal(20),z.literal(50)])).default(20), search: z.string().trim().max(200).default(''), status: z.string().max(40).default(''), userId: adminId.optional(), leaseId: adminId.optional(), provider: z.string().max(80).optional(), direction: z.enum(['INBOUND','OUTBOUND']).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), eventType: z.string().max(100).optional() });
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiFailure(400,'VALIDATION_ERROR','Invalid management request',result.error.flatten());
  return result.data;
}
export const missing = () => new ApiFailure(404,'NOT_FOUND','Management record not found');
export const conflict = (code: string, message: string) => new ApiFailure(409,code,message);
export type AdminConnection = Pick<Database,'query'>;

@Injectable()
export class OnceAdminOperations {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  site() {
    if (this.environment.siteId !== 'once' || this.environment.product !== 'NUMBER_LEASE' || !this.environment.isModuleEnabled('NUMBER_LEASE')) {
      throw new ApiFailure(404, 'MODULE_DISABLED', 'ONCE administration is unavailable on this site');
    }
  }
  async authorize(actorId: string) {
    this.site();
    parse(adminId, actorId);
    const { rowCount } = await this.db.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE'", [actorId]);
    if (!rowCount) throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Active administrator access is required');
  }
  get provider() { return this.environment.pcProvider; }
  requireMock() {
    if (this.provider !== 'pingcode-mock') throw conflict('ONCE_MOCK_DISABLED', 'Manual Mock resource and integration controls require Mock mode');
  }
  async findAccount(client: AdminConnection = this.db) {
    this.site();
    const { rows: [account] } = await client.query<{id:string;provider:string;external_account_id:string;status:string;auth_status:string;access_expires_at:Date|null;capabilities:string[];enabled_capabilities:string[];problem:string|null}>(`SELECT a.id,a.provider,a.external_account_id,a.status,a.auth_status,a.access_expires_at,a.capabilities,a.enabled_capabilities,a.problem FROM upstream_accounts a JOIN storefronts s ON s.id=a.storefront_id
      WHERE a.provider=$2 AND a.external_account_id=$1 AND a.storefront_id='once'
        AND a.application_id=$3 AND a.issuer=$4 AND a.owner_kind='SELF_SERVICE' AND a.agent_id IS NULL AND NOT a.historical_only AND s.product='NUMBER_LEASE'`,[this.environment.selfServiceExternalAccountId,this.provider,this.environment.values.PC_APPLICATION_ID,this.environment.values.PC_ISSUER]);
    return account ?? null;
  }
  async account(client: AdminConnection = this.db) {
    const account = await this.findAccount(client);
    if (!account) throw conflict('ONCE_ACCOUNT_UNAVAILABLE','Trusted ONCE account is not configured');
    return account;
  }
  async readAccounts(client: AdminConnection = this.db) {
    this.site();
    const { rows } = await client.query<{id:string}>(`SELECT a.id FROM upstream_accounts a JOIN storefronts s ON s.id=a.storefront_id
      WHERE a.storefront_id='once' AND s.product='NUMBER_LEASE' AND a.owner_kind='SELF_SERVICE' AND a.agent_id IS NULL
        AND (a.historical_only OR (NOT a.historical_only AND a.provider IN ('pingcode-mock','pingcode') AND a.external_account_id=$1))
      ORDER BY a.id`, [this.environment.selfServiceExternalAccountId]);
    return rows.map(account=>account.id);
  }
  async actor(client: AdminConnection, actorId: string) {
    this.site();
    parse(adminId, actorId);
    const {rowCount} = await client.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' FOR UPDATE",[actorId]);
    if (!rowCount) throw new ApiFailure(403,'ADMIN_REQUIRED','Active administrator access is required');
  }
  async audit(client: AdminConnection, actorId: string, action: string, target: string, reason: string, before: unknown, after: unknown) {
    await client.query('INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',[actorId,action,target,reason,JSON.stringify(before),JSON.stringify(after)]);
  }
  private async claim(client: PoolClient, actorId: string, action: string, target: string, input: Record<string,unknown>, keyInput: unknown) {
    const key = parse(adminKey,keyInput), reason = parse(adminReason,input.reason);
    await this.actor(client,actorId);
    const payload = {actorId,action,target,reason,input:{...input,reason}};
    const prior = await client.query<{result:unknown;matches:boolean;pending:boolean}>(`SELECT result,request_payload=$4::jsonb AS matches,result IS NULL AS pending FROM once_admin_idempotency WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3 FOR UPDATE`,[actorId,action,key,JSON.stringify(payload)]);
    if (prior.rows[0]) {
      if (!prior.rows[0].matches) throw conflict('IDEMPOTENCY_CONFLICT','Operation key has different action, target or parameters');
      if (prior.rows[0].pending) throw conflict('IDEMPOTENCY_IN_PROGRESS','Operation outcome is pending; inspect the target before retrying');
      return {key,reason,replay:true,result:prior.rows[0].result};
    }
    // A key cannot silently replay an unrelated operation for the same actor.
    const reused = await client.query('SELECT 1 FROM once_admin_idempotency WHERE actor_id=$1 AND idempotency_key=$2 AND action<>$3',[actorId,key,action]);
    if (reused.rowCount) throw conflict('IDEMPOTENCY_CONFLICT','Operation key has already been used for another action');
    return {key,reason,payload,replay:false,result:null};
  }
  async mutate<T>(actorId:string,action:string,target:string,input:Record<string,unknown>,key:unknown,work:(client:PoolClient,reason:string)=>Promise<T>,audit=true,onReplay?:(client:PoolClient,result:T)=>Promise<void>):Promise<T> {
    return this.db.transaction(async client=>{
      const claim=await this.claim(client,actorId,action,target,input,key);
      if(claim.replay) { if(onReplay) await onReplay(client,claim.result as T); return claim.result as T; }
      const result=await work(client,claim.reason);
      if(audit) await this.audit(client,actorId,action,target,claim.reason,null,result);
      await client.query('INSERT INTO once_admin_idempotency(actor_id,action,idempotency_key,target_id,request_payload,result) VALUES($1,$2,$3,$4,$5,$6)',[actorId,action,claim.key,target,claim.payload,JSON.stringify(result)]);
      return result;
    });
  }
  async external<T>(actorId:string,action:string,target:string,input:Record<string,unknown>,key:unknown,work:()=>Promise<T>):Promise<T> {
    const claim=await this.db.transaction(async client=>{
      const claimed=await this.claim(client,actorId,action,target,input,key);
      if(!claimed.replay) await client.query('INSERT INTO once_admin_idempotency(actor_id,action,idempotency_key,target_id,request_payload,result) VALUES($1,$2,$3,$4,$5,NULL)',[actorId,action,claimed.key,target,claimed.payload]);
      return claimed;
    });
    if(claim.replay) return claim.result as T;
    try {
      const result=await work();
      await this.db.transaction(async client=>{
        await this.audit(client,actorId,action,target,claim.reason,null,result);
        await client.query('UPDATE once_admin_idempotency SET result=$4 WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3',[actorId,action,claim.key,JSON.stringify(result)]);
      });
      return result;
    } catch(error) {
      // The durable claim prevents an uncertain completed external action from executing twice.
      await this.db.transaction(client=>this.audit(client,actorId,action,target,claim.reason,null,{outcome:'UNCONFIRMED',code:error instanceof ApiFailure?'BUSINESS_FAILURE':'OPERATION_FAILED'}));
      throw error;
    }
  }
}
