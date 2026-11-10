import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AgentInventoryController } from './agent-inventory-controller.js';
import { ApiFailure } from './http.js';

/** Keep guarded historical views while rejecting every retired distribution mutation. */
@Injectable()
export class LegacyDistributionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.getClass() !== AgentInventoryController) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    throw new ApiFailure(409, 'LEGACY_DISTRIBUTION_DISABLED', 'Wholesale, distribution and settlement writes are disabled');
  }
}
