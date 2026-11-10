import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WebhookEvent } from '@prisma/client';
import { DbService } from './db.service';
import { settings } from './config';
import { traceWebhook } from './webhook-trace';
import { fingerprint, lockPhone, lockUser, transactionOptions } from './business';

export type MockMessage = {leaseId:string;providerMessageId:string;sender:string;title:string;body:string;code?:string;receivedAt:string};
function eventView(event: WebhookEvent) {
  return {id:event.id,eventId:event.eventId,status:event.status,attempts:event.attempts,lastError:event.lastError,
    processedAt:event.processedAt,nextAttemptAt:event.nextAttemptAt,conflictCount:event.conflictCount,
    lastConflictHash:event.lastConflictHash,lastConflictAt:event.lastConflictAt,demo:true};
}
@Injectable()
export class EventsService {
  constructor(private readonly db:DbService) {}
  private provider(userId:string) {
    if (!settings.demo || settings.production) throw new ForbiddenException('Local event simulation is disabled');
    // Local per-account namespace. No real supplier signatures/credentials are accepted here.
    return 'demo-inbox:'+userId;
  }
  async receive(userId:string,eventId:string,input:MockMessage) {
    const provider=this.provider(userId);
    const payload={...input,code:input.code ?? null,receivedAt:new Date(input.receivedAt).toISOString()};
    const payloadHash=fingerprint(payload);
    const saved=await this.db.$transaction(async tx => {
      await lockUser(tx,userId);
      const lease=await tx.lease.findFirst({where:{id:input.leaseId,userId}});
      if(!lease) throw new NotFoundException('Lease not found');
      const existing=await tx.webhookEvent.findUnique({where:{provider_providerAccountId_eventId:{provider,providerAccountId:'',eventId}}});
      if(existing) {
        if((existing.payloadHash ?? fingerprint(existing.payload))!==payloadHash) {
          const event=await tx.webhookEvent.update({where:{id:existing.id},data:{conflictCount:{increment:1},lastConflictHash:payloadHash,lastConflictAt:new Date()}});
          await tx.auditLog.create({data:{userId,action:'MOCK_EVENT_CONTENT_CONFLICT',resourceId:event.id,
            details:{expectedHash:existing.payloadHash,actualHash:payloadHash}}});
          return {event,conflict:true};
        }
        return {event:existing,conflict:false};
      }
      return {event:await tx.webhookEvent.create({data:{provider,eventId,payload:payload as Prisma.InputJsonValue,payloadHash,leaseId:input.leaseId}}),conflict:false};
    },transactionOptions);
    // Throw only after committing the conflict evidence.
    if(saved.conflict) throw new ConflictException('Event ID was already received with different content; conflict recorded');
    return this.process(userId,saved.event.id);
  }
  async get(userId:string,id:string) {
    const event=await this.db.webhookEvent.findFirst({where:{id,provider:this.provider(userId)}});
    if(!event) throw new NotFoundException('Event not found');
    return eventView(event);
  }
  async process(userId:string,id:string,source='AUTO') {
    return traceWebhook(this.db,id,source,()=>this.processLogged(userId,id));
  }
  private async processLogged(userId:string,id:string) {
    const provider=this.provider(userId);
    try {
      return await this.db.$transaction(async tx => {
        await lockUser(tx,userId);
        const event=await tx.webhookEvent.findFirst({where:{id,provider}});
        if(!event) throw new NotFoundException('Event not found');
        if(event.status==='PROCESSED' || event.status==='QUARANTINED') return eventView(event);
        if(!event.payloadHash || fingerprint(event.payload)!==event.payloadHash || !event.leaseId) throw new ConflictException('EVENT_PAYLOAD_REQUIRES_REVIEW');
        const payload=event.payload as unknown as MockMessage;
        const reference=await tx.lease.findFirst({where:{id:event.leaseId,userId}});
        if(!reference) throw new ConflictException('EVENT_LEASE_REQUIRES_REVIEW');
        await lockPhone(tx,reference.phoneNumberId);
        const lease=await tx.lease.findUniqueOrThrow({where:{id:reference.id},include:{phoneNumber:true}});
        const receivedAt=new Date(payload.receivedAt);
        const end=lease.endedAt && lease.endedAt<lease.expiresAt ? lease.endedAt : lease.expiresAt;
        // Explicit historical lease + event time, never the number's current holder.
        // Delivery after expiry is allowed only for events inside the original service window.
        if(lease.phoneNumber.provider!=='demo' || receivedAt<lease.startedAt || receivedAt>=end || receivedAt>new Date()) throw new ConflictException('EVENT_OUTSIDE_LEASE_WINDOW');
        const existing=await tx.message.findUnique({where:{provider_providerAccountId_providerMessageId:{provider,providerAccountId:'',providerMessageId:payload.providerMessageId}}});
        const content={leaseId:lease.id,providerMessageId:payload.providerMessageId,sender:payload.sender,title:payload.title,body:payload.body,code:payload.code ?? null,receivedAt:receivedAt.toISOString()};
        if(existing && fingerprint({...content,leaseId:existing.leaseId,sender:existing.sender,title:existing.title,body:existing.body,code:existing.code,receivedAt:existing.receivedAt.toISOString()})!==fingerprint(content)) {
          const quarantined=await tx.webhookEvent.update({where:{id},data:{status:'QUARANTINED',attempts:{increment:1},lastError:'PROVIDER_MESSAGE_CONTENT_CONFLICT',nextAttemptAt:null}});
          await tx.auditLog.create({data:{userId,action:'MOCK_MESSAGE_CONTENT_CONFLICT',resourceId:id,details:{providerMessageId:payload.providerMessageId}}});
          return eventView(quarantined);
        }
        if(!existing) await tx.message.create({data:{...content,receivedAt,provider}});
        const processed=await tx.webhookEvent.update({where:{id},data:{status:'PROCESSED',attempts:{increment:1},processedAt:new Date(),nextAttemptAt:null,lastError:null}});
        await tx.auditLog.create({data:{userId,action:'MOCK_EVENT_PROCESSED',resourceId:id,details:{leaseId:lease.id,duplicateMessage:!!existing}}});
        return eventView(processed);
      },transactionOptions);
    } catch(error) {
      if(error instanceof NotFoundException) throw error;
      const reason=error instanceof ConflictException ? error.message : 'LOCAL_EVENT_PROCESSING_FAILED';
      // Record failure after the processing transaction rolls back. A concurrent successful retry wins.
      const failed=await this.db.$transaction(async tx => {
        await lockUser(tx,userId);
        const event=await tx.webhookEvent.findFirstOrThrow({where:{id,provider}});
        if(event.status==='PROCESSED' || event.status==='QUARANTINED') return event;
        const permanent=error instanceof ConflictException;
        const attempts=event.attempts+1;
        const updated=await tx.webhookEvent.update({where:{id},data:{status:permanent?'QUARANTINED':'FAILED',attempts,lastError:reason,
          nextAttemptAt:permanent || attempts>=10?null:new Date(Date.now()+Math.min(3600000,1000*2**attempts))}});
        await tx.auditLog.create({data:{userId,action:'MOCK_EVENT_'+updated.status,resourceId:id,details:{reason,attempt:attempts}}});
        return updated;
      },transactionOptions);
      return eventView(failed);
    }
  }
  async recover(limit=100) {
    if(!settings.demo || settings.production) return;
    const events=await this.db.webhookEvent.findMany({where:{provider:{startsWith:'demo-inbox:'},status:{in:['RECEIVED','FAILED','PROCESSING']},attempts:{lt:10},
      OR:[{status:'RECEIVED'},{nextAttemptAt:{lte:new Date()}}]},orderBy:[{receivedAt:'asc'},{id:'asc'}],take:limit});
    for(const event of events) await this.process(event.provider.slice('demo-inbox:'.length),event.id);
  }
}
