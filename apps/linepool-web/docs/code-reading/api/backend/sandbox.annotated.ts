/**
 * sandbox.ts 中文分区导读副本：本地演示沙盒接口
 * 原文件：backend/src/sandbox.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】提供本地模拟积分、订单履行和接收短信的入口。
 * 【为什么这样组织】开发时覆盖成功、失败、不确定状态；通过环境和本地隔离配置限制入口。
 * 【调用链】SandboxController → Sandbox.guard → 模拟业务服务。
 * 【修改提示】须非生产且 LOCAL_SANDBOX 开启，关闭返回 404；不应通过改守卫把模拟接口用于生产。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Body, Controller, Get, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../../../backend/src/database.js';
import { Environment } from '../../../../backend/src/environment.js';
import { ApiFailure, SchemaPipe } from '../../../../backend/src/http.js';
import { SessionGuard, type SessionRequest } from '../../../../backend/src/authentication.js';
import { ReceivingSync } from '../../../../backend/src/providers/receiving-sync.js';
import { MockFulfillment } from '../../../../backend/src/mock-fulfillment.js';
/**
 * outcome = 本地模拟结果规则：SUCCESS 成功、FAILED 失败、UNKNOWN 尚不能确认。
 */
const outcome = z.enum(['SUCCESS','FAILED','UNKNOWN']);
/**
 * inboundSchema = 模拟短信输入规则，标识事件、号码、可选平台分配和结果；resolve 用于明确处理先前未知的事件。
 * 字段速读：id 记录编号；numberId 号码编号；allocationId 号码分配记录编号。
 */
const inboundSchema=z.object({id:z.uuid(),numberId:z.uuid(),allocationId:z.uuid().optional(),outcome,resolve:z.boolean().optional()}).strict();
/**
 * fulfillmentSchema = 模拟订单履行输入规则，提交订单编号和期望模拟结果。
 */
const fulfillmentSchema=z.object({orderId:z.uuid(),outcome}).strict();

/**
 * ==================== 01 本地演示沙盒接口 / Sandbox ====================
 * Sandbox = 本地演示沙盒接口。提供本地模拟积分、订单履行和接收短信的入口。
 */
@Injectable()
export class Sandbox {
 /**
  * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
  */
 constructor(private readonly db:Database,private readonly environment:Environment,private readonly receiving:ReceivingSync){}
 /**
  * enabled = 本地沙盒是否开放。要求非生产且 LOCAL_SANDBOX 显式开启。
  */
 get enabled(){return this.environment.values.NODE_ENV !== 'production' && this.environment.values.LOCAL_SANDBOX;}
 /**
  * guard = 沙盒入口检查。关闭时返回 404，防止普通环境执行本地模拟操作。
  */
 private guard(){if(!this.enabled)throw new ApiFailure(404,'NOT_FOUND','Local sandbox is disabled');}
 /**
  * credit = 本地沙盒赠送积分，每用户一次 100 积分，写入赠送记录与积分流水；不是支付充值。
  */
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
 /**
  * fulfill = 确认订单属于当前用户后，领取模拟履行任务，再按 SUCCESS/FAILED/UNKNOWN 映射结果交给模拟器。
  */
 async fulfill(userId:string,input:z.infer<typeof fulfillmentSchema>){
  this.guard();const owned=await this.db.query('SELECT id FROM orders WHERE id=$1 AND user_id=$2',[input.orderId,userId]);
  if(!owned.rowCount)throw new ApiFailure(404,'ORDER_NOT_FOUND','Order not found');
  const simulator=new MockFulfillment(this.db),claim=await simulator.claim(input.orderId);
  return simulator.resolve(input.orderId,input.outcome==='SUCCESS'?'SUCCEEDED':input.outcome==='UNKNOWN'?'UNCERTAIN':'FAILED','Explicit local sandbox result',claim.token??undefined);
 }
 /**
  * inbound = 生成或解析本地模拟短信事件，检查号码的平台分配归属，成功场景再交 ReceivingSync 保存短信。
  */
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
    ON a.number_id=n.id AND a.released_at IS NULL
    WHERE n.id=$1 AND a.user_id=$2 AND a.expires_at>now() AND ($3::uuid IS NULL OR a.id=$3)
    FOR UPDATE OF n,a`,[input.numberId,userId,input.allocationId??null]);
   const number=numbers.length===1?numbers[0]:undefined;
   if(!number)throw new ApiFailure(409,'PROVIDER_ALLOCATION_INACTIVE','Choose one active platform service for this account');
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
/**
 * ==================== 02 本地演示沙盒接口 / SandboxController ====================
 * SandboxController = 本地沙盒接口入口。先检查登录，实际模拟操作仍由 Sandbox 的环境开关检查限制。
 */
@Controller('sandbox')
@UseGuards(SessionGuard)
export class SandboxController {
 /**
  * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
  */
 constructor(private readonly sandbox:Sandbox){}
 /**
  * status = 查询沙盒是否开放，关闭返回 404，开放返回 enabled:true。
  * 接口：GET /api/sandbox。
  */
 @Get()status(){if(!this.sandbox.enabled)throw new ApiFailure(404,'NOT_FOUND','Not found');return {data:{enabled:true}};}
 /**
  * credit = 本地沙盒赠送积分，每用户一次 100 积分，写入赠送记录与积分流水；不是支付充值。
  * 接口：POST /api/sandbox/credit。接收：登录用户与请求信息(r)。
  */
 @Post('credit')async credit(@Req()r:SessionRequest){return {data:await this.sandbox.credit(r.user.id)};}
 /**
  * fulfill = 确认订单属于当前用户后，领取模拟履行任务，再按 SUCCESS/FAILED/UNKNOWN 映射结果交给模拟器。
  * 接口：POST /api/sandbox/fulfill。接收：登录用户与请求信息(r)、请求体(input)。
  */
 @Post('fulfill')async fulfill(@Req()r:SessionRequest,@Body(new SchemaPipe(fulfillmentSchema))input:z.infer<typeof fulfillmentSchema>){return {data:await this.sandbox.fulfill(r.user.id,input)};}
 /**
  * inbound = 生成或解析本地模拟短信事件，检查号码的平台分配归属，成功场景再交 ReceivingSync 保存短信。
  * 接口：POST /api/sandbox/inbound。接收：登录用户与请求信息(r)、请求体(input)。
  */
 @Post('inbound')async inbound(@Req()r:SessionRequest,@Body(new SchemaPipe(inboundSchema))input:z.infer<typeof inboundSchema>){return {data:await this.sandbox.inbound(r.user.id,input)};}
}
