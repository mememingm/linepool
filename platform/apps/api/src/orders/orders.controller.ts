import type { CreateOrderInput, OrderDetail } from '@linepool/contracts';
import { createOrderInputSchema } from '@linepool/contracts';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';

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
}
