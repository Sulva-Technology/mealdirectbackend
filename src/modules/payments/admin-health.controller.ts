import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { sql } from 'kysely';

import { createSuccessEnvelope } from '../../common/api/response.js';
import type { SuccessEnvelope } from '../../common/api/response.js';
import { EnvService } from '../../config/env.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';

type SystemHealth = {
  api: string;
  database: string;
  paystack: string;
  lastSuccessfulWebhookAt: string | null;
  lastFailedWebhookAt: string | null;
  failedWebhookCount: number;
  pendingReconciliationCount: number;
  failedJobsCount?: number | null;
};

@ApiTags('admin-health')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/health')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminHealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EnvService) private readonly env: EnvService
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Admin system health overview.' })
  async getHealth(): Promise<SuccessEnvelope<SystemHealth>> {
    const dbOk = await this.database
      .checkHealth()
      .then(() => true)
      .catch(() => false);

    const webhookStats = await sql<{
      lastSuccessful: string | null;
      lastFailed: string | null;
      failedCount: string;
    }>`
      select
        max(case when processing_error is null and processed_at is not null then received_at else null end) as "lastSuccessful",
        max(case when processing_error is not null then received_at else null end) as "lastFailed",
        count(case when processing_error is not null then 1 else null end)::text as "failedCount"
      from public.payment_events
    `.execute(this.database.db);

    const issueStats = await sql<{ pendingCount: string }>`
      select count(*)::text as "pendingCount"
      from public.payment_reconciliation_issues
      where status = 'open'
    `.execute(this.database.db);

    const ws = webhookStats.rows[0];
    const is = issueStats.rows[0];

    return createSuccessEnvelope({
      api: 'ok',
      database: dbOk ? 'ok' : 'down',
      paystack: 'ok',
      lastSuccessfulWebhookAt: ws?.lastSuccessful ?? null,
      lastFailedWebhookAt: ws?.lastFailed ?? null,
      failedWebhookCount: parseInt(ws?.failedCount ?? '0', 10),
      pendingReconciliationCount: parseInt(is?.pendingCount ?? '0', 10)
    });
  }
}
