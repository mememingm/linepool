import { Controller, Get, Post, Body, Query, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthService, AuthedRequest, SessionGuard } from './auth';
import { HistoryQuery } from './dto';
import { ChatService } from './chat.service';
import { DemoChatService } from './demo-chat.service';

class ChatQuery extends HistoryQuery { @IsString() @MinLength(1) @MaxLength(120) peer!: string; }
class ReadDto { @IsArray() @ArrayMaxSize(200) @IsUUID('all', {each: true}) ids!: string[]; }
class DemoSendDto {
  @IsString() @MinLength(2) @MaxLength(40) to!: string;
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
  @IsOptional() @IsBoolean() fail?: boolean;
}
class DemoReceiveDto { @IsString() @MinLength(2) @MaxLength(40) peer!: string; }

@Controller('api/leases/:id/chat')
@UseGuards(SessionGuard)
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly auth: AuthService, private readonly demo: DemoChatService) {}
  @Post('demo/send')
  demoSend(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: DemoSendDto) {
    return this.demo.send(req.account.id, id, body.to, body.content, body.fail === true, req.get('Idempotency-Key')!);
  }
  @Post('demo/receive')
  demoReceive(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: DemoReceiveDto) {
    return this.demo.receive(req.account.id, id, body.peer, req.get('Idempotency-Key')!);
  }
  @Get('conversations')
  conversations(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.conversations(req.account.id, id);
  }
  @Get('messages')
  messages(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: ChatQuery) {
    return this.chat.messages(req.account.id, id, query.peer, query.limit, query.cursor);
  }
  @Post('read')
  read(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReadDto) {
    return this.chat.read(req.account.id, id, body.ids);
  }
  @Get('events')
  async events(@Req() req: AuthedRequest, @Res() res: Response, @Param('id', ParseUUIDPipe) id: string) {
    let version = await this.chat.version(req.account.id, id);
    res.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no'});
    res.flushHeaders();
    res.write('retry: 3000\nevent: changed\ndata: {}\n\n');
    res.setTimeout(0);
    let running = false, closed = false, checkedAt = Date.now();
    const startedAt = Date.now();
    // DB revisions work across API processes and include late, out-of-order inserts. No client page polling.
    const timer = setInterval(async () => {
      if (running || closed) return;
      running = true;
      try {
        if (Date.now() - checkedAt >= 15000) {
          await this.auth.account(req); checkedAt = Date.now();
          res.write(': heartbeat\n\n');
        }
        const next = await this.chat.version(req.account.id, id);
        if (next !== version) { version = next; res.write('event: changed\ndata: {}\n\n'); }
        // Bound connection lifetime; EventSource reconnects with current session and a fresh snapshot.
        if (Date.now() - startedAt > 300000) res.end();
      } catch {
        if (!res.writableEnded) { res.write('event: unavailable\ndata: {}\n\n'); res.end(); }
      } finally { running = false; }
    }, 2000);
    timer.unref();
    res.on('close', () => { closed = true; clearInterval(timer); });
  }
}
