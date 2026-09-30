import type {
  PaginatedResponse,
  ProjectDetail,
  ProjectSummary,
} from '@linepool/contracts';
import { paginationQuerySchema } from '@linepool/contracts';
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query() query: unknown): Promise<PaginatedResponse<ProjectSummary>> {
    return this.projects.list(paginationQuerySchema.parse(query));
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<{ data: ProjectDetail }> {
    const projectId = z.string().uuid().parse(id);
    return { data: await this.projects.detail(projectId) };
  }
}
