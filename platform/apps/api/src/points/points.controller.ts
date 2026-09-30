import type { PointsResponse } from '@linepool/contracts';
import { paginationQuerySchema } from '@linepool/contracts';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { PointsService } from './points.service.js';

@Controller('points')
@UseGuards(AuthGuard)
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get()
  get(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<PointsResponse> {
    return this.points.get(request.user.id, paginationQuerySchema.parse(query));
  }
}
