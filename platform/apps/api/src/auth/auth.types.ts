import type { User } from '@linepool/contracts';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: User;
}
