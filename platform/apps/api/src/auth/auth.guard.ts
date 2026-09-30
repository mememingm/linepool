import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { ApiException } from '../errors/api-exception.js';
import { SESSION_COOKIE_NAME } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    const user = token ? await this.auth.userForToken(token) : null;

    if (!user) {
      throw new ApiException('AUTH_REQUIRED', '请先登录', HttpStatus.UNAUTHORIZED);
    }

    (request as AuthenticatedRequest).user = user;
    return true;
  }
}
