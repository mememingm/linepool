import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from './db.service';
import { fingerprint, lockPhone, lockUser, transactionOptions } from './business';
import { settings } from './config';
import { outboundView } from './outbound.service';

// Explicit simulator: never dispatches to a phone provider or invents delivery receipts.
@Injectable()
export class DemoChatService {
  constructor(private readonly db: DbService) {}
  async send(userId: string, leaseId: string, to: string, content: string, fail: boolean, key: string) {
    if (!settings.demo || settings.production) throw new ForbiddenException('短信演示未启用。');
    const recipient = to.replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{1,14}$/.test(recipient) || !content.trim() || content.length > 4000)
      throw new BadRequestException('请输入有效的收件号码和短信内容。');
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,110}$/.test(key)) throw new BadRequestException('Idempotency-Key is required');
    const hash = fingerprint({leaseId, to: recipient, content, fail});
    return this.db.$transaction(async tx => {
      await lockUser(tx, userId);
      const lease = await tx.lease.findFirst({where: {id: leaseId, userId}, include: {phoneNumber: true}});
      if (!lease) throw new NotFoundException('Lease not found');
      await lockPhone(tx, lease.phoneNumberId);
      if (lease.phoneNumber.provider !== 'demo') throw new ForbiddenException('仅演示号码可使用短信模拟。');
      const identity = {leaseId, idempotencyKey: 'demo:' + key};
      const previous = await tx.outboundMessage.findUnique({where: {leaseId_idempotencyKey: identity}});
      if (previous) {
        if (previous.requestHash !== hash) throw new ConflictException('Idempotency key was already used for a different SMS');
        return outboundView(previous);
      }
      if (lease.status !== 'ACTIVE' || lease.endedAt || lease.startedAt > new Date() || lease.expiresAt <= new Date())
        throw new ConflictException('号码已到期，无法继续模拟收发。');
      const row = await tx.outboundMessage.create({data: {...identity, from: lease.phoneNumber.number, to: recipient, content,
        provider: 'demo', requestHash: hash, status: fail ? 'FAILED' : 'SENT', lastError: fail ? 'DEMO_SIMULATED_FAILURE' : null}});
      if (!fail) await tx.message.create({data: {leaseId, sender: recipient, title: '演示自动回复',
        body: `已收到你的消息：“${content.slice(0, 80)}${content.length > 80 ? '…' : ''}”。这是模拟回复，可以继续体验短信聊天。`,
        provider: 'demo-chat', providerMessageId: row.id, receivedAt: new Date(row.createdAt.getTime() + 1)}});
      await tx.auditLog.create({data: {userId, action: 'SMS_DEMO_SEND', resourceId: row.id, details: {leaseId, simulatedFailure: fail}}});
      return outboundView(row);
    }, transactionOptions);
  }
  async receive(userId: string, leaseId: string, peer: string, key: string) {
    if (!settings.demo || settings.production) throw new ForbiddenException('短信演示未启用。');
    const recipient = peer.replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{1,14}$/.test(recipient)) throw new BadRequestException('请输入有效的演示号码。');
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,110}$/.test(key)) throw new BadRequestException('Idempotency-Key is required');
    return this.db.$transaction(async tx => {
      await lockUser(tx, userId);
      const lease = await tx.lease.findFirst({where: {id: leaseId, userId}, include: {phoneNumber: true}});
      if (!lease) throw new NotFoundException('Lease not found');
      await lockPhone(tx, lease.phoneNumberId);
      if (lease.phoneNumber.provider !== 'demo') throw new ForbiddenException('仅演示号码可使用短信模拟。');
      const identity = {provider: 'demo-chat', providerAccountId: '', providerMessageId: `incoming:${leaseId}:${key}`};
      const previous = await tx.message.findUnique({where: {provider_providerAccountId_providerMessageId: identity}});
      if (previous) {
        if (previous.sender !== recipient) throw new ConflictException('Idempotency key was already used for another sender');
        return {ok: true};
      }
      if (lease.status !== 'ACTIVE' || lease.endedAt || lease.startedAt > new Date() || lease.expiresAt <= new Date())
        throw new ConflictException('号码已到期，无法继续模拟收发。');
      await tx.message.create({data: {...identity, leaseId, sender: recipient, title: '演示来信',
        body: '你好，这是一条模拟来信。你可以直接回复，也可以切换会话查看未读提醒。'}});
      return {ok: true};
    }, transactionOptions);
  }
}
