import type { Dashboard } from '@linepool/contracts';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  async get(@Req() request: AuthenticatedRequest): Promise<{ data: Dashboard }> {
    return { data: await this.dashboard.get(request.user) };
  }
}
