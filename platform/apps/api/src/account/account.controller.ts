import type { Account } from '@linepool/contracts';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

@Controller('account')
@UseGuards(AuthGuard)
export class AccountController {
  @Get()
  get(@Req() request: AuthenticatedRequest): { data: Account } {
    const { id, email, displayName, isDemo, createdAt } = request.user;
    return { data: { id, email, displayName, isDemo, createdAt } };
  }
}
