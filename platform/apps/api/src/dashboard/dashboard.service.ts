import type { Dashboard, OrderSummary, User } from '@linepool/contracts';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { ProjectsService } from '../projects/projects.service.js';

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

function mapOrder(row: OrderRow): OrderSummary {
  return {
    id: row.id,
    orderNumber: row.order_number,
    project: { id: row.project_id, name: row.project_name },
    plan: { id: row.plan_id, name: row.plan_name },
    quantity: row.quantity,
    totalPoints: row.total_points,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly projects: ProjectsService,
  ) {}

  async get(user: User): Promise<Dashboard> {
    const [availableProjects, recentOrders] = await Promise.all([
      this.projects.list({ page: 1, pageSize: 3 }),
      this.database.query<OrderRow>(
        `
          SELECT o.id, o.order_number, o.project_id, p.name AS project_name,
                 o.plan_id, pl.name AS plan_name, o.quantity, o.total_points,
                 o.status, o.created_at
          FROM orders o
          JOIN projects p ON p.id = o.project_id
          JOIN plans pl ON pl.id = o.plan_id
          WHERE o.user_id = $1
          ORDER BY o.created_at DESC
          LIMIT 5
        `,
        [user.id],
      ),
    ]);

    return {
      pointsBalance: user.pointsBalance,
      availableProjects: availableProjects.data,
      recentOrders: recentOrders.rows.map(mapOrder),
    };
  }
}
