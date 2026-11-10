/**
 * error-summary.ts 中文分区导读副本：错误日志摘要
 * 原文件：backend/src/error-summary.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】只从错误对象提取格式受限的名称、编号和 SMTP 状态码。
 * 【为什么这样组织】邮件错误可能含地址、凭据和重置链接，日志只保留定位所需标识。
 * 【调用链】PasswordRecovery 等日志调用 → safeErrorDetails → 结构化日志。
 * 【修改提示】要增加日志字段时先确认内容；本文件不应记录邮件正文、令牌或配置密钥。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
/** Log diagnostic identifiers only; messages and payloads may contain credentials or personal data. */
/**
 * safeErrorDetails = 生成可安全记录的错误摘要。仅提取格式受限的错误名称、代码与 SMTP 状态码，不复制错误正文或请求内容。
 */
export function safeErrorDetails(error: unknown) {
  const fields = error !== null && typeof error === 'object'
    ? error as Record<string, unknown> : {};
  const name = typeof fields.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(fields.name)
    ? fields.name : 'UnknownError';
  const code = typeof fields.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(fields.code)
    ? fields.code : undefined;
  const responseCode = typeof fields.responseCode === 'number' && Number.isInteger(fields.responseCode)
    && fields.responseCode >= 100 && fields.responseCode <= 599 ? fields.responseCode : undefined;
  return { errorName: name, errorCode: code, smtpResponseCode: responseCode };
}
