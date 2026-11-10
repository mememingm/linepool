/**
 * database.ts 中文分区导读副本：数据库查询与事务入口
 * 原文件：backend/src/database.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】创建 PostgreSQL 连接池，并为所有业务提供 query 和 transaction。
 * 【为什么这样组织】事务内多次更新同成同败，finally 归还连接，减少余额和库存更新一半的情况。
 * 【调用链】业务层 → db.query 或 db.transaction → PostgreSQL。
 * 【修改提示】连接池 max:10；连接等待 5000ms，空闲 30000ms，SQL 执行上限 10000ms。它们与前端请求超时是独立限制。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { Environment } from '../../../../backend/src/environment.js';

/**
 * ==================== 01 数据库查询与事务入口 / Database ====================
 * Database = 数据库查询与事务入口。创建 PostgreSQL 连接池，并为所有业务提供 query 和 transaction。
 */
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: pg.Pool;
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(environment: Environment) {
    // 连接池复用数据库连接。以下时间均为毫秒；statement_timeout 限制 SQL，不等同于浏览器等待时长。
    this.pool = new pg.Pool({
      connectionString: environment.values.DATABASE_URL, max: 10,
      options: environment.testSchema ? `-c search_path=${environment.testSchema}` : undefined,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    this.pool.on('error', () => console.error('PostgreSQL idle connection failed'));
  }
  /**
   * query = 执行一次带参数的 SQL。text 是 SQL，values 是 $1/$2 对应的值；后端通过它读写数据库。
   */
  query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }
  /**
   * transaction = 数据库事务。获取连接 → BEGIN → 执行 work → COMMIT；失败 ROLLBACK，最后归还连接。
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  /**
   * onModuleDestroy = 关闭数据库连接池。应用结束时等待 pool.end 完成。
   */
  async onModuleDestroy() { await this.pool.end(); }
}
