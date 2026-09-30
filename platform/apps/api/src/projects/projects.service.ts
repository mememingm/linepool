import type {
  PaginatedResponse,
  PaginationQuery,
  Plan,
  ProjectDetail,
  ProjectSummary,
} from '@linepool/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { ApiException } from '../errors/api-exception.js';

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  country_code: string;
  country_name: string;
  description: string;
  accent_color: string;
  is_active: boolean;
  available_count: string;
  min_points: number | null;
}

interface PlanRow {
  id: string;
  name: string;
  description: string;
  unit_points: number;
  duration_days: number;
  is_active: boolean;
  available_count: string;
}

function mapProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    countryCode: row.country_code.trim(),
    countryName: row.country_name,
    description: row.description,
    accentColor: row.accent_color,
    isActive: row.is_active,
    availableCount: Number(row.available_count),
    minPoints: row.min_points ?? 0,
  };
}

function mapPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    unitPoints: row.unit_points,
    durationDays: row.duration_days,
    availableCount: Number(row.available_count),
    isActive: row.is_active,
  };
}

const projectSelect = `
  SELECT p.id, p.slug, p.name, p.country_code, p.country_name,
         p.description, p.accent_color, p.is_active,
         (SELECT count(*) FROM phone_numbers n
          WHERE n.project_id = p.id AND n.status = 'AVAILABLE') AS available_count,
         (SELECT min(unit_points) FROM plans pl
          WHERE pl.project_id = p.id AND pl.is_active = true) AS min_points
  FROM projects p
`;

@Injectable()
export class ProjectsService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: PaginationQuery): Promise<PaginatedResponse<ProjectSummary>> {
    const offset = (query.page - 1) * query.pageSize;
    const [projects, count] = await Promise.all([
      this.database.query<ProjectRow>(
        `${projectSelect}
         WHERE p.is_active = true
         ORDER BY p.sort_order, p.name
         LIMIT $1 OFFSET $2`,
        [query.pageSize, offset],
      ),
      this.database.query<{ count: string }>(
        'SELECT count(*) FROM projects WHERE is_active = true',
      ),
    ]);
    const totalItems = Number(count.rows[0]?.count ?? 0);

    return {
      data: projects.rows.map(mapProject),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async detail(id: string): Promise<ProjectDetail> {
    const projectResult = await this.database.query<ProjectRow>(
      `${projectSelect} WHERE p.id = $1 AND p.is_active = true`,
      [id],
    );
    const project = projectResult.rows[0];
    if (!project) {
      throw new ApiException(
        'PROJECT_NOT_FOUND',
        '项目不存在或已下架',
        HttpStatus.NOT_FOUND,
      );
    }

    const plans = await this.database.query<PlanRow>(
      `
        SELECT pl.id, pl.name, pl.description, pl.unit_points,
               pl.duration_days, pl.is_active,
               (SELECT count(*) FROM phone_numbers n
                WHERE n.project_id = pl.project_id AND n.status = 'AVAILABLE') AS available_count
        FROM plans pl
        WHERE pl.project_id = $1 AND pl.is_active = true
        ORDER BY pl.sort_order, pl.unit_points
      `,
      [id],
    );

    return { ...mapProject(project), plans: plans.rows.map(mapPlan) };
  }
}
