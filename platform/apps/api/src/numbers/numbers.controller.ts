import type { AssignedNumber, PaginatedResponse } from '@linepool/contracts';
import { paginationQuerySchema } from '@linepool/contracts';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { NumbersService } from './numbers.service.js';

const numberQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'EXPIRED']).optional(),
});

@Controller('numbers')
@UseGuards(AuthGuard)
export class NumbersController {
  constructor(private readonly numbers: NumbersService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<PaginatedResponse<AssignedNumber>> {
    return this.numbers.list(request.user.id, numberQuerySchema.parse(query));
  }
}
