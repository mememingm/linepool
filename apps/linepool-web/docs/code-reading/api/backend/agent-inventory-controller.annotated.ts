/**
 * agent-inventory-controller.ts 中文分区导读副本：代理库存接口入口
 * 原文件：backend/src/agent-inventory-controller.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】接收代理身份、下级、客户、库存、转移、报价、账本和结算请求。
 * 【为什么这样组织】入口统一检查请求格式，业务层进一步确认当前身份能看到或修改哪些数据。
 * 【调用链】client.ts 的 agent 方法 → /api/agent-inventory → AgentInventory。
 * 【修改提示】变更路径/字段要同步前端与共享契约；管理员和普通代理的可见范围不同，不能只隐藏前端按钮。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  adjustBalanceInputSchema, agentInventoryQuerySchema, agentNumberImportInputSchema, agentStatusInputSchema, agentStockQuerySchema, agentTransactionsQuerySchema,
  claimAgentNumberInputSchema, claimAgentNumbersInputSchema, createAgentInputSchema, createCustomerInputSchema, createHoldingInputSchema, createTxOrderInputSchema, assignHoldingInputSchema,
  settlementQuoteInputSchema, type SettlementQuoteInput, holdingBatchInputSchema, holdingBatchPreviewInputSchema, type HoldingBatchInput, type HoldingBatchPreviewInput,
  paginationQuerySchema, releaseHoldingInputSchema, resellHoldingInputSchema, transferBalanceInputSchema, upsertPriceRuleInputSchema, uuidSchema,
  type AdjustBalanceInput, type AgentInventoryQuery, type AgentNumberImportInput, type AgentStatusInput, type AgentStockQuery, type AgentTransactionsQuery,
  type ClaimAgentNumberInput, type ClaimAgentNumbersInput, type CreateAgentInput, type CreateCustomerInput, type CreateHoldingInput, type CreateTxOrderInput, type AssignHoldingInput, type OwnerRef,
  type PaginationQuery, type ReleaseHoldingInput, type ResellHoldingInput, type TransferBalanceInput, type UpsertPriceRuleInput,
  createSubagentInputSchema, subagentsQuerySchema, subagentStatusInputSchema, updateAgentNameInputSchema, agentMetricPeriodSchema,
  type SubagentsQuery, type UpdateAgentNameInput, type AgentMetricPeriod,
  updateCustomerInputSchema, ledgerQuerySchema, type UpdateCustomerInput, type LedgerQuery,
} from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from '../../../../backend/src/authentication.js';
import { ApiFailure, SchemaPipe } from '../../../../backend/src/http.js';
import { AgentInventory } from '../../../../backend/src/agent-inventory.js';
import { Database } from '../../../../backend/src/database.js';

/**
 * ownerRefParamsSchema = 账本路径里的持有人规则。ownerType 是小写 agent/customer，ownerId 是 UUID。
 * 字段速读：ownerType 持有人类别。
 */
const ownerRefParamsSchema = z.object({
  ownerType: z.enum(['agent', 'customer']),
  ownerId: uuidSchema,
});

/**
 * toOwnerRef = 把网址中的小写身份和 ownerId，转换成内部 AGENT/agentId 或 CUSTOMER/customerId 结构。
 */
function toOwnerRef(params: { ownerType: 'agent' | 'customer'; ownerId: string }): OwnerRef {
  return params.ownerType === 'agent'
    ? { ownerType: 'AGENT', agentId: params.ownerId }
    : { ownerType: 'CUSTOMER', customerId: params.ownerId };
}

/**
 * ==================== 01 代理库存接口入口 / AgentInventoryController ====================
 * AgentInventoryController = 代理库存接口入口。接收代理身份、下级、客户、库存、转移、报价、账本和结算请求。
 */
@Controller('agent-inventory')
@UseGuards(SessionGuard)
export class AgentInventoryController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly inventory: AgentInventory, private readonly db: Database) {}

  /**
   * context = 解析当前代理业务身份与可用能力，页面据此展示可用操作。
   * 接口：GET /api/agent-inventory/context。接收：登录用户与请求信息(request)。
   */
  @Get('context')
  context(@Req() request: SessionRequest) { return this.inventory.context(request.user.id); }

  /**
   * updateProfile = 修改当前代理的业务名称，区别于登录账户资料修改。
   * 接口：PATCH /api/agent-inventory/profile。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Patch('profile')
  updateProfile(@Req() request: SessionRequest, @Body(new SchemaPipe(updateAgentNameInputSchema)) input: UpdateAgentNameInput) {
    return this.inventory.updateProfile(request.user.id, input);
  }

  /**
   * updateCustomer = 修改客户名称和启用状态，核对归属并记录理由。
   * 接口：PATCH /api/agent-inventory/customers/:customerId。接收：登录用户与请求信息(request)、路径参数(customerId)、请求体(input)。
   */
  @Patch('customers/:customerId')
  updateCustomer(@Req() request: SessionRequest, @Param('customerId', new SchemaPipe(uuidSchema)) customerId: string,
    @Body(new SchemaPipe(updateCustomerInputSchema)) input: UpdateCustomerInput) {
    return this.inventory.updateCustomer(request.user.id, customerId, input);
  }

  /**
   * dashboard = 查询当前身份的首页汇总。统计范围由用户/代理归属和 period 决定。
   * 接口：GET /api/agent-inventory/dashboard。接收：登录用户与请求信息(request)、地址查询参数(period)。
   */
  @Get('dashboard')
  dashboard(@Req() request: SessionRequest, @Query('period', new SchemaPipe(agentMetricPeriodSchema)) period: AgentMetricPeriod = '7d') {
    return this.inventory.dashboard(request.user.id, period);
  }

  /**
   * subagents = 查询下级代理列表，按搜索与状态分页。
   * 接口：GET /api/agent-inventory/subagents。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('subagents')
  subagents(@Req() request: SessionRequest, @Query(new SchemaPipe(subagentsQuerySchema)) input: SubagentsQuery) {
    return this.inventory.subagents(request.user.id, input);
  }

  /**
   * createSubagent = 创建直属下级代理。后端确认当前上下级关系，不直接信任请求中的层级。
   * 接口：POST /api/agent-inventory/subagents。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('subagents')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createSubagent(@Req() request: SessionRequest,
    @Body(new SchemaPipe(createSubagentInputSchema)) input: { userId: string; name: string; idempotencyKey: string }) {
    await this.inventory.context(request.user.id);
    const result = await this.inventory.createAgent(request.user.id, { ...input, parentAgentId: null, level: 1 });
    const { userId: _userId, ...profile } = result.data;
    return { data: profile };
  }

  /**
   * subagent = 读取一个直属下级代理详情。
   * 接口：GET /api/agent-inventory/subagents/:agentId。接收：登录用户与请求信息(request)、路径参数(agentId)。
   */
  @Get('subagents/:agentId')
  subagent(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string) {
    return this.inventory.subagent(request.user.id, agentId);
  }

  /**
   * renameSubagent = 修改直属下级代理的业务名称。
   * 接口：PATCH /api/agent-inventory/subagents/:agentId/name。接收：登录用户与请求信息(request)、路径参数(agentId)、请求体(input)。
   */
  @Patch('subagents/:agentId/name')
  renameSubagent(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Body(new SchemaPipe(updateAgentNameInputSchema)) input: UpdateAgentNameInput) {
    return this.inventory.renameSubagent(request.user.id, agentId, input);
  }

  /**
   * updateSubagentStatus = 核对直属下级后修改启用/暂停状态。
   * 接口：PATCH /api/agent-inventory/subagents/:agentId/status。接收：登录用户与请求信息(request)、路径参数(agentId)、请求体(input)。
   */
  @Patch('subagents/:agentId/status')
  async updateSubagentStatus(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Body(new SchemaPipe(subagentStatusInputSchema)) input: AgentStatusInput) {
    await this.inventory.subagent(request.user.id, agentId);
    return this.inventory.updateAgentStatus(request.user.id, agentId, input);
  }

  /**
   * subagentHoldings = 查询下级取得号码的流转记录与是否仍持有。
   * 接口：GET /api/agent-inventory/subagents/:agentId/holdings。接收：登录用户与请求信息(request)、路径参数(agentId)、地址查询参数(input)。
   */
  @Get('subagents/:agentId/holdings')
  subagentHoldings(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.subagentHoldings(request.user.id, agentId, input);
  }

  /**
   * subagentTransactions = 查询与直属下级相关的交易列表。
   * 接口：GET /api/agent-inventory/subagents/:agentId/transactions。接收：登录用户与请求信息(request)、路径参数(agentId)、地址查询参数(input)。
   */
  @Get('subagents/:agentId/transactions')
  subagentTransactions(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.subagentTransactions(request.user.id, agentId, input);
  }

  /**
   * transferableHoldings = 查询当前身份可转移的号码持有记录。
   * 接口：GET /api/agent-inventory/transferable-holdings。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('transferable-holdings')
  transferableHoldings(@Req() request: SessionRequest, @Query(new SchemaPipe(agentInventoryQuerySchema)) input: AgentInventoryQuery) {
    return this.inventory.transferableHoldings(request.user.id, input);
  }

  /**
   * agents = 查询代理列表。管理员和普通代理的查询范围及附加字段不同。
   * 接口：GET /api/agent-inventory/agents。接收：登录用户与请求信息(request)。
   */
  @Get('agents')
  async agents(@Req() request: SessionRequest) {
    if (request.user.role === 'ADMIN') {
      // Admins also get contact email, USD balance and active number count so the agent list is useful at a glance.
      const { rows } = await this.db.query(
        `SELECT a.id,a.user_id,a.parent_agent_id,a.level,a.name,a.status,a.created_at,u.email,
           COALESCE((SELECT b.balance_minor FROM balance_accounts b WHERE b.owner_type='AGENT' AND b.agent_id=a.id AND b.currency='USD'),0)::bigint AS balance_minor,
           (SELECT count(*) FROM number_holdings h WHERE h.owner_type='AGENT' AND h.agent_id=a.id AND h.status='ACTIVE')::int AS holding_count
         FROM agents a JOIN users u ON u.id=a.user_id ORDER BY a.level,a.parent_agent_id NULLS FIRST,a.created_at,a.id`);
      return { data: rows.map(row => ({
        id: row.id, userId: row.user_id, parentAgentId: row.parent_agent_id, level: row.level,
        name: row.name, status: row.status, createdAt: row.created_at.toISOString(),
        email: row.email, balanceMinor: Number(row.balance_minor), holdingCount: row.holding_count,
      })) };
    }
    const actor = await this.inventory.resolveActor(request.user.id);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    if (actor.kind !== 'AGENT') throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only agents can list agents');
    const { rows } = await this.db.query(
      'SELECT id,user_id,parent_agent_id,level,name,status,created_at FROM agents WHERE id = ANY($1::uuid[]) ORDER BY level,created_at,id',
      [await this.db.transaction(client => this.inventory.visibleAgentIds(client, actor.agentId))]);
    return { data: rows.map(row => ({
      id: row.id, userId: row.user_id, parentAgentId: row.parent_agent_id, level: row.level,
      name: row.name, status: row.status, createdAt: row.created_at.toISOString(),
    })) };
  }

  /**
   * customers = 查询客户列表。管理员可看全局，普通代理只看自身范围。
   * 接口：GET /api/agent-inventory/customers。接收：登录用户与请求信息(request)。
   */
  @Get('customers')
  async customers(@Req() request: SessionRequest) {
    if (request.user.role === 'ADMIN') {
      const { rows } = await this.db.query(
        'SELECT id,user_id,agent_id,name,status,created_at FROM customers ORDER BY agent_id NULLS FIRST,created_at,id');
      return { data: rows.map(row => ({
        id: row.id, userId: row.user_id, agentId: row.agent_id, name: row.name, status: row.status,
        createdAt: row.created_at.toISOString(),
      })) };
    }
    const actor = await this.inventory.resolveActor(request.user.id);
    if (!actor) throw new ApiFailure(403, 'NOT_ENROLLED', 'This account is not enrolled as agent or customer');
    if (actor.kind !== 'AGENT') throw new ApiFailure(403, 'AGENT_REQUIRED', 'Only agents can list customers');
    const { rows } = await this.db.query(
      'SELECT id,user_id,agent_id,name,status,created_at FROM customers WHERE agent_id=$1 ORDER BY created_at,id',
      [actor.agentId]);
    return { data: rows.map(row => ({
      id: row.id, userId: row.user_id, agentId: row.agent_id, name: row.name, status: row.status,
      createdAt: row.created_at.toISOString(),
    })) };
  }

  /**
   * customerHoldings = 查询指定客户的持有号码，核对客户所属关系。
   * 接口：GET /api/agent-inventory/customers/:customerId/holdings。接收：登录用户与请求信息(request)、路径参数(customerId)、地址查询参数(input)。
   */
  @Get('customers/:customerId/holdings')
  customerHoldings(@Req() request: SessionRequest, @Param('customerId', new SchemaPipe(uuidSchema)) customerId: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.customerHoldings(request.user.id, customerId, input);
  }

  /**
   * holdings = 查询当前可见范围中的号码持有记录，支持筛选和分页。
   * 接口：GET /api/agent-inventory/holdings。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('holdings')
  holdings(@Req() request: SessionRequest, @Query(new SchemaPipe(agentInventoryQuerySchema)) input: AgentInventoryQuery) {
    return this.inventory.holdings(request.user.id, input);
  }
  /**
   * stock = 查询统一号码库存及状态数量，综合平台占用与资源有效期。
   * 接口：GET /api/agent-inventory/stock。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('stock')
  stock(@Req() request: SessionRequest, @Query(new SchemaPipe(agentStockQuerySchema)) input: AgentStockQuery) {
    return this.inventory.stock(request.user.id, input);
  }
  /**
   * importStock = 库存导入请求入口。格式检查后调用 importNumbers；当前业务拒绝直接导入，返回 USE_SHARED_NUMBER_INVENTORY。
   * 接口：POST /api/agent-inventory/stock/import。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('stock/import')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  importStock(@Req() request: SessionRequest, @Body(new SchemaPipe(agentNumberImportInputSchema)) input: AgentNumberImportInput) {
    return this.inventory.importNumbers(request.user.id, input);
  }
  /**
   * claimStock = 领用单个库存资源，校验报价、期限与可见范围。
   * 接口：POST /api/agent-inventory/stock/claim。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('stock/claim')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  claimStock(@Req() request: SessionRequest, @Body(new SchemaPipe(claimAgentNumberInputSchema)) input: ClaimAgentNumberInput) {
    return this.inventory.claimStock(request.user.id, input);
  }
  /**
   * claimStocks = 批量领用库存资源。所有选择在同一事务中核对和执行。
   * 接口：POST /api/agent-inventory/stock/claim-batch。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('stock/claim-batch')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  claimStocks(@Req() request: SessionRequest, @Body(new SchemaPipe(claimAgentNumbersInputSchema)) input: ClaimAgentNumbersInput) {
    return this.inventory.claimStocks(request.user.id, input);
  }
  /**
   * releaseHolding = 释放当前持有记录并按业务规则回收库存，保留历史事件。
   * 接口：POST /api/agent-inventory/holdings/:holdingId/release。接收：登录用户与请求信息(request)、路径参数(holdingId)、请求体(input)。
   */
  @Post('holdings/:holdingId/release')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  releaseHolding(@Req() request: SessionRequest, @Param('holdingId', new SchemaPipe(uuidSchema)) holdingId: string,
    @Body(new SchemaPipe(releaseHoldingInputSchema)) input: ReleaseHoldingInput) {
    return this.inventory.releaseHolding(request.user.id, holdingId, input);
  }
  /**
   * previewHoldingBatch = 预览跨页批量流转。返回精确选择集合、报价与校验标识，此时不执行转移。
   * 接口：POST /api/agent-inventory/holdings/batch-preview。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('holdings/batch-preview')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  previewHoldingBatch(@Req() request: SessionRequest, @Body(new SchemaPipe(holdingBatchPreviewInputSchema)) input: HoldingBatchPreviewInput) {
    return this.inventory.previewHoldingBatch(request.user.id, input);
  }
  /**
   * transferHoldingBatch = 执行已预览的批量流转，重验集合/报价并用幂等编号避免重复。
   * 接口：POST /api/agent-inventory/holdings/batch-transfer。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('holdings/batch-transfer')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  transferHoldingBatch(@Req() request: SessionRequest, @Body(new SchemaPipe(holdingBatchInputSchema)) input: HoldingBatchInput) {
    return this.inventory.transferHoldingBatch(request.user.id, input);
  }
  /**
   * assignHoldingToCustomer = 把当前代理持有的号码分配给所属客户，建立客户持有和使用权益。
   * 接口：POST /api/agent-inventory/holdings/assign-customer。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('holdings/assign-customer')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  assignHoldingToCustomer(@Req() request: SessionRequest, @Body(new SchemaPipe(assignHoldingInputSchema)) input: AssignHoldingInput) {
    return this.inventory.assignHoldingToCustomer(request.user.id, input);
  }
  /**
   * resellHolding = 把号码持有转售给直属下级代理，处理服务期限、报价和余额结算。
   * 接口：POST /api/agent-inventory/holdings/resell。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('holdings/resell')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  resellHolding(@Req() request: SessionRequest, @Body(new SchemaPipe(resellHoldingInputSchema)) input: ResellHoldingInput) {
    return this.inventory.resellHolding(request.user.id, input);
  }
  /**
   * balances = 查询当前可见持有人的余额账户，金额以最小货币单位返回。
   * 接口：GET /api/agent-inventory/balances。接收：登录用户与请求信息(request)。
   */
  @Get('balances')
  balances(@Req() request: SessionRequest) {
    return this.inventory.balances(request.user.id);
  }
  /**
   * transactionDetail = 读取一笔可见交易的订单头和分页结算明细。
   * 接口：GET /api/agent-inventory/transactions/:id。接收：登录用户与请求信息(request)、路径参数(id)、地址查询参数(input)。
   */
  @Get('transactions/:id')
  transactionDetail(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.transactionDetail(request.user.id, id, input);
  }

  /**
   * platformSettlement = 汇总平台结算金额、号码数量和订单数，统计周期由 period 决定。
   * 接口：GET /api/agent-inventory/platform-settlement。接收：登录用户与请求信息(request)、地址查询参数(period)。
   */
  @Get('platform-settlement')
  platformSettlement(@Req() request: SessionRequest, @Query('period', new SchemaPipe(agentMetricPeriodSchema)) period: AgentMetricPeriod = '7d') {
    return this.inventory.platformSettlement(request.user.id, period);
  }

  /**
   * transactions = 按权限、类型和状态分页查询代理交易。
   * 接口：GET /api/agent-inventory/transactions。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('transactions')
  transactions(@Req() request: SessionRequest, @Query(new SchemaPipe(agentTransactionsQuerySchema)) input: AgentTransactionsQuery) {
    return this.inventory.transactions(request.user.id, input);
  }
  /**
   * ledger = 查询指定持有人的余额账本，按币种和分页返回。
   * 接口：GET /api/agent-inventory/ledger/:ownerType/:ownerId。接收：登录用户与请求信息(request)、路径参数(params)、地址查询参数(input)。
   */
  @Get('ledger/:ownerType/:ownerId')
  async ledger(@Req() request: SessionRequest,
    @Param(new SchemaPipe(ownerRefParamsSchema)) params: { ownerType: 'agent' | 'customer'; ownerId: string },
    @Query(new SchemaPipe(ledgerQuerySchema)) input: LedgerQuery) {
    return this.inventory.ledger(request.user.id, toOwnerRef(params), input);
  }
  /**
   * settlementPreview = 计算本次领用/转售/分配的结算报价，返回报价校验标识供确认。
   * 接口：POST /api/agent-inventory/settlement-preview。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('settlement-preview')
  settlementPreview(@Req() request: SessionRequest, @Body(new SchemaPipe(settlementQuoteInputSchema)) input: SettlementQuoteInput) { return this.inventory.settlementPreview(request.user.id, input); }

  /**
   * priceOptions = 查询可配置价格的平台与地区选项。
   * 接口：GET /api/agent-inventory/price-options。接收：登录用户与请求信息(request)。
   */
  @Get('price-options')
  priceOptions(@Req() request: SessionRequest) { return this.inventory.priceOptions(request.user.id); }

  /**
   * prices = 查询当前可见的价格规则。
   * 接口：GET /api/agent-inventory/prices。接收：登录用户与请求信息(request)。
   */
  @Get('prices')
  prices(@Req() request: SessionRequest) {
    return this.inventory.prices(request.user.id);
  }
  /**
   * createAgent = 创建代理身份，核对关联用户、上级层级及操作者权限。
   * 接口：POST /api/agent-inventory/agents。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('agents')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createAgent(@Req() request: SessionRequest, @Body(new SchemaPipe(createAgentInputSchema)) input: CreateAgentInput) {
    return this.inventory.createAgent(request.user.id, input);
  }
  /**
   * createCustomer = 创建客户身份，核对关联用户与所属代理。
   * 接口：POST /api/agent-inventory/customers。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('customers')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createCustomer(@Req() request: SessionRequest, @Body(new SchemaPipe(createCustomerInputSchema)) input: CreateCustomerInput) {
    return this.inventory.createCustomer(request.user.id, input);
  }
  /**
   * updateAgentStatus = 修改代理状态，核对操作者权限并处理相关会话。
   * 接口：PATCH /api/agent-inventory/agents/:agentId/status。接收：登录用户与请求信息(request)、路径参数(agentId)、请求体(input)。
   */
  @Patch('agents/:agentId/status')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async updateAgentStatus(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Body(new SchemaPipe(agentStatusInputSchema)) input: AgentStatusInput) {
    return this.inventory.updateAgentStatus(request.user.id, agentId, input);
  }
  /**
   * createHolding = 手工持有请求入口。当前业务拒绝绕过总库存和结算建立持有记录，返回 USE_SHARED_NUMBER_INVENTORY。
   * 接口：POST /api/agent-inventory/holdings。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('holdings')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createHolding(@Req() request: SessionRequest, @Body(new SchemaPipe(createHoldingInputSchema)) input: CreateHoldingInput) {
    return this.inventory.createHolding(request.user.id, input);
  }
  /**
   * adjustBalance = 管理员调整余额，核对方向、金额与权限，并写入交易和账本。
   * 接口：POST /api/agent-inventory/balance-adjustments。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('balance-adjustments')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async adjustBalance(@Req() request: SessionRequest, @Body(new SchemaPipe(adjustBalanceInputSchema)) input: AdjustBalanceInput) {
    return this.inventory.adjustBalance(request.user.id, input);
  }
  /**
   * setPrice = 保存价格规则，核对卖方权限、计价范围及 USD/P30D 约定。
   * 接口：POST /api/agent-inventory/prices。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('prices')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async setPrice(@Req() request: SessionRequest, @Body(new SchemaPipe(upsertPriceRuleInputSchema)) input: UpsertPriceRuleInput) {
    return this.inventory.setPrice(request.user.id, input);
  }
  /**
   * transfer = 执行余额转账，核对双方归属、币种、余额和幂等编号。
   * 接口：POST /api/agent-inventory/transfers。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('transfers')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async transfer(@Req() request: SessionRequest, @Body(new SchemaPipe(transferBalanceInputSchema)) input: TransferBalanceInput) {
    return this.inventory.transfer(request.user.id, input);
  }
  /**
   * createOrder = 创建业务订单。格式检查后交给业务层，价格、权限、余额和库存由后端核对。
   * 接口：POST /api/agent-inventory/orders。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('orders')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(createTxOrderInputSchema)) input: CreateTxOrderInput) {
    return this.inventory.createTxOrder(request.user.id, input);
  }
}
