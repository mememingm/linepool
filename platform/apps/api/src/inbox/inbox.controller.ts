import type { PaginatedResponse, SmsMessage } from '@linepool/contracts';
import { paginationQuerySchema } from '@linepool/contracts';
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { InboxService } from './inbox.service.js';

@Controller('inbox')
@UseGuards(AuthGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<PaginatedResponse<SmsMessage>> {
    return this.inbox.list(
      request.user.id,
      paginationQuerySchema.parse(query),
    );
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ data: SmsMessage }> {
    return {
      data: await this.inbox.markRead(
        request.user.id,
        z.string().uuid().parse(id),
      ),
    };
  }
}
