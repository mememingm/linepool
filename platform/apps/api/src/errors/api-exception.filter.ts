import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

import { ApiException } from './api-exception.js';

const statusDefaults: Record<number, { code: string; message: string }> = {
  [HttpStatus.BAD_REQUEST]: {
    code: 'BAD_REQUEST',
    message: '请求格式不正确',
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: 'AUTH_REQUIRED',
    message: '请先登录',
  },
  [HttpStatus.FORBIDDEN]: {
    code: 'FORBIDDEN',
    message: '无权执行此操作',
  },
  [HttpStatus.NOT_FOUND]: {
    code: 'NOT_FOUND',
    message: '请求的资源不存在',
  },
  [HttpStatus.CONFLICT]: {
    code: 'CONFLICT',
    message: '请求与当前状态冲突',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'RATE_LIMITED',
    message: '请求过于频繁，请稍后再试',
  },
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ZodError) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数不正确',
          details: exception.flatten(),
        },
      });
      return;
    }

    if (exception instanceof ApiException) {
      response.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details === undefined
            ? {}
            : { details: exception.details }),
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const fallback = statusDefaults[status] ?? {
        code: 'REQUEST_FAILED',
        message: '请求处理失败',
      };
      response.status(status).json({ error: fallback });
      return;
    }

    this.logger.error(
      'Unhandled API error',
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用',
      },
    });
  }
}
