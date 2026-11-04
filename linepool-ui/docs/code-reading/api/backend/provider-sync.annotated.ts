/**
 * provider-sync.ts 中文分区导读副本：供应商库存同步能力
 * 原文件：backend/src/provider-sync.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】约定供应商快照格式，记录同步任务，合并资源快照并登记/处理冲突。
 * 【为什么这样组织】对完整和增量快照分别处理，资源存在持有人时不应直接覆盖；冲突单独留痕。
 * 【调用链】显式调用 ProviderSyncService.run → 适配器 snapshot → applySnapshot → 冲突记录。
 * 【修改提示】当前 main.ts 未注册本服务，UnconfiguredInventoryAdapter 不提供真实同步；新增适配器不等于已接通生产。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from '../../../../backend/src/database.js';
import { ApiFailure } from '../../../../backend/src/http.js';
import { safeErrorDetails } from '../../../../backend/src/error-summary.js';

/**
 * syncResourceSchema = 单条供应商同步资源规则。外部编号、手机号、地区、资源状态与到期时间独立于供应商原始报文。
 * 字段速读：phoneNumber 电话号码；region 地区；status 状态。
 */
export const syncResourceSchema = z.strictObject({
  externalNumberId: z.string().trim().min(1).max(200),
  phoneNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/).nullable(),
  region: z.enum(['us','gb','ca','sg','de','nl']).optional(),
  status: z.enum(['ONLINE','OFFLINE','ERROR']),
  resourceExpiresAt: z.string().datetime({ offset: true }).nullable(),
});
/**
 * snapshotSchema = 同步快照规则。最多 10000 条且外部编号唯一；complete 表示是否能把未出现的资源视为完整快照中的缺失。
 */
const snapshotSchema = z.strictObject({ resources: z.array(syncResourceSchema).max(10000), complete: z.boolean() })
  .refine(value => new Set(value.resources.map(r => r.externalNumberId)).size === value.resources.length, 'Duplicate external number IDs');
/**
 * ProviderSyncResource = syncResourceSchema 对应的数据类型。让编辑器提示字段；真正接收数据时仍由 schema 检查。
 */
export type ProviderSyncResource = z.infer<typeof syncResourceSchema>;
/**
 * ProviderSyncMode = 同步模式，区分完整快照与增量快照。这里只描述结构，执行操作需看后面的函数。
 */
export type ProviderSyncMode = 'INCREMENTAL' | 'FULL' | 'MANUAL';
/**
 * SyncProject = 一次同步对应的平台项目。这里只描述结构，执行操作需看后面的函数。
 */
export type SyncProject = { provider: string; externalProjectId: string; platformId: string };

/** Normalized internal contract, not a claimed production PC HTTP API. No credentials or raw responses enter task records. */
/**
 * ==================== 01 供应商库存同步能力 / ProviderInventoryAdapter ====================
 * ProviderInventoryAdapter = 供应商库存适配的抽象约定，声明支持哪些项目、如何读取规范快照；与具体供应商 HTTP 报文分开。
 */
export abstract class ProviderInventoryAdapter {
  /**
   * supports = 适配器是否支持给定平台项目。抽象方法由实现决定；当前 UnconfiguredInventoryAdapter 总是返回 false。
   */
  abstract supports(project: SyncProject): boolean;
  /**
   * snapshot = 读取供应商资源快照的能力。未配置实现直接抛错，不会生成虚假的上游库存。
   */
  abstract snapshot(project: SyncProject, mode: ProviderSyncMode, signal: AbortSignal): Promise<z.infer<typeof snapshotSchema>>;
}
/**
 * ==================== 02 供应商库存同步能力 / UnconfiguredInventoryAdapter ====================
 * UnconfiguredInventoryAdapter = 尚未配置的库存适配器。supports 返回 false，snapshot 抛错，不生成假库存。
 */
@Injectable()
export class UnconfiguredInventoryAdapter extends ProviderInventoryAdapter {
  /**
   * supports = 适配器是否支持给定平台项目。抽象方法由实现决定；当前 UnconfiguredInventoryAdapter 总是返回 false。
   */
  supports(): boolean { return false; }
  /**
   * snapshot = 读取供应商资源快照的能力。未配置实现直接抛错，不会生成虚假的上游库存。
   */
  async snapshot(): Promise<never> { throw new Error('Inventory adapter is not configured'); }
}
/**
 * Task = 库存同步任务的数据库记录。这里只描述结构，执行操作需看后面的函数。
 */
type Task = { id: string; provider: string; external_project_id: string; platform_id: string; mode: ProviderSyncMode; status: string };

/**
 * ==================== 03 供应商库存同步能力 / ProviderSyncService ====================
 * ProviderSyncService = 供应商库存同步能力。约定供应商快照格式，记录同步任务，合并资源快照并登记/处理冲突。
 */
@Injectable()
export class ProviderSyncService {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database, @Optional() private readonly adapter: ProviderInventoryAdapter = new UnconfiguredInventoryAdapter()) {}

  /**
   * run = 创建并执行同步任务。锁项目、检查运行租约和适配器，带超时读取并校验快照，再合并或记录失败。
   */
  async run(provider: string, externalProjectId: string, mode: ProviderSyncMode, actorId?: string, reason?: string) {
    const task = await this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sync:${provider}:${externalProjectId}`]);
      const { rows: [project] } = await client.query<{ platform_id: string; is_active: boolean }>(
        'SELECT platform_id,is_active FROM provider_projects WHERE provider=$1 AND external_project_id=$2 FOR UPDATE', [provider, externalProjectId]);
      if (!project) throw new ApiFailure(404, 'PROVIDER_PROJECT_NOT_FOUND', 'Provider project is not configured');
      if (!project.is_active) throw new ApiFailure(409, 'PROVIDER_PROJECT_DISABLED', 'Provider project is disabled');
      // Reclaim crashed local readers after the bounded adapter call has long expired. No resource mutation occurred yet.
      await client.query(`UPDATE provider_sync_tasks SET status='FAILED',finished_at=now(),error_message='SYNC_WORKER_EXPIRED',failed_count=1
        WHERE provider=$1 AND external_project_id=$2 AND status='RUNNING' AND started_at<now()-interval '5 minutes'`, [provider, externalProjectId]);
      const running = await client.query("SELECT id FROM provider_sync_tasks WHERE provider=$1 AND external_project_id=$2 AND status IN ('PENDING','RUNNING')", [provider, externalProjectId]);
      if (running.rowCount) throw new ApiFailure(409, 'SYNC_ALREADY_RUNNING', 'A sync is already running for this project');
      const { rows: [created] } = await client.query<{ id: string }>(`INSERT INTO provider_sync_tasks(provider,external_project_id,mode,status,started_at)
        VALUES($1,$2,$3,'RUNNING',now()) RETURNING id`, [provider, externalProjectId, mode]);
      await client.query(`UPDATE provider_projects SET sync_status='RUNNING',last_sync_started_at=now(),last_sync_error=NULL
        WHERE provider=$1 AND external_project_id=$2`, [provider, externalProjectId]);
      if (actorId) await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,after_data)
        VALUES($1,'PROVIDER_SYNC',$2,$3,$4)`, [actorId, `${provider}/${externalProjectId}`, reason, { taskId: created!.id, mode }]);
      return { id: created!.id, provider, external_project_id: externalProjectId, platform_id: project.platform_id, mode, status: 'RUNNING' } satisfies Task;
    });
    const project = { provider, externalProjectId, platformId: task.platform_id };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    try {
      if (!this.adapter.supports(project)) return this.finish(task, 'UNSUPPORTED', 'INVENTORY_ADAPTER_NOT_CONNECTED');
      // The committed task is the project lease; never wait for upstream while holding a DB transaction.
      const response = await Promise.race([
        this.adapter.snapshot(project, mode, abort.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('SYNC_TIMEOUT')); }, 30000); }),
      ]);
      const snapshot = snapshotSchema.parse(response);
      if (mode === 'FULL' && !snapshot.complete) throw new Error('INCOMPLETE_FULL_SNAPSHOT');
      return await this.applySnapshot(task, snapshot);
    } catch (error) {
      console.error('Provider inventory sync failed', { taskId: task.id, ...safeErrorDetails(error) });
      // Store a bounded local error code; upstream errors may contain credentials or entire response bodies.
      return this.finish(task, 'FAILED', abort.signal.aborted ? 'SYNC_TIMEOUT' : 'SYNC_ADAPTER_OR_SNAPSHOT_FAILED');
    } finally { if (timer) clearTimeout(timer); }
  }

  /**
   * finish = 只把仍 RUNNING 的任务更新为结束状态，同时保存项目最近同步结果及失败计数。
   */
  private async finish(task: Task, status: 'FAILED' | 'UNSUPPORTED', error: string) {
    return this.db.transaction(async client => {
      const changed = await client.query(`UPDATE provider_sync_tasks SET status=$2,finished_at=now(),error_message=$3,failed_count=$4,
        result=$5 WHERE id=$1 AND status='RUNNING' RETURNING id`, [task.id, status, error, status === 'FAILED' ? 1 : 0, { status, reason: error }]);
      if (changed.rowCount) await client.query(`UPDATE provider_projects SET sync_status=$3,last_sync_finished_at=now(),last_sync_error=$4,
        last_sync_result=$5,consecutive_sync_failures=consecutive_sync_failures+$6 WHERE provider=$1 AND external_project_id=$2`,
        [task.provider, task.external_project_id, status, error, { taskId: task.id, status }, status === 'FAILED' ? 1 : 0]);
      return { taskId: task.id, status, reason: error };
    });
  }

  /**
   * applySnapshot = 在事务中合并资源快照，检查任务租约与映射、维护号码/平台资源、记录缺失/冲突并保存任务结果。
   */
  private async applySnapshot(task: Task, snapshot: z.infer<typeof snapshotSchema>) {
    return this.db.transaction(async client => {
      // Serialize physical resources shared by different projects as well as this project's task lease.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sync-apply:${task.provider}`]);
      const lease = await client.query("SELECT id FROM provider_sync_tasks WHERE id=$1 AND status='RUNNING' FOR UPDATE", [task.id]);
      if (!lease.rowCount) throw new ApiFailure(409, 'SYNC_LEASE_LOST', 'Sync task is no longer running');
      const project = await client.query('SELECT platform_id FROM provider_projects WHERE provider=$1 AND external_project_id=$2 AND is_active FOR SHARE', [task.provider, task.external_project_id]);
      if (!project.rowCount) throw new ApiFailure(409, 'PROVIDER_PROJECT_DISABLED', 'Provider project is disabled');
      const { rows: existing } = await client.query<{ external_number_id: string; number_id: string }>(`SELECT b.external_number_id,s.number_id
        FROM number_platforms s JOIN provider_resource_bindings b ON b.number_id=s.number_id AND b.provider=s.provider
          AND b.external_project_id=s.external_project_id
        WHERE s.provider=$1 AND s.external_project_id=$2`, [task.provider, task.external_project_id]);
      let added = 0, updated = 0, offline = 0, failed = 0, conflicts = 0;
      const seen = new Set(snapshot.resources.map(r => r.externalNumberId));
      for (const resource of [...snapshot.resources].sort((a,b) => a.externalNumberId.localeCompare(b.externalNumberId))) {
        const { rows: [binding] } = await client.query<{ number_id: string; phone_number: string; region_id: string }>(`SELECT b.number_id,n.phone_number,n.region_id
          FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id WHERE b.provider=$1 AND b.external_number_id=$2`,
          [task.provider, resource.externalNumberId]);
        let numberId = binding?.number_id;
        if (binding && ((resource.phoneNumber && resource.phoneNumber !== binding.phone_number) || (resource.region && resource.region !== binding.region_id))) {
          failed++; conflicts += await this.openConflict(client, task, resource.externalNumberId, binding.number_id, 'RESOURCE_UNMAPPED', { reason: 'IDENTITY_MISMATCH' }); continue;
        }
        if (!numberId) {
          if (!resource.phoneNumber || !resource.region) {
            failed++; conflicts += await this.openConflict(client, task, resource.externalNumberId, null, 'RESOURCE_UNMAPPED', { reason: 'PHONE_AND_REGION_REQUIRED' }); continue;
          }
          const collision = await client.query('SELECT id FROM phone_numbers WHERE phone_number=$1', [resource.phoneNumber]);
          if (collision.rowCount) {
            failed++; conflicts += await this.openConflict(client, task, resource.externalNumberId, null, 'RESOURCE_UNMAPPED', { reason: 'PHONE_ALREADY_BOUND_OR_LOCAL' }); continue;
          }
          const { rows: [number] } = await client.query<{ id: string }>(`INSERT INTO phone_numbers(region_id,service,phone_number,resource_status,resource_expires_at)
            VALUES($1,$2,$3,$4,$5) RETURNING id`, [resource.region, task.platform_id, resource.phoneNumber, resource.status, resource.resourceExpiresAt]);
          numberId = number!.id;
          await client.query('INSERT INTO provider_resource_bindings(provider,external_project_id,external_number_id,number_id) VALUES($1,$2,$3,$4)', [task.provider, task.external_project_id, resource.externalNumberId, numberId]);
        }
        const inserted = await client.query(`INSERT INTO number_platforms(number_id,platform_id,provider,external_project_id,sale_enabled,is_available)
          VALUES($1,$2,$3,$4,false,$5) ON CONFLICT(number_id,platform_id) DO NOTHING RETURNING id`,
          [numberId, task.platform_id, task.provider, task.external_project_id, resource.status === 'ONLINE']);
        const slot = await client.query(`SELECT id FROM number_platforms WHERE number_id=$1 AND platform_id=$2 AND provider=$3 AND external_project_id=$4 FOR UPDATE`,
          [numberId, task.platform_id, task.provider, task.external_project_id]);
        if (!slot.rowCount) throw new ApiFailure(409, 'SYNC_MAPPING_CHANGED', 'Number platform mapping changed');
        await client.query('UPDATE phone_numbers SET resource_status=$2,resource_expires_at=$3 WHERE id=$1', [numberId, resource.status, resource.resourceExpiresAt]);
        await client.query('UPDATE number_platforms SET is_available=$3,synced_at=now() WHERE number_id=$1 AND platform_id=$2', [numberId, task.platform_id, resource.status === 'ONLINE']);
        if (inserted.rowCount) added++; else updated++;
        if (resource.status !== 'ONLINE') offline++;
        conflicts += await this.checkResource(client, task, resource.externalNumberId, numberId, resource.status, resource.resourceExpiresAt);
      }
      // Only an explicitly complete FULL snapshot can prove that a previously known resource disappeared.
      if (task.mode === 'FULL' && snapshot.complete) for (const slot of existing) {
        if (seen.has(slot.external_number_id)) continue;
        await client.query('SELECT id FROM number_platforms WHERE number_id=$1 AND platform_id=$2 FOR UPDATE', [slot.number_id, task.platform_id]);
        await client.query("UPDATE phone_numbers SET resource_status='OFFLINE' WHERE id=$1", [slot.number_id]);
        await client.query('UPDATE number_platforms SET is_available=false,synced_at=now() WHERE number_id=$1 AND platform_id=$2', [slot.number_id, task.platform_id]);
        conflicts += await this.checkResource(client, task, slot.external_number_id, slot.number_id, 'OFFLINE', null, true);
        offline++;
      }
      const result = { fetchedCount: snapshot.resources.length, addedCount: added, updatedCount: updated, offlineCount: offline, failedCount: failed, conflictCount: conflicts };
      const status = failed ? 'FAILED' : 'SUCCEEDED';
      await client.query(`UPDATE provider_sync_tasks SET status=$2,finished_at=now(),fetched_count=$3,added_count=$4,updated_count=$5,
        offline_count=$6,failed_count=$7,conflict_count=$8,result=$9,error_message=$10 WHERE id=$1`,
        [task.id, status, snapshot.resources.length, added, updated, offline, failed, conflicts, result, failed ? 'RESOURCE_MAPPING_REQUIRES_REVIEW' : null]);
      await client.query(`UPDATE provider_projects SET sync_status=$3,last_sync_finished_at=now(),last_sync_result=$4,
        synced_at=CASE WHEN $3='SUCCEEDED' THEN now() ELSE synced_at END,
        consecutive_sync_failures=CASE WHEN $3='FAILED' THEN consecutive_sync_failures+1 ELSE 0 END,last_sync_error=$5
        WHERE provider=$1 AND external_project_id=$2`, [task.provider, task.external_project_id, status, result, failed ? 'RESOURCE_MAPPING_REQUIRES_REVIEW' : null]);
      return { taskId: task.id, status, ...result };
    });
  }

  /**
   * checkResource = 核对资源状态和到期时间是否覆盖已有分配；不健康则登记冲突，恢复正常则关闭此前未解决冲突。
   */
  private async checkResource(client: PoolClient, task: Task, externalId: string, numberId: string, status: string, expiresAt: string | null, missing = false) {
    const { rows: allocations } = await client.query<{ id: string; user_id: string; order_id: string | null; expires_at: Date }>(`SELECT id,user_id,order_id,expires_at
      FROM number_allocations WHERE number_id=$1 AND released_at IS NULL AND expires_at>now() ORDER BY id`, [numberId]);
    const affected = allocations.filter(a => status !== 'ONLINE' || !expiresAt || Date.parse(expiresAt) < a.expires_at.getTime());
    const problem = missing ? 'RESOURCE_MISSING' : status !== 'ONLINE' ? 'RESOURCE_UNAVAILABLE'
      : (!expiresAt || Date.parse(expiresAt) < Date.now() + 7 * 86400000 || affected.length) ? 'RESOURCE_EXPIRED' : null;
    if (problem) return this.openConflict(client, task, externalId, numberId, problem, { status, resourceExpiresAt: expiresAt,
      affected: affected.map(a => ({ allocationId: a.id, userId: a.user_id, orderId: a.order_id, expiresAt: a.expires_at.toISOString(),
        shortfallDays: expiresAt ? Math.max(0, Math.ceil((a.expires_at.getTime() - Date.parse(expiresAt)) / 86400000)) : null })) });
    await client.query(`UPDATE provider_sync_conflicts SET status='RESOLVED',resolved_at=now(),resolution='Resource healthy after sync',last_seen_at=now()
      WHERE provider=$1 AND external_project_id=$2 AND external_number_id=$3 AND status='OPEN'`, [task.provider, task.external_project_id, externalId]);
    return 0;
  }
  /**
   * openConflict = 建立或更新一个未解决的同步冲突。同资源同类型冲突去重并更新最近出现时间。
   */
  private async openConflict(client: PoolClient, task: Task, externalId: string, numberId: string | null, type: string, details: unknown) {
    const { rows } = await client.query<{ inserted: boolean }>(`INSERT INTO provider_sync_conflicts(task_id,provider,external_project_id,external_number_id,number_id,conflict_type,details)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider,external_project_id,external_number_id,conflict_type) WHERE status='OPEN'
      DO UPDATE SET task_id=EXCLUDED.task_id,number_id=EXCLUDED.number_id,details=EXCLUDED.details,last_seen_at=now() RETURNING (xmax=0) AS inserted`,
      [task.id, task.provider, task.external_project_id, externalId, numberId, type, details]);
    return rows[0]!.inserted ? 1 : 0;
  }
  /**
   * resolveConflict = 管理员处理冲突的内部业务方法，保存处理人/理由并写审计；当前 main.ts 未装配本同步服务。
   */
  async resolveConflict(actorId: string, id: string, reason: string) {
    return this.db.transaction(async client => {
      const { rows: [before] } = await client.query('SELECT * FROM provider_sync_conflicts WHERE id=$1 FOR UPDATE', [id]);
      if (!before) throw new ApiFailure(404, 'SYNC_CONFLICT_NOT_FOUND', 'Sync conflict not found');
      if (before.status === 'RESOLVED') return { changed: false };
      await client.query("UPDATE provider_sync_conflicts SET status='RESOLVED',resolved_at=now(),resolved_by=$2,resolution=$3 WHERE id=$1", [id, actorId, reason]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data)
        VALUES($1,'SYNC_CONFLICT_RESOLVE',$2,$3,$4,$5)`, [actorId, id, reason, before, { status: 'RESOLVED' }]);
      return { changed: true };
    });
  }
}
