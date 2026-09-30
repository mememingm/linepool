import type {
  CreateOrderInput,
  OrderDetail,
  OrderSummary,
  PaginatedResponse,
} from '@linepool/contracts';
import {
  createOrderInputSchema,
  paginationQuerySchema,
} from '@linepool/contracts';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ data: OrderDetail }> {
    const input: CreateOrderInput = createOrderInputSchema.parse(body);
    return { data: await this.orders.create(request.user.id, input) };
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<PaginatedResponse<OrderSummary>> {
    return this.orders.list(
      request.user.id,
      paginationQuerySchema.parse(query),
    );
  }

  @Get(':id')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ data: OrderDetail }> {
    return {
      data: await this.orders.get(
        request.user.id,
        z.string().uuid().parse(id),
      ),
    };
  }
}
