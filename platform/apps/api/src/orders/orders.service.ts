import { randomBytes } from 'node:crypto';

import type { CreateOrderInput, OrderDetail } from '@linepool/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database/database.service.js';
import { ApiException } from '../errors/api-exception.js';

interface OrderRow {
  id: string;
  order_number: string;
  project_id: string;
  project_name: string;
  plan_id: string;
  plan_name: string;
  quantity: number;
  total_points: number;
  status: 'COMPLETED' | 'CANCELLED';
  created_at: Date;
}

interface NumberRow {
  id: string;
  phone_number: string;
  project_id: string;
  project_name: string;
  assigned_order_id: string;
  assigned_at: Date;
  expires_at: Date;
}

interface PlanRow {
  id: string;
  project_id: string;
  unit_points: number;
  duration_days: number;
}

function createOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `LP-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class OrdersService {
  constructor(private readonly database: DatabaseService) {}

  private async detail(client: PoolClient, orderId: string): Promise<OrderDetail> {
    const orderResult = await client.query<OrderRow>(
      `
        SELECT o.id, o.order_number, o.project_id, p.name AS project_name,
               o.plan_id, pl.name AS plan_name, o.quantity, o.total_points,
               o.status, o.created_at
        FROM orders o
        JOIN projects p ON p.id = o.project_id
        JOIN plans pl ON pl.id = o.plan_id
        WHERE o.id = $1
      `,
      [orderId],
    );
    const row = orderResult.rows[0];
    if (!row) {
      throw new ApiException('ORDER_NOT_FOUND', '订单不存在', HttpStatus.NOT_FOUND);
    }

    const numbers = await client.query<NumberRow>(
      `
        SELECT n.id, n.phone_number, n.project_id, p.name AS project_name,
               n.assigned_order_id, n.assigned_at, n.expires_at
        FROM phone_numbers n
        JOIN projects p ON p.id = n.project_id
        WHERE n.assigned_order_id = $1
        ORDER BY n.phone_number
      `,
      [orderId],
    );

    return {
      id: row.id,
      orderNumber: row.order_number,
      project: { id: row.project_id, name: row.project_name },
      plan: { id: row.plan_id, name: row.plan_name },
      quantity: row.quantity,
      totalPoints: row.total_points,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      numbers: numbers.rows.map((number) => ({
        id: number.id,
        phoneNumber: number.phone_number,
        project: { id: number.project_id, name: number.project_name },
        orderId: number.assigned_order_id,
        status: number.expires_at > new Date() ? 'ACTIVE' : 'EXPIRED',
        assignedAt: number.assigned_at.toISOString(),
        expiresAt: number.expires_at.toISOString(),
      })),
    };
  }

  async create(userId: string, input: CreateOrderInput): Promise<OrderDetail> {
    return this.database.transaction(async (client) => {
      const findExisting = async (): Promise<string | undefined> => {
        const result = await client.query<{ id: string }>(
          'SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2',
          [userId, input.idempotencyKey],
        );
        return result.rows[0]?.id;
      };

      const existingBeforeLock = await findExisting();
      if (existingBeforeLock) return this.detail(client, existingBeforeLock);

      const userResult = await client.query<{ points_balance: number }>(
        'SELECT points_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const user = userResult.rows[0];
      if (!user) {
        throw new ApiException('AUTH_REQUIRED', '请先登录', HttpStatus.UNAUTHORIZED);
      }

      // A concurrent replay waits on the user lock; recheck after acquiring it.
      const existingAfterLock = await findExisting();
      if (existingAfterLock) return this.detail(client, existingAfterLock);

      const planResult = await client.query<PlanRow>(
        `
          SELECT pl.id, pl.project_id, pl.unit_points, pl.duration_days
          FROM plans pl
          JOIN projects p ON p.id = pl.project_id
          WHERE pl.id = $1 AND pl.project_id = $2
            AND pl.is_active = true AND p.is_active = true
        `,
        [input.planId, input.projectId],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        throw new ApiException(
          'PLAN_NOT_AVAILABLE',
          '套餐不存在或已下架',
          HttpStatus.CONFLICT,
        );
      }

      const totalPoints = plan.unit_points * input.quantity;
      if (user.points_balance < totalPoints) {
        throw new ApiException(
          'INSUFFICIENT_POINTS',
          '积分不足，无法完成购买',
          HttpStatus.CONFLICT,
          { requiredPoints: totalPoints, availablePoints: user.points_balance },
        );
      }

      const inventory = await client.query<{ id: string }>(
        `
          SELECT id
          FROM phone_numbers
          WHERE project_id = $1 AND status = 'AVAILABLE'
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        `,
        [input.projectId, input.quantity],
      );
      if (inventory.rows.length < input.quantity) {
        throw new ApiException(
          'INSUFFICIENT_STOCK',
          '当前库存不足，请减少购买数量',
          HttpStatus.CONFLICT,
          { requested: input.quantity, available: inventory.rows.length },
        );
      }

      const balanceAfter = user.points_balance - totalPoints;
      const orderResult = await client.query<{ id: string }>(
        `
          INSERT INTO orders(
            order_number, user_id, project_id, plan_id, quantity,
            total_points, status, idempotency_key
          ) VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', $7)
          RETURNING id
        `,
        [
          createOrderNumber(),
          userId,
          input.projectId,
          input.planId,
          input.quantity,
          totalPoints,
          input.idempotencyKey,
        ],
      );
      const orderId = orderResult.rows[0]?.id;
      if (!orderId) throw new Error('Order insert did not return an id');

      const numberIds = inventory.rows.map(({ id }) => id);
      await client.query(
        `
          UPDATE phone_numbers
          SET status = 'ASSIGNED', assigned_user_id = $1,
              assigned_order_id = $2, assigned_at = now(),
              expires_at = now() + ($3 * interval '1 day')
          WHERE id = ANY($4::uuid[])
        `,
        [userId, orderId, plan.duration_days, numberIds],
      );
      await client.query(
        'UPDATE users SET points_balance = $1, updated_at = now() WHERE id = $2',
        [balanceAfter, userId],
      );
      await client.query(
        `
          INSERT INTO point_ledger(
            user_id, type, delta, balance_after, description, reference_id
          ) VALUES ($1, 'ORDER_DEBIT', $2, $3, $4, $5)
        `,
        [
          userId,
          -totalPoints,
          balanceAfter,
          `购买 ${input.quantity} 个演示号码`,
          orderId,
        ],
      );

      return this.detail(client, orderId);
    });
  }
}
