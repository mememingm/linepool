import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { uuidSchema } from '@linepool/contracts';
import { adminQuerySchema, numberActionInputSchema, productInputSchema, userStatusInputSchema,
  type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput } from '@linepool/contracts/admin';
import { SessionGuard, type SessionRequest } from './authentication.js';
import { SchemaPipe } from './http.js';
import { Administration, AdminGuard, type AdminSection } from './administration.js';

const sectionSchema = z.enum(['users', 'numbers', 'products', 'orders', 'audit']);
const detailSectionSchema = z.enum(['users', 'numbers', 'orders']);
@Controller('admin')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: Administration) {}
  @Get('session')
  session(@Req() request: SessionRequest) { return { data: request.user }; }
  @Get('summary')
  async summary() { return { data: await this.admin.summary() }; }
  @Get(':section')
  list(@Param('section', new SchemaPipe(sectionSchema)) section: AdminSection,
    @Query(new SchemaPipe(adminQuerySchema)) input: AdminQuery) { return this.admin.list(section, input); }
  @Get(':section/:id')
  async detail(@Param('section', new SchemaPipe(detailSectionSchema)) section: 'users' | 'numbers' | 'orders',
    @Param('id', new SchemaPipe(uuidSchema)) id: string) { return { data: await this.admin.detail(section, id) }; }
  @Patch('users/:id/status')
  async userStatus(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(userStatusInputSchema)) input: UserStatusInput) {
    return { data: await this.admin.userStatus(req.user.id, id, input) };
  }
  @Post('numbers/:id/actions')
  async numberAction(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(numberActionInputSchema)) input: NumberActionInput) {
    return { data: await this.admin.numberAction(req.user.id, id, input) };
  }
  @Post('products')
  async createProduct(@Req() req: SessionRequest, @Body(new SchemaPipe(productInputSchema)) input: ProductInput) {
    return { data: await this.admin.saveProduct(req.user.id, input, true) };
  }
  @Patch('products')
  async updateProduct(@Req() req: SessionRequest, @Body(new SchemaPipe(productInputSchema)) input: ProductInput) {
    return { data: await this.admin.saveProduct(req.user.id, input, false) };
  }
}
