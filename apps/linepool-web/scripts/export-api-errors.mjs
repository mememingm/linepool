import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const translationsPath = 'src/linepool/i18n/api-errors.ts';
const translations = ts.createSourceFile(translationsPath, fs.readFileSync(path.join(root, translationsPath), 'utf8'), ts.ScriptTarget.Latest, true);
const messages = new Map();
function readMessages(node) {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ts.isArrayLiteralExpression(node.initializer)) {
    const pair = node.initializer.elements;
    if (pair.length === 2 && pair.every(ts.isStringLiteral)) messages.set(node.name.text, pair.map(value => value.text));
  }
  ts.forEachChild(node, readMessages);
}
readMessages(translations);
const codes = new Map();
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      const source = ts.createSourceFile(full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ApiFailure') {
          const code = node.arguments?.[1];
          if (code && ts.isStringLiteral(code)) {
            const refs = codes.get(code.text) ?? new Set();
            refs.add(path.relative(root, full).replaceAll('\\', '/'));
            codes.set(code.text, refs);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
walk(path.join(root, '../../services/core/src'));
for (const code of ['FORBIDDEN', 'RATE_LIMITED', 'NOT_FOUND', 'REQUEST_FAILED', 'PAYLOAD_TOO_LARGE', 'INVALID_JSON', 'DATABASE_UNAVAILABLE', 'INTERNAL_ERROR']) {
  if (!codes.has(code)) codes.set(code, new Set(['../../services/core/src/http.ts']));
}
const missing = [...codes.keys()].filter(code => !messages.has(code));
if (missing.length) throw new Error(`Missing Chinese/English API error messages: ${missing.join(', ')}`);
const rows = [...codes].sort(([a], [b]) => a.localeCompare(b)).map(([code, refs]) => {
  const [zh, en] = messages.get(code);
  return `| \`${code}\` | ${zh} | ${en} | ${[...refs].map(ref => `\`${ref}\``).join(', ')} |`;
});
const output = '# API 错误码与三端文案\n\n由 `node scripts/export-api-errors.mjs` 从后端 `ApiFailure` 和 HTTP 错误出口生成。普通用户、代理和管理员共用 `src/linepool/i18n/api-errors.ts` 中的中英文文案；余额和价格错误可在代理端补充对应金额或商品。\n\n未知 4xx 显示本地化的操作失败提示和错误码；未知 5xx 显示服务暂不可用，不显示后端原文。\n\n| 错误码 | 中文 | English | 后端来源 |\n| --- | --- | --- | --- |\n' + rows.join('\n') + '\n';
fs.writeFileSync(path.join(root, 'docs/api-error-codes.md'), output);
console.log(`Exported ${codes.size} API error codes; all have Chinese and English messages shared by three clients.`);
