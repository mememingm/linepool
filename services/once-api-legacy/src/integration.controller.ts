import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.controller';
import { AuthedRequest, SessionGuard } from './auth';
import { IntegrationService } from './integration.service';

type Request = AuthedRequest & { admin: { id: string } };
@Controller('api/admin/integrations/pingcode')
@UseGuards(SessionGuard, AdminGuard)
export class IntegrationController {
  constructor(private readonly integration: IntegrationService) {}
  @Get()
  overview() { return this.integration.overview(); }
  @Get('numbers')
  numbers() { return this.integration.numbers(); }
  @Post() @HttpCode(200)
  save(@Req() req: Request, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.integration.run(req.admin.id, 'INTEGRATION_CONFIG_UPDATED', body, key, () => this.integration.save(body));
  }
  @Post('check') @HttpCode(200)
  check(@Req() req: Request, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.integration.run(req.admin.id, 'INTEGRATION_CHECK', body, key, () => this.integration.check());
  }
  @Post('sync') @HttpCode(200)
  sync(@Req() req: Request, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.integration.run(req.admin.id, 'INTEGRATION_SYNC', body, key, () => this.integration.sync(body));
  }
}
