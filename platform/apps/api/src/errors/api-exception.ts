import { HttpException, type HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
