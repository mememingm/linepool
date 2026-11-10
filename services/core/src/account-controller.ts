import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { accountProfileInputSchema, preferencesInputSchema, type AccountProfileInput } from '@linepool/contracts';
import { Authentication, SessionGuard, type SessionRequest } from './authentication.js';
import { SchemaPipe } from './http.js';
import { Workspace } from './workspace.js';

/** ONCE shares account semantics without registering LinePool catalog or order routes. */
@Controller('account')
@UseGuards(SessionGuard)
export class SiteAccountController {
  constructor(private readonly workspace: Workspace, private readonly authentication: Authentication) {}

  @Get()
  async account(@Req() request: SessionRequest) {
    return { data: { ...await this.workspace.account(request.user.id), sandboxEnabled: this.authentication.sandboxEnabled } };
  }

  @Patch('profile')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async profile(@Req() request: SessionRequest, @Body(new SchemaPipe(accountProfileInputSchema)) input: AccountProfileInput) {
    return { data: await this.authentication.updateProfile(request.user.id, request.sessionToken, input) };
  }

  @Patch('preferences')
  async preferences(@Req() request: SessionRequest, @Body(new SchemaPipe(preferencesInputSchema)) input: z.infer<typeof preferencesInputSchema>) {
    return { data: await this.workspace.preferences(request.user.id, input.expiryNotice) };
  }
}
