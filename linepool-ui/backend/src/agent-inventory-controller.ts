import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  adjustBalanceInputSchema, agentInventoryQuerySchema, agentNumberImportInputSchema, agentStatusInputSchema, agentStockQuerySchema, agentTransactionsQuerySchema,
  claimAgentNumberInputSchema, claimAgentNumbersInputSchema, createAgentInputSchema, createCustomerInputSchema, createHoldingInputSchema, createTxOrderInputSchema,
  paginationQuerySchema, releaseHoldingInputSchema, resellHoldingInputSchema, transferBalanceInputSchema, upsertPriceRuleInputSchema, uuidSchema,
  type AdjustBalanceInput, type AgentInventoryQuery, type AgentNumberImportInput, type AgentStatusInput, type AgentStockQuery, type AgentTransactionsQuery,
  type ClaimAgentNumberInput, type ClaimAgentNumbersInput, type CreateAgentInput, type CreateCustomerInput, type CreateHoldingInput, type CreateTxOrderInput, type OwnerRef,
  type PaginationQuery, type ReleaseHoldingInput, type ResellHoldingInput, type TransferBalanceInput, type UpsertPriceRuleInput,
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

  @Get('agents')
  async agents(@Req() request: SessionRequest) {
    if (request.user.role === 'ADMIN') {
      const { rows } = await this.db.query(
        'SELECT id,user_id,parent_agent_id,level,name,status,created_at FROM agents ORDER BY level,parent_agent_id NULLS FIRST,created_at,id');
      return { data: rows.map(row => ({
        id: row.id, userId: row.user_id, parentAgentId: row.parent_agent_id, level: row.level,
        name: row.name, status: row.status, createdAt: row.created_at.toISOString(),
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
  @Post('holdings/resell')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  resellHolding(@Req() request: SessionRequest, @Body(new SchemaPipe(resellHoldingInputSchema)) input: ResellHoldingInput) {
    return this.inventory.resellHolding(request.user.id, input);
  }
  @Get('balances')
  balances(@Req() request: SessionRequest) {
    return this.inventory.balances(request.user.id);
  }
  @Get('transactions')
  transactions(@Req() request: SessionRequest, @Query(new SchemaPipe(agentTransactionsQuerySchema)) input: AgentTransactionsQuery) {
    return this.inventory.transactions(request.user.id, input);
  }
  @Get('ledger/:ownerType/:ownerId')
  async ledger(@Req() request: SessionRequest,
    @Param(new SchemaPipe(ownerRefParamsSchema)) params: { ownerType: 'agent' | 'customer'; ownerId: string },
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.inventory.ledger(request.user.id, toOwnerRef(params), input);
  }
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
