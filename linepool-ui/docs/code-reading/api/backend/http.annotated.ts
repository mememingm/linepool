/**
 * http.ts 中文分区导读副本：公共输入检查、来源检查与错误返回
 * 原文件：backend/src/http.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】统一检查入参、拒绝不允许的写请求来源，并把异常转换成一致的 JSON 错误。
 * 【为什么这样组织】让接口使用同一套错误格式，避免数据库异常和内部细节直接暴露给页面。
 * 【调用链】请求 → OriginGuard → 路由中的 SchemaPipe → 业务；异常 → ApiErrorFilter → client.ts。
 * 【修改提示】改错误 code 要核对前端处理。SignedWebhook 只是来源检查的标记，回调方法仍须自行验证原始报文签名。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import {
  ArgumentsHost, Catch, HttpException, HttpStatus, Injectable, SetMetadata,
  type CanActivate, type ExceptionFilter, type ExecutionContext, type PipeTransform,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Environment } from '../../../../backend/src/environment.js';

/**
 * ==================== 01 公共输入检查、来源检查与错误返回 / ApiFailure ====================
 * ApiFailure = 统一业务异常。将 status、code、message 和可选 details 包装为 { error: ... }，供前端识别。
 */
export class ApiFailure extends HttpException {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
  }
}
/**
 * ==================== 02 公共输入检查、来源检查与错误返回 / SchemaPipe ====================
 * SchemaPipe = 请求输入检查管道。把未知请求值按传入 schema 检查，成功返回整理后的值，失败返回 VALIDATION_ERROR。
 */
export class SchemaPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly schema: T) {}
  /**
   * transform = 执行输入检查。safeParse 不通过时，把每个错误的字段路径和说明整理给调用方。
   */
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
/**
 * signedWebhookMetadata = 已签名回调的内部元数据键，供 OriginGuard 识别这种特殊入口。
 */
const signedWebhookMetadata = Symbol('linepool:signed-webhook');
/** Reserved for callbacks that verify their raw-body signature before reading or writing data. */
/**
 * SignedWebhook = 标记一个回调方法使用独立签名验证。这个标记不代替验证，方法内部仍必须校验原始报文。
 */
export const SignedWebhook = () => SetMetadata(signedWebhookMetadata, true);

/**
 * ==================== 03 公共输入检查、来源检查与错误返回 / OriginGuard ====================
 * OriginGuard = 写请求来源守卫。普通写请求要求 Origin 等于 WEB_ORIGIN；标记的回调入口走自己的签名检查。
 */
@Injectable()
export class OriginGuard implements CanActivate {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly environment: Environment) {}
  /**
   * canActivate = 允许 GET/HEAD/OPTIONS，检查其他请求来源；签名回调标记只跳过此处的浏览器 Origin 检查。
   */
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const handler = typeof context.getHandler === 'function' ? context.getHandler() : undefined;
    if (handler && Reflect.getMetadata(signedWebhookMetadata, handler) === true) return true;
    if (request.headers.origin !== this.environment.values.WEB_ORIGIN) {
      throw new ApiFailure(403, 'ORIGIN_REJECTED', 'Request origin is not allowed');
    }
    return true;
  }
}
/**
 * ==================== 04 公共输入检查、来源检查与错误返回 / ApiErrorFilter ====================
 * ApiErrorFilter = 统一异常返回器。保留明确业务异常，对框架、JSON、数据库和未知错误做受控转换。
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  /**
   * catch = 捕获异常并发送错误 JSON。429 表示频率超限，连接类故障返回 503，未知异常返回 500，内部信息只保留受限日志。
   */
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
