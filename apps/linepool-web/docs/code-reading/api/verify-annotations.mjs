/**
 * 注释资料的源码完整性检查，不执行应用、接口或测试，也不连接数据库。
 * 在项目根目录运行：node docs/code-reading/api/verify-annotations.mjs
 * 加 --typecheck 时，额外用 TypeScript 检查这三组阅读副本及其依赖，仍然不运行代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const absolute = relative => path.resolve(root, relative);
const slash = value => value.replaceAll('\\', '/');

function walk(directoryPath) {
  return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directoryPath, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function restoreModulePaths(text, filename, mappings) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const changes = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const module = statement.moduleSpecifier;
    if (!module || !ts.isStringLiteral(module) || !module.text.startsWith('.')) continue;
    const mapping = mappings.find(item => item.to === module.text);
    if (!mapping) throw new Error(`${filename}: 未登记的相对导入 ${module.text}`);
    changes.push({ start: module.getStart(source) + 1, end: module.end - 1, text: mapping.from });
  }
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, change.start) + change.text + text.slice(change.end);
  }
  return text;
}

function tokens(text) {
  // 由语法解析器识别模板字符串、正则和 ${...} 边界，避免裸 scanner 将注释误当字符串内容。
  const source = ts.createSourceFile('comparison.ts', text, ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    // getChildren 也会包含文档注释里的 @tag 标识；它们属于注释，不能算作可执行代码。
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.kind <= ts.SyntaxKind.LastToken && node.kind !== ts.SyntaxKind.EndOfFileToken) {
      result.push([node.kind, node.getText(source)]);
      return;
    }
    for (const child of node.getChildren(source)) visit(child);
  }
  visit(source);
  return result;
}

const actualSources = ['src/linepool/api', 'packages/contracts/src', 'backend/src']
  .flatMap(relative => walk(absolute(relative)))
  .filter(filename => filename.endsWith('.ts'))
  .map(filename => slash(path.relative(root, filename)))
  .sort();
const listedSources = manifest.entries.map(entry => entry.source).sort();
if (new Set(listedSources).size !== listedSources.length
  || JSON.stringify(actualSources) !== JSON.stringify(listedSources)) {
  throw new Error('副本清单与当前接口源码范围不一致：存在新增、遗漏或重复文件，需要更新资料');
}
if (new Set(manifest.entries.map(entry => entry.annotated)).size !== manifest.entries.length) {
  throw new Error('副本清单中存在重复目标文件');
}

let totalTokens = 0;
for (const entry of manifest.entries) {
  const buffer = fs.readFileSync(absolute(entry.source));
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (hash !== entry.sourceSha256) throw new Error(`${entry.source}: 源码已变化，需要重新核对并同步注释`);
  const source = buffer.toString('utf8');
  const annotated = fs.readFileSync(absolute(entry.annotated), 'utf8');
  if (annotated.includes('待补充说明')) throw new Error(`${entry.annotated}: 仍有未完成的说明`);
  if (annotated.includes('[native code]')) throw new Error(`${entry.annotated}: 注释生成内容异常`);
  const parsed = ts.createSourceFile(entry.annotated, annotated, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length) throw new Error(`${entry.annotated}: TypeScript 语法检查失败`);
  const restored = restoreModulePaths(annotated, entry.annotated, entry.imports);
  const originalTokens = tokens(source);
  if (JSON.stringify(originalTokens) !== JSON.stringify(tokens(restored))) {
    throw new Error(`${entry.annotated}: 还原导入路径后，代码 token 与原文件不一致`);
  }
  totalTokens += originalTokens.length;
}
console.log(`源码覆盖和完整性通过：${manifest.entries.length} 份副本，${totalTokens} 个非注释 token 一致`);

let linkCount = 0;
for (const relative of ['docs/code-reading/api/README.md', 'docs/code-reading/api-guide.md']) {
  const filename = absolute(relative);
  const content = fs.readFileSync(filename, 'utf8');
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    target = target.replace(/^<|>$/g, '').split('#')[0];
    if (!fs.existsSync(path.resolve(path.dirname(filename), target))) {
      throw new Error(`${relative}: 本地链接目标不存在 ${target}`);
    }
    linkCount++;
  }
}
console.log(`资料本地链接检查通过：${linkCount} 个`);

if (process.argv.includes('--typecheck')) {
  const groups = [
    ['前端调用', 'tsconfig.json', entry => entry.source.startsWith('src/linepool/api/')],
    ['共享契约', 'packages/contracts/tsconfig.json', entry => entry.source.startsWith('packages/contracts/src/')],
    ['后端接口及业务', 'backend/tsconfig.json', entry => entry.source.startsWith('backend/src/')],
  ];
  for (const [label, configPath, matches] of groups) {
    const configFile = absolute(configPath);
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error) throw new Error(`${configPath}: 读取 TypeScript 配置失败`);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile));
    if (parsed.errors.length) throw new Error(`${configPath}: 解析 TypeScript 配置失败`);
    const filenames = manifest.entries.filter(matches).map(entry => absolute(entry.annotated));
    // 单独检查 API 文件时，也带上应用原有的 Vite 环境声明，才能识别 import.meta.env。
    if (label === '前端调用') filenames.push(absolute('src/env.d.ts'));
    const options = { ...parsed.options, noEmit: true, rootDir: undefined, outDir: undefined };
    const program = ts.createProgram(filenames, options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) {
      console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: filename => filename,
        getNewLine: () => '\n',
      }));
      throw new Error(`${label}: 类型检查失败`);
    }
    console.log(`${label}类型检查通过：${manifest.entries.filter(matches).length} 份副本`);
  }
}
