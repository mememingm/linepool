import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard,
  type ThrottlerModuleOptions, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { Authentication } from './authentication.js';

@Injectable()
export class BusinessThrottlerGuard extends ThrottlerGuard {
  constructor(@InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage, reflector: Reflector,
    private readonly auth: Authentication) { super(options, storage, reflector); }
  protected override async getTracker(request: Request): Promise<string> {
    // Public authentication endpoints always use the verified client IP, even with a valid cookie.
    if (!/^\/api\/auth\/(?:login|register|forgot-password|reset-password)\/*$/i.test(request.route?.path ?? request.path)) {
      const session = await this.auth.getSession(request);
      if (session) return `account:${session.user.id}`;
    }
    return super.getTracker(request);
  }
}
