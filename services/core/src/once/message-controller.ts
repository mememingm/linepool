import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Authentication, SessionGuard, type SessionRequest } from '../authentication.js';
import { SchemaPipe } from '../http.js';
import { OnceMessages } from './messages.js';
import { OnceOutbound } from './outbound.js';
import { OnceChat } from './chat.js';
import { outboundInputSchema, mockSmsScenarioSchema } from './message-access.js';

const uuid = new SchemaPipe(z.uuid());
const demoSendSchema = outboundInputSchema.extend({ fail: z.boolean().optional(), scenario: mockSmsScenarioSchema.optional() });
const demoReceiveSchema = z.strictObject({ peer: z.string().min(2).max(40) });

@Controller('once')
@UseGuards(SessionGuard)
export class OnceMessageController {
  constructor(private readonly messages: OnceMessages, private readonly outbound: OnceOutbound,
    private readonly chat: OnceChat, private readonly authentication: Authentication) {}

  @Get('leases/:id/messages')
  async list(@Req() request: SessionRequest, @Param('id', uuid) id: string) {
    return { data: await this.messages.list(request.user.id, id) };
  }
  @Get('leases/:id/messages/history')
  async history(@Req() request: SessionRequest, @Param('id', uuid) id: string, @Query() query: unknown) {
    return { data: await this.messages.history(request.user.id, id, query) };
  }
  @Post('leases/:id/outbound')
  @HttpCode(202)
  async send(@Req() request: SessionRequest, @Param('id', uuid) id: string, @Body() body: unknown) {
    return { data: await this.outbound.send(request.user.id, id, body, request.get('Idempotency-Key')) };
  }
  @Get('leases/:id/outbound')
  async outboundList(@Req() request: SessionRequest, @Param('id', uuid) id: string) {
    return { data: await this.outbound.list(request.user.id, id) };
  }
  @Get('leases/:id/outbound/:messageId')
  async outboundDetail(@Req() request: SessionRequest, @Param('id', uuid) id: string, @Param('messageId', uuid) messageId: string) {
    return { data: await this.outbound.detail(request.user.id, id, messageId) };
  }
  @Get('leases/:id/chat/conversations')
  async conversations(@Req() request: SessionRequest, @Param('id', uuid) id: string) {
    return { data: await this.chat.conversations(request.user.id, id) };
  }
  @Get('leases/:id/chat/messages')
  async chatMessages(@Req() request: SessionRequest, @Param('id', uuid) id: string, @Query() query: unknown) {
    return { data: await this.chat.messages(request.user.id, id, query) };
  }
  @Post('leases/:id/chat/read')
  async read(@Req() request: SessionRequest, @Param('id', uuid) id: string, @Body() body: unknown) {
    return { data: await this.chat.read(request.user.id, id, body) };
  }
  @Post('leases/:id/demo-message')
  async simulate(@Req() request: SessionRequest, @Param('id', uuid) id: string) {
    return { data: await this.messages.simulate(request.user.id, id) };
  }
  @Post('leases/:id/chat/demo/send')
  @HttpCode(202)
  async demoSend(@Req() request: SessionRequest, @Param('id', uuid) id: string,
    @Body(new SchemaPipe(demoSendSchema)) body: z.infer<typeof demoSendSchema>) {
    return { data: await this.outbound.send(request.user.id, id, { to: body.to, content: body.content },
      request.get('Idempotency-Key'), body.scenario ?? (body.fail ? 'FAILURE' : 'SUCCESS')) };
  }
  @Post('leases/:id/chat/demo/receive')
  async demoReceive(@Req() request: SessionRequest, @Param('id', uuid) id: string,
    @Body(new SchemaPipe(demoReceiveSchema)) body: z.infer<typeof demoReceiveSchema>) {
    return { data: await this.messages.demoReceive(request.user.id, id, body.peer, request.get('Idempotency-Key')) };
  }
  @Post('demo/events')
  async demoEvent(@Req() request: SessionRequest, @Body() body: unknown) {
    return { data: await this.messages.demoEvent(request.user.id, body) };
  }
  @Get('demo/events/:eventId')
  async event(@Req() request: SessionRequest, @Param('eventId', uuid) eventId: string) {
    return { data: await this.messages.event(request.user.id, eventId) };
  }
  @Post('demo/events/:eventId/retry')
  async retry(@Req() request: SessionRequest, @Param('eventId', uuid) eventId: string) {
    return { data: await this.messages.retry(request.user.id, eventId) };
  }

  @Get('leases/:id/chat/events')
  async events(@Req() request: SessionRequest, @Res() response: Response, @Param('id', uuid) id: string) {
    const userId = request.user.id;
    let version = await this.chat.version(userId, id);
    if (request.aborted || response.destroyed) return;
    response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    response.write('retry: 3000\nevent: changed\ndata: {}\n\n');
    response.setTimeout(0);
    let running = false, closed = false, checkedAt = Date.now();
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (running || closed) return;
      running = true;
      try {
        if (Date.now() - checkedAt >= 15000) {
          const session = await this.authentication.getSession(request);
          if (!session || session.user.id !== userId) throw new Error('SESSION_UNAVAILABLE');
          checkedAt = Date.now();
          if (closed) return;
          response.write(': heartbeat\n\n');
        }
        const next = await this.chat.version(userId, id);
        if (closed) return;
        if (next !== version) { version = next; response.write('event: changed\ndata: {}\n\n'); }
        if (Date.now() - startedAt >= 300000) response.end();
      } catch {
        if (!closed && !response.writableEnded && !response.destroyed) {
          response.write('event: unavailable\ndata: {}\n\n'); response.end();
        }
        cleanup();
      } finally { running = false; }
    }, 2000);
    const cleanup = () => { closed = true; clearInterval(timer); };
    timer.unref();
    response.once('close', cleanup);
    response.once('error', cleanup);
    request.once('aborted', cleanup);
  }
}
