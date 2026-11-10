import { Injectable } from '@nestjs/common';
import { ApiFailure } from './http.js';

/** Historical holdings remain intact; v4.2 does not maintain a distribution stock pool. */
@Injectable()
export class AgentInventoryExpiry {
  runBatch(): never {
    throw new ApiFailure(409, 'LEGACY_DISTRIBUTION_DISABLED', 'Agent distribution maintenance is disabled');
  }
}
