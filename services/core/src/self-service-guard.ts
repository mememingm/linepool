import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Authentication } from './authentication.js';
import { AuthController, PasswordRecoveryController, WorkspaceController } from './controllers.js';
import { PcAuthController, PcController } from './pc/controllers.js';
import { ApiFailure } from './http.js';

const agentControllers = new Set<Function>([
  AuthController, PasswordRecoveryController, PcAuthController, PcController,
]);
const agentWorkspaceHandlers = new Set<Function>([
  WorkspaceController.prototype.catalog,
  WorkspaceController.prototype.account,
  WorkspaceController.prototype.profile,
  WorkspaceController.prototype.preferences,
]);

/** PinClode agents use their own connection; local self-service remains a separate account path. */
@Injectable()
export class SelfServiceGuard implements CanActivate {
  constructor(private readonly authentication: Authentication) {}
  async canActivate(context: ExecutionContext) {
    const controller = context.getClass();
    if (agentControllers.has(controller)
      || (controller === WorkspaceController && agentWorkspaceHandlers.has(context.getHandler()))) return true;
    const session = await this.authentication.getSession(context.switchToHttp().getRequest<Request>());
    if (session?.user.authKind === 'PINCLODE') {
      throw new ApiFailure(403, 'SELF_SERVICE_REQUIRED', 'A local self-service account is required');
    }
    return true;
  }
}
