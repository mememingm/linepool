/**
 * number-service-provider.ts 中文分区导读副本：号码服务能力与模拟实现
 * 原文件：backend/src/number-service-provider.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】定义号码续期和用量能力，并提供模拟续期选项及模拟用量。
 * 【为什么这样组织】抽象类约定能力，模拟实现让开发时不必依赖供应商；返回受理与真正续期完成分别表达。
 * 【调用链】NumberServices → NumberServiceProvider；main.ts 当前绑定 MockNumberServiceProvider。
 * 【修改提示】模拟选项 [7,30] 可改为 [14,60]，日期随天数计算；实际续期接口在 NumberServices 中禁用，改这里不会自动开放。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable } from '@nestjs/common';
import type { CreateRenewalInput, NumberUsage, RenewalOptions, UsageScenario } from '@linepool/contracts';

/**
 * NumberResource = 号码资料，包含编号、电话号码、到期时间和分配编号。这里只描述结构，执行操作需看后面的函数。
 */
export type NumberResource = { id: string; phoneNumber: string; expiresAt: string; allocationId: string };
/**
 * RenewalIntent = 续期意图，在提交内容上补充内部编号与号码资料。这里只描述结构，执行操作需看后面的函数。
 */
export type RenewalIntent = CreateRenewalInput & { id: string; number: NumberResource };
/**
 * RenewalAcknowledgement = 续期请求受理结果：来源、待处理/失败状态和失败原因。这里只描述结构，执行操作需看后面的函数。
 */
export type RenewalAcknowledgement = { source: 'mock' | 'live'; status: 'PENDING' | 'FAILED'; failureReason: string | null };

/** Replace the DI binding with a server-side PingCode adapter once its contract is agreed.
 * Submission is only an acknowledgement. Verified completion must be handled separately,
 * updating renewals and phone_numbers together; a browser can never confirm success.
 */
/**
 * ==================== 01 号码服务能力与模拟实现 / NumberServiceProvider ====================
 * NumberServiceProvider = 号码服务提供器的抽象约定。规定实现者提供续期选项、提交续期请求、查询用量三个方法，本身不执行操作。
 */
export abstract class NumberServiceProvider {
  /**
   * renewalOptions = 续期选项能力声明：输入号码资料，异步返回可选天数、报价和预计到期时间。
   */
  abstract renewalOptions(number: NumberResource): Promise<RenewalOptions>;
  /**
   * requestRenewal = 续期提交能力声明：返回受理/失败状态；受理与真实续期完成分开确认。
   */
  abstract requestRenewal(intent: RenewalIntent): Promise<RenewalAcknowledgement>;
  /**
   * usage = 用量能力声明：输入号码及可选模拟场景，返回短信、语音和流量用量。
   */
  abstract usage(number: NumberResource, scenario?: UsageScenario): Promise<NumberUsage>;
}

/**
 * ==================== 02 号码服务能力与模拟实现 / MockNumberServiceProvider ====================
 * MockNumberServiceProvider = 模拟号码服务提供器。按约定生成本地示例数据，不调用真实供应商。
 */
@Injectable()
export class MockNumberServiceProvider extends NumberServiceProvider {
  // snapshotAt = 模拟数据快照时间。创建服务实例时记录一次，后面的 usage 返回它，不会每次查询都刷新。
  private readonly snapshotAt = new Date().toISOString();
  /**
   * renewalOptions = 生成模拟续期选项。取现在与原到期时间中较晚者为起点，分别加 7/30 天；积分报价 null 表示暂无报价。
   */
  async renewalOptions(number: NumberResource): Promise<RenewalOptions> {
    // base = 续期起点。未到期从原到期时间往后加；已过期从现在往后加。
    // Date.now 与 Date.parse 的结果都是毫秒时间戳，所以可以比较。
    const base = Math.max(Date.now(), Date.parse(number.expiresAt));
    return {
      numberId: number.id, currentExpiresAt: number.expiresAt, source: 'mock',
      // map 将 7、30 分别加工成一个完整选项；改成 [14,60] 就生成两种新模拟期限。
      // 此修改只影响此模拟提供器。当前实际续期入口禁用，详见 number-services.annotated.ts。
      options: [7, 30].map(durationDays => ({
        // durationDays 是天数；totalPoints:null 是暂无报价，不表示免费。
        // 86400000 = 一天的毫秒数，预计到期 = 起点 + 天数 × 一天；toISOString 把时间整理成接口文字。
        durationDays, totalPoints: null, estimatedExpiresAt: new Date(base + durationDays * 86400000).toISOString(),
      })),
    };
  }
  /**
   * requestRenewal = 模拟受理续期，只返回 PENDING，未扣款、未执行供应商操作、未修改实际到期时间。
   */
  async requestRenewal(_intent: RenewalIntent): Promise<RenewalAcknowledgement> {
    // No charge, supplier execution, simulated completion, or expiry mutation.
    return { source: 'mock', status: 'PENDING', failureReason: null };
  }
  /**
   * usage = 生成模拟用量。standard 返回固定额度；unlimited 返回无限额度；其他场景返回无套餐、不支持或错误状态。
   */
  async usage(number: NumberResource, scenario: UsageScenario = 'standard'): Promise<NumberUsage> {
    // 以下 100/36/64 等是模拟额度数据。可以改这些数观察展示，但要保持 remaining=max(0,total-used)。
    // 本契约没有在字段中注明语音或流量单位，不要只根据数字推断单位。
    const snapshot: NumberUsage = {
      numberId: number.id, source: 'mock', updatedAt: this.snapshotAt,
      sms: { kind: 'metered', total: 100, used: 36, remaining: 64 },
      voice: { kind: 'metered', total: 60, used: 12, remaining: 48 },
      data: { kind: 'metered', total: 1024, used: 256, remaining: 768 },
    };
    if (scenario === 'unlimited') return { ...snapshot, sms: { kind: 'unlimited', used: 136 }, voice: { kind: 'unlimited', used: null }, data: { kind: 'unlimited', used: 2048 } };
    if (scenario !== 'standard') {
      const quota = { kind: scenario };
      return { ...snapshot, updatedAt: scenario === 'error' ? null : snapshot.updatedAt, sms: quota, voice: quota, data: quota };
    }
    return snapshot;
  }
}
