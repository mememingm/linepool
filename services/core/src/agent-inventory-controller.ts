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
import { SessionGuard, type SessionRequest } from './authentication.js';
import { ApiFailure, SchemaPipe } from './http.js';
import { AgentInventory } from './agent-inventory.js';
import { Database } from './database.js';

const ownerRefParamsSchema = z.object({
  ownerType: z.enum(['agent', 'customer']),
  ownerId: uuidSchema,
});

function toOwnerRef(params: { ownerType: 'agent' | 'customer'; ownerId: string }): OwnerRef {
  return params.ownerType === 'agent'
    ? { ownerType: 'AGENT', agentId: params.ownerId }
    : { ownerType: 'CUSTOMER', customerId: params.ownerId };
}

@Controller('agent-inventory')
@UseGuards(SessionGuard)
export class AgentInventoryController {
  constructor(private readonly inventory: AgentInventory, private readonly db: Database) {}

  @Get('context')
  context(@Req() request: SessionRequest) { return this.inventory.context(request.user.id); }

  @Patch('profile')
  updateProfile(@Req() request: SessionRequest, @Body(new SchemaPipe(updateAgentNameInputSchema)) input: UpdateAgentNameInput) {
    return this.inventory.updateProfile(request.user.id, input);
  }

  @Patch('customers/:customerId')
  updateCustomer(@Req() request: SessionRequest, @Param('customerId', new SchemaPipe(uuidSchema)) customerId: string,
    @Body(new SchemaPipe(updateCustomerInputSchema)) input: UpdateCustomerInput) {
    return this.inventory.updateCustomer(request.user.id, customerId, input);
  }

  @Get('dashboard')
  dashboard(@Req() request: SessionRequest, @Query('period', new SchemaPipe(agentMetricPeriodSchema)) period: AgentMetricPeriod = '7d') {
    return this.inventory.dashboard(request.user.id, period);
  }

  @Get('subagents')
  subagents(@Req() request: SessionRequest, @Query(new SchemaPipe(subagentsQuerySchema)) input: SubagentsQuery) {
    return this.inventory.subagents(request.user.id, input);
  }

  @Post('subagents')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createSubagent(@Req() request: SessionRequest,
    @Body(new SchemaPipe(createSubagentInputSchema)) input: { userId: string; name: string; idempotencyKey: string }) {
    await this.inventory.context(request.user.id);
    const result = await this.inventory.createAgent(request.user.id, { ...input, parentAgentId: null, level: 1 });
    const { userId: _userId, ...profile } = result.data;
    return { data: profile };
  }

  @Get('subagents/:agentId')
  subagent(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string) {
    return this.inventory.subagent(request.user.id, agentId);
  }

  @Patch('subagents/:agentId/name')
  renameSubagent(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Body(new SchemaPipe(updateAgentNameInputSchema)) input: UpdateAgentNameInput) {
    return this.inventory.renameSubagent(request.user.id, agentId, input);
  }

  @Patch('subagents/:agentId/status')
  async updateSubagentStatus(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Body(new SchemaPipe(subagentStatusInputSchema)) input: AgentStatusInput) {
    await this.inventory.subagent(request.user.id, agentId);
    return this.inventory.updateAgentStatus(request.user.id, agentId, input);
  }

  @Get('subagents/:agentId/holdings')
  subagentHoldings(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.subagentHoldings(request.user.id, agentId, input);
  }

  @Get('subagents/:agentId/transactions')
  subagentTransactions(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.subagentTransactions(request.user.id, agentId, input);
  }

  @Get('transferable-holdings')
  transferableHoldings(@Req() request: SessionRequest, @Query(new SchemaPipe(agentInventoryQuerySchema)) input: AgentInventoryQuery) {
    return this.inventory.transferableHoldings(request.user.id, input);
  }

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

  @Get('customers/:customerId/holdings')
  customerHoldings(@Req() request: SessionRequest, @Param('customerId', new SchemaPipe(uuidSchema)) customerId: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.customerHoldings(request.user.id, customerId, input);
  }

  @Get('holdings')
  holdings(@Req() request: SessionRequest, @Query(new SchemaPipe(agentInventoryQuerySchema)) input: AgentInventoryQuery) {
    return this.inventory.holdings(request.user.id, input);
  }
  @Get('stock')
  stock(@Req() request: SessionRequest, @Query(new SchemaPipe(agentStockQuerySchema)) input: AgentStockQuery) {
    return this.inventory.stock(request.user.id, input);
  }
  @Post('stock/import')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  importStock(@Req() request: SessionRequest, @Body(new SchemaPipe(agentNumberImportInputSchema)) input: AgentNumberImportInput) {
    return this.inventory.importNumbers(request.user.id, input);
  }
  @Post('stock/claim')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  claimStock(@Req() request: SessionRequest, @Body(new SchemaPipe(claimAgentNumberInputSchema)) input: ClaimAgentNumberInput) {
    return this.inventory.claimStock(request.user.id, input);
  }
  @Post('stock/claim-batch')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  claimStocks(@Req() request: SessionRequest, @Body(new SchemaPipe(claimAgentNumbersInputSchema)) input: ClaimAgentNumbersInput) {
    return this.inventory.claimStocks(request.user.id, input);
  }
  @Post('holdings/:holdingId/release')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  releaseHolding(@Req() request: SessionRequest, @Param('holdingId', new SchemaPipe(uuidSchema)) holdingId: string,
    @Body(new SchemaPipe(releaseHoldingInputSchema)) input: ReleaseHoldingInput) {
    return this.inventory.releaseHolding(request.user.id, holdingId, input);
  }
  @Post('holdings/batch-preview')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  previewHoldingBatch(@Req() request: SessionRequest, @Body(new SchemaPipe(holdingBatchPreviewInputSchema)) input: HoldingBatchPreviewInput) {
    return this.inventory.previewHoldingBatch(request.user.id, input);
  }
  @Post('holdings/batch-transfer')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  transferHoldingBatch(@Req() request: SessionRequest, @Body(new SchemaPipe(holdingBatchInputSchema)) input: HoldingBatchInput) {
    return this.inventory.transferHoldingBatch(request.user.id, input);
  }
  @Post('holdings/assign-customer')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  assignHoldingToCustomer(@Req() request: SessionRequest, @Body(new SchemaPipe(assignHoldingInputSchema)) input: AssignHoldingInput) {
    return this.inventory.assignHoldingToCustomer(request.user.id, input);
  }
  @Post('holdings/resell')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  resellHolding(@Req() request: SessionRequest, @Body(new SchemaPipe(resellHoldingInputSchema)) input: ResellHoldingInput) {
    return this.inventory.resellHolding(request.user.id, input);
  }
  @Get('balances')
  balances(@Req() request: SessionRequest) {
    return this.inventory.balances(request.user.id);
  }
  @Get('transactions/:id')
  transactionDetail(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.transactionDetail(request.user.id, id, input);
  }

  @Get('platform-settlement')
  platformSettlement(@Req() request: SessionRequest, @Query('period', new SchemaPipe(agentMetricPeriodSchema)) period: AgentMetricPeriod = '7d') {
    return this.inventory.platformSettlement(request.user.id, period);
  }

  @Get('transactions')
  transactions(@Req() request: SessionRequest, @Query(new SchemaPipe(agentTransactionsQuerySchema)) input: AgentTransactionsQuery) {
    return this.inventory.transactions(request.user.id, input);
  }
  @Get('ledger/:ownerType/:ownerId')
  async ledger(@Req() request: SessionRequest,
    @Param(new SchemaPipe(ownerRefParamsSchema)) params: { ownerType: 'agent' | 'customer'; ownerId: string },
    @Query(new SchemaPipe(ledgerQuerySchema)) input: LedgerQuery) {
    return this.inventory.ledger(request.user.id, toOwnerRef(params), input);
  }
  @Post('settlement-preview')
  settlementPreview(@Req() request: SessionRequest, @Body(new SchemaPipe(settlementQuoteInputSchema)) input: SettlementQuoteInput) { return this.inventory.settlementPreview(request.user.id, input); }

  @Get('price-options')
  priceOptions(@Req() request: SessionRequest) { return this.inventory.priceOptions(request.user.id); }

  @Get('prices')
  prices(@Req() request: SessionRequest) {
    return this.inventory.prices(request.user.id);
  }
  @Post('agents')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createAgent(@Req() request: SessionRequest, @Body(new SchemaPipe(createAgentInputSchema)) input: CreateAgentInput) {
    return this.inventory.createAgent(request.user.id, input);
  }
  @Post('customers')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createCustomer(@Req() request: SessionRequest, @Body(new SchemaPipe(createCustomerInputSchema)) input: CreateCustomerInput) {
    return this.inventory.createCustomer(request.user.id, input);
  }
  @Patch('agents/:agentId/status')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async updateAgentStatus(@Req() request: SessionRequest, @Param('agentId', new SchemaPipe(uuidSchema)) agentId: string,
    @Body(new SchemaPipe(agentStatusInputSchema)) input: AgentStatusInput) {
    return this.inventory.updateAgentStatus(request.user.id, agentId, input);
  }
  @Post('holdings')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createHolding(@Req() request: SessionRequest, @Body(new SchemaPipe(createHoldingInputSchema)) input: CreateHoldingInput) {
    return this.inventory.createHolding(request.user.id, input);
  }
  @Post('balance-adjustments')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async adjustBalance(@Req() request: SessionRequest, @Body(new SchemaPipe(adjustBalanceInputSchema)) input: AdjustBalanceInput) {
    return this.inventory.adjustBalance(request.user.id, input);
  }
  @Post('prices')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async setPrice(@Req() request: SessionRequest, @Body(new SchemaPipe(upsertPriceRuleInputSchema)) input: UpsertPriceRuleInput) {
    return this.inventory.setPrice(request.user.id, input);
  }
  @Post('transfers')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async transfer(@Req() request: SessionRequest, @Body(new SchemaPipe(transferBalanceInputSchema)) input: TransferBalanceInput) {
    return this.inventory.transfer(request.user.id, input);
  }
  @Post('orders')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(createTxOrderInputSchema)) input: CreateTxOrderInput) {
    return this.inventory.createTxOrder(request.user.id, input);
  }
}
