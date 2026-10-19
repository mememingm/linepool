import {
  ArgumentsHost, Catch, HttpException, HttpStatus, Injectable,
  type CanActivate, type ExceptionFilter, type ExecutionContext, type PipeTransform,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Environment } from './environment.js';

export class ApiFailure extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
  }
}
export class SchemaPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiFailure(400, 'VALIDATION_ERROR', 'Invalid request', result.error.issues.map(issue => ({
        path: issue.path.join('.'), message: issue.message,
      })));
    }
    return result.data;
  }
}
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly environment: Environment) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    if (request.headers.origin !== this.environment.values.WEB_ORIGIN) {
      throw new ApiFailure(403, 'ORIGIN_REJECTED', 'Request origin is not allowed');
    }
    return true;
  }
}
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiFailure) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 429 ? 'RATE_LIMITED' : status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED';
      response.status(status).json({ error: { code, message: status === 429 ? 'Too many requests' : 'Request failed' } });
      return;
    }
    const status = typeof exception === 'object' && exception !== null && 'status' in exception ? exception.status : undefined;
    if (status === 400 || status === 413) {
      response.status(status).json({ error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', message: status === 413 ? 'Request body is too large' : 'Invalid JSON body' } });
      return;
    }
    const code = typeof exception === 'object' && exception !== null && 'code' in exception ? exception.code : '';
    const unavailable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '53300'].includes(String(code));
    console.error('API request failed', { type: exception instanceof Error ? exception.name : 'unknown', code });
    response.status(unavailable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: unavailable ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR', message: unavailable ? 'Database is unavailable' : 'Internal server error' },
    });
  }
}
