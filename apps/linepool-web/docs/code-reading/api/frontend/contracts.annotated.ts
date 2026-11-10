/**
 * contracts.ts 中文分区导读副本：前端共享契约转发入口
 * 原文件：src/linepool/api/contracts.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。前端使用浏览器 fetch 发送请求，或使用查询工具管理结果缓存。
 * 【整体用途】把共享包的导出转发给原有前端导入路径。
 * 【为什么这样组织】保留页面已有导入路径，同时让前后端使用同一份规则。
 * 【调用链】页面或 client.ts → 此转发文件 → packages/contracts/src/index.ts。
 * 【修改提示】修改字段规则应进入共享包；只改这个转发文件不会产生新业务规则。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
// Keep existing frontend imports compatible with the shared package.
export * from '@linepool/contracts';
