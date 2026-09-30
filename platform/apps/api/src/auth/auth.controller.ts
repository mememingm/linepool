import type { LoginInput, User } from '@linepool/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { EnvironmentService } from '../config/environment.service.js';
import { loginInputSchema } from '@linepool/contracts';
import { SESSION_COOKIE_NAME } from './auth.constants.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly environment: EnvironmentService,
  ) {}

  @Post('login')
  @Throttle({ auth: { limit: 10, ttl: 15 * 60 * 1000 } })
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: User }> {
    const input: LoginInput = loginInputSchema.parse(body);
    const { token, user } = await this.auth.login(input);
    response.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.environment.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.environment.sessionTtlHours * 60 * 60 * 1000,
    });
    return { data: user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest): { data: User } {
    return { data: request.user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: null }> {
    await this.auth.logout(request.cookies?.[SESSION_COOKIE_NAME]);
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: this.environment.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return { data: null };
  }
}
