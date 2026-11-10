import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Authentication } from './authentication.js';
import { WorkspaceController, NumberServicesController } from './controllers.js';
import { RechargeController } from './recharge.js';
import { SandboxController } from './sandbox.js';
import { OnceLeaseController } from './once/lease-controller.js';
import { OnceMessageController } from './once/message-controller.js';
import { ApiFailure } from './http.js';

const accountHandlers = new Set<Function>([
  WorkspaceController.prototype.account,
  WorkspaceController.prototype.profile,
  WorkspaceController.prototype.preferences,
]);
const selfServiceControllers = new Set<Function>([
  NumberServicesController, RechargeController, SandboxController, OnceLeaseController, OnceMessageController,
]);

/** PinClode agents use their own connection; local self-service remains a separate account path. */
@Injectable()
export class SelfServiceGuard implements CanActivate {
  constructor(private readonly authentication: Authentication) {}
  async canActivate(context: ExecutionContext) {
    const controller = context.getClass();
    const selfService = controller === WorkspaceController
      ? !accountHandlers.has(context.getHandler())
      : selfServiceControllers.has(controller);
    if (!selfService) return true;
    const session = await this.authentication.getSession(context.switchToHttp().getRequest<Request>());
    if (session?.user.authKind === 'PINCLODE') {
      throw new ApiFailure(403, 'SELF_SERVICE_REQUIRED', 'A local self-service account is required');
    }
    return true;
  }
}
