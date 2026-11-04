/**
 * number-services.ts 中文分区导读副本：号码续期与用量业务
 * 原文件：backend/src/number-services.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】核对号码归属，提供用量和续期历史入口；当前拒绝查询续期选项和创建续期。
 * 【为什么这样组织】号码必须属于当前用户且仍有效；模拟数据和真实续期完成不能混为一谈。
 * 【调用链】NumberServicesController → ownedNumber → provider.usage 或续期历史 SQL。
 * 【修改提示】options/create 当前明确抛出 RENEWAL_DISABLED；不能通过只改 provider 的天数开放续期。完整接通需单独设计确认及入账流程。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { isStorefrontRegion, numberUsageSchema, renewalRecordSchema,
  type CreateRenewalInput, type PaginationQuery, type RenewalRecord, type UsageQuery } from '@linepool/contracts';
import { Database } from '../../../../backend/src/database.js';
import { ApiFailure } from '../../../../backend/src/http.js';
import { NumberServiceProvider, type NumberResource } from '../../../../backend/src/number-service-provider.js';

/**
 * RenewalRow = 数据库读取出的续期记录。这里只描述结构，执行操作需看后面的函数。
 */
type RenewalRow = {
  id: string; renewal_number: string; number_id: string; phone_number: string;
  original_expires_at: Date; duration_days: number; estimated_expires_at: Date | null;
  confirmed_expires_at: Date | null; total_points: number | null; execution_status: string;
  data_source: 'mock' | 'live'; failure_reason: string | null; created_at: Date;
};
/**
 * renewalFrom = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const renewalFrom = 'FROM renewals x JOIN number_allocations a ON a.id=x.allocation_id JOIN phone_numbers n ON n.id=a.number_id';
/**
 * renewalFields = 复用的 SQL 查询片段。集中定义关联表或返回字段，后面的方法再补用户归属、筛选和分页；SQL 负责数据库查询，不是 TypeScript 字段声明。
 */
const renewalFields = 'x.*,a.number_id,n.phone_number';
/**
 * toRenewal = 数据库续期记录转接口记录。只有真实来源且数据库确认完成才展示 SUCCESS，其余按失败或待处理返回。
 */
function toRenewal(row: RenewalRow): RenewalRecord {
  return renewalRecordSchema.parse({
    id: row.id, renewalNumber: row.renewal_number, numberId: row.number_id, phoneNumber: row.phone_number,
    originalExpiresAt: row.original_expires_at.toISOString(), durationDays: row.duration_days,
    estimatedExpiresAt: row.estimated_expires_at?.toISOString() ?? null,
    confirmedExpiresAt: row.confirmed_expires_at?.toISOString() ?? null,
    totalPoints: row.total_points, source: row.data_source,
    status: row.execution_status === 'COMPLETED' && row.data_source === 'live' ? 'SUCCESS' : row.execution_status === 'FAILED' ? 'FAILED' : 'PENDING',
    failureReason: row.failure_reason, createdAt: row.created_at.toISOString(),
  });
}
/**
 * ==================== 01 号码续期与用量业务 / NumberServices ====================
 * NumberServices = 号码续期与用量业务。核对号码归属，提供用量和续期历史入口；当前拒绝查询续期选项和创建续期。
 */
@Injectable()
export class NumberServices {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, private readonly provider: NumberServiceProvider) {}
  /**
   * ownedNumber = 核对号码仍属于当前用户且服务有效。可以按号码或分配编号查询；同号码多平台无法唯一定位时要求明确分配编号。
   */
  private async ownedNumber(userId: string, id: string, client?: PoolClient): Promise<NumberResource & { region: string }> {
    const query = `SELECT n.id,n.phone_number,n.region_id,a.expires_at,a.id AS allocation_id
      FROM phone_numbers n JOIN number_allocations a ON a.number_id=n.id
      WHERE (n.id=$1 OR a.id=$1) AND a.user_id=$2 AND a.released_at IS NULL AND a.expires_at>now()
      AND (a.order_id IS NULL OR EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED'))${client ? ' FOR UPDATE OF a' : ''}`;
    type OwnedNumberRow = { id: string; phone_number: string; region_id: string; expires_at: Date; allocation_id: string };
    const { rows } = client
      ? await client.query<OwnedNumberRow>(query, [id, userId])
      : await this.db.query<OwnedNumberRow>(query, [id, userId]);
    if (rows.length > 1) throw new ApiFailure(409, 'PLATFORM_REQUIRED', 'Use the platform service allocation ID');
    const row = rows[0];
    if (!row) throw new ApiFailure(404, 'NUMBER_NOT_FOUND', 'Number is unavailable or no longer assigned to this account');
    return { id: row.id, region: row.region_id, phoneNumber: row.phone_number, expiresAt: row.expires_at.toISOString(), allocationId: row.allocation_id };
  }
  /**
   * options = 续期选项业务入口。先核对归属与国家，再明确返回 403 RENEWAL_DISABLED；当前不会调用 provider.renewalOptions。
   */
  async options(userId: string, numberId: string) {
    const number = await this.ownedNumber(userId, numberId);
    if (!isStorefrontRegion(number.region)) throw new ApiFailure(409, 'REGION_NOT_AVAILABLE', 'This region is not open for storefront renewal');
    throw new ApiFailure(403, 'RENEWAL_DISABLED', 'Short-term SMS receiving services do not support renewal');
  }
  /**
   * usage = 查询号码用量。核对号码归属后调用 provider.usage，并按 numberUsageSchema 检查返回格式。
   */
  async usage(userId: string, numberId: string, query: UsageQuery) {
    return numberUsageSchema.parse(await this.provider.usage(await this.ownedNumber(userId, numberId), query.scenario));
  }
  /**
   * list = 分页查询属于当前用户的续期历史，使用一致只读快照查询总数和记录，再映射返回。
   */
  async list(userId: string, numberId: string, input: PaginationQuery) {
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${renewalFrom} WHERE a.user_id=$1 AND (a.number_id=$2 OR a.id=$2)`, [userId, numberId]);
      const { rows } = await client.query<RenewalRow>(`SELECT ${renewalFields} ${renewalFrom}
        WHERE a.user_id=$1 AND (a.number_id=$2 OR a.id=$2) ORDER BY x.created_at DESC,x.id DESC LIMIT $3 OFFSET $4`,
      [userId, numberId, input.pageSize, (input.page - 1) * input.pageSize]);
      return { data: rows.map(toRenewal), pagination: { ...input, totalItems: count!.total, totalPages: Math.ceil(count!.total / input.pageSize) } };
    });
  }
  /**
   * create = 提交续期业务入口。先核对归属与国家，再明确返回 403 RENEWAL_DISABLED；当前不会创建续期记录。
   */
  async create(userId: string, numberId: string, _input: CreateRenewalInput) {
    const number = await this.ownedNumber(userId, numberId);
    if (!isStorefrontRegion(number.region)) throw new ApiFailure(409, 'REGION_NOT_AVAILABLE', 'This region is not open for storefront renewal');
    throw new ApiFailure(403, 'RENEWAL_DISABLED', 'Short-term SMS receiving services do not support renewal');
  }
}
