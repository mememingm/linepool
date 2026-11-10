import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Lease, PhoneNumber, Order } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DbService } from './db.service';
import { settings } from './config';
import { smsCapability } from './pingcode.client';
import { FulfillmentService } from './fulfillment.service';
import { cursorPosition, day, idempotencyKey, lockPhone, lockUser, pageResult, planFor, transactionOptions } from './business';

export type LeaseNumber = Lease & { phoneNumber: PhoneNumber };
type MutationInput = {kind:'RENT';number:string;term:number}|{kind:'RENEW';leaseId:string;term:number};
const messageSelect = {id:true,sender:true,title:true,body:true,code:true,receivedAt:true,readAt:true} as const;
const orderInclude = {lease:{include:{phoneNumber:true}}} as const;
export function leaseView(lease: LeaseNumber) {
  const expired = lease.expiresAt.getTime() <= Date.now();
  return { id: lease.id, number: lease.phoneNumber.number, countryCode: lease.phoneNumber.countryCode,
    countryName: lease.phoneNumber.countryName, regionName: lease.phoneNumber.regionName,
    term: lease.termDays, price: lease.priceMinor / 100, currency: lease.currency,
    startedAt: lease.startedAt, expiresAt: lease.expiresAt, demo: lease.phoneNumber.provider === 'demo', smsSend: smsCapability(lease),
    status: lease.status === 'ACTIVE' && expired ? 'EXPIRED_HELD' : lease.status,
    holdReason: lease.status === 'EXPIRED_HELD' || (lease.status === 'ACTIVE' && expired) ? 'EXPIRY_RELEASE_RULES_UNCONFIRMED' : lease.phoneNumber.holdReason };
}
export function billView(order: Order & {lease: LeaseNumber | null}) {
  return {id:order.id,leaseId:order.leaseId,kind:order.kind==='RENT'?'号码租赁':'同号续费',
    number:order.numberSnapshot ?? order.lease?.phoneNumber.number ?? null,
    term:order.termDays,amount:order.amountMinor/100,currency:order.currency,points:order.pointsAmount,settlementType:order.settlementType,fundsStatus:order.fundsStatus,
    status:order.status==='DEMO_CONFIRMED'?'演示已确认':order.status,createdAt:order.createdAt};
}
export function assertActive(lease: LeaseNumber, now: Date) {
  if (lease.status !== 'ACTIVE' || !lease.phoneNumber.occupied || lease.phoneNumber.provider !== 'demo' || lease.phoneNumber.holdReason ||
      lease.startedAt > now || lease.expiresAt <= now || lease.expiresAt <= lease.startedAt) throw new ConflictException('Lease is not active or no longer owns this number');
}

@Injectable()
export class LeasesService {
  constructor(private readonly db: DbService, private readonly fulfillment: FulfillmentService) {}
  private demoOnly() {
    if (!settings.demo) throw new ForbiddenException('Demo operations are disabled. No live provider or payment is connected.');
  }
  /** Plans customers can buy, in the operator's sort order. */
  async plans() {
    const rows = await this.db.plan.findMany({where:{active:true},orderBy:[{sortOrder:'asc'},{days:'asc'}]});
    return rows.map(plan => ({days:plan.days,price:plan.priceMinor/100,pointsPrice:plan.pointsPrice,version:plan.version,currency:plan.currency,label:plan.label,note:plan.note}));
  }
  async inventory() {
    if (!settings.demo) return [];
    return this.db.phoneNumber.findMany({where:{occupied:false,holdReason:null,provider:'demo'},
      select:{id:true,number:true,countryCode:true,countryName:true,regionId:true,regionName:true},orderBy:{number:'asc'}});
  }
  async list(userId: string) {
    return (await this.db.lease.findMany({where:{userId},include:{phoneNumber:true},orderBy:[{createdAt:'desc'},{id:'asc'}]})).map(leaseView);
  }
  async owned(userId: string, id: string) {
    const lease = await this.db.lease.findFirst({where:{id,userId},include:{phoneNumber:true}});
    if (!lease) throw new NotFoundException('Lease not found');
    return {...lease,status:lease.status==='ACTIVE' && lease.expiresAt<=new Date()?'EXPIRED_HELD':lease.status};
  }
  async snapshot(userId: string, selectedId?: string) {
    // One read snapshot keeps counts and truncation flags consistent during concurrent inserts.
    return this.db.$transaction(async tx => {
      const leases = (await tx.lease.findMany({where:{userId},include:{phoneNumber:true},orderBy:[{createdAt:'desc'},{id:'asc'}]})).map(leaseView);
      if (selectedId && !leases.some(lease => lease.id === selectedId)) throw new NotFoundException('Lease not found');
      const lease = selectedId ? leases.find(item => item.id === selectedId)! : leases[0] || null;
      const messages = lease ? await tx.message.findMany({where:{leaseId:lease.id},orderBy:[{receivedAt:'desc'},{id:'asc'}],take:200,select:messageSelect}) : [];
      const orders = await tx.order.findMany({where:{userId},include:orderInclude,orderBy:[{createdAt:'desc'},{id:'asc'}],take:200});
      const billsCount = await tx.order.count({where:{userId}});
      const messageCount = lease ? await tx.message.count({where:{leaseId:lease.id}}) : 0;
      return {lease,leases,messageCount,billsCount,messages,bills:orders.map(billView),demo:settings.demo,
        truncated:{messages:messageCount>messages.length,bills:billsCount>orders.length}};
    }, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async rent(userId: string, number: string, term: number, key: unknown, quoteVersion: number, purchaseIntentId?: string) {
    const order = await this.fulfillment.purchase(userId, {kind:'RENT',number,term,quoteVersion,purchaseIntentId}, key);
    return order.status === 'PENDING' ? this.fulfillment.run(userId, order.orderId) : order;
  }
  async renew(userId: string, id: string, term: number, key: unknown, quoteVersion: number, purchaseIntentId?: string) {
    const order = await this.fulfillment.purchase(userId, {kind:'RENEW',leaseId:id,term,quoteVersion,purchaseIntentId}, key);
    return order.status === 'PENDING' ? this.fulfillment.run(userId, order.orderId) : order;
  }
  async simulate(userId:string,id:string) {
    this.demoOnly();
    return this.db.$transaction(async tx => {
      await lockUser(tx,userId);
      const reference = await tx.lease.findFirst({where:{id,userId}});
      if (!reference) throw new NotFoundException('Lease not found');
      await lockPhone(tx,reference.phoneNumberId);
      const lease = await tx.lease.findUniqueOrThrow({where:{id},include:{phoneNumber:true}});
      const now = new Date();
      assertActive(lease,now);
      if (!lease.phoneNumber.smsEnabled) throw new ConflictException('SMS reception is disabled');
      return tx.message.create({data:{leaseId:id,sender:'安全服务（演示）',title:'演示登录验证码',body:'你的演示验证码是 739 204，真实短信供应商尚未接入。',code:'739204',receivedAt:now}});
    },transactionOptions);
  }
  async messages(userId:string,id:string) {
    await this.owned(userId,id);
    return this.db.message.findMany({where:{leaseId:id},orderBy:[{receivedAt:'desc'},{id:'asc'}],take:200,select:messageSelect});
  }
  async orders(userId:string) {
    return (await this.db.order.findMany({where:{userId},include:orderInclude,orderBy:[{createdAt:'desc'},{id:'asc'}],take:200})).map(billView);
  }
  async messageHistory(userId:string,id:string,limit:number,cursor?:string) {
    await this.owned(userId,id);
    const scope = `messages:${userId}:${id}`;
    const position = cursorPosition(cursor,scope);
    const rows = await this.db.message.findMany({where:{leaseId:id,...(position ? {OR:[{receivedAt:{lt:position.time}},{receivedAt:position.time,id:{gt:position.id}}]} : {})},
      orderBy:[{receivedAt:'desc'},{id:'asc'}],take:limit+1,select:messageSelect});
    return pageResult(rows,limit,scope,row=>row.receivedAt);
  }
  async orderHistory(userId:string,limit:number,cursor?:string,leaseId?:string) {
    if (leaseId) await this.owned(userId,leaseId);
    const scope = `orders:${userId}:${leaseId || '*'}`;
    const position = cursorPosition(cursor,scope);
    const rows = await this.db.order.findMany({where:{userId,...(leaseId?{leaseId}:{}),...(position ? {OR:[{createdAt:{lt:position.time}},{createdAt:position.time,id:{gt:position.id}}]} : {})},
      orderBy:[{createdAt:'desc'},{id:'asc'}],take:limit+1,include:orderInclude});
    const page = pageResult(rows,limit,scope,row=>row.createdAt);
    return {...page,items:page.items.map(billView)};
  }
}
