import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiParam,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { sql } from 'kysely';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DatabaseService } from '../../database/database.service.js';
import { IsDatabaseUuid } from '../../common/validation.js';
import { ReconciliationService } from './reconciliation.service.js';

type PaymentQueueItem = {
  id: string;
  paymentId: string | null;
  queue: string;
  severity: string;
  paymentReference: string;
  orderId: string;
  customerName: string | null;
  customerEmail: string | null;
  amountKobo: number;
  currency: string;
  issueAgeSeconds: number;
  suggestedAction: string;
  reviewedAt: string | null;
};

class ProblemQueueListQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  queue?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class ProblemQueueIdParamDto {
  @IsDatabaseUuid()
  issueId!: string;
}

class ProblemQueueReviewDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

function issueTypeToQueue(issueType: string): string {
  switch (issueType) {
    case 'webhook_processing_failed':
      return 'webhook_failed';
    case 'provider_success_not_local':
      return 'webhook_not_received';
    case 'amount_mismatch':
      return 'amount_mismatch';
    case 'currency_mismatch':
      return 'currency_mismatch';
    case 'initialized_unconfirmed':
      return 'unconfirmed';
    case 'paid_order_pending':
      return 'paid_pending';
    case 'refund_stuck':
      return 'refund_stuck';
    default:
      return issueType;
  }
}

function issueSuggestedAction(issueType: string): string {
  switch (issueType) {
    case 'webhook_processing_failed':
      return 'Retry webhook processing';
    case 'provider_success_not_local':
      return 'Verify payment against Paystack';
    case 'amount_mismatch':
      return 'Review amount and contact customer if needed';
    case 'currency_mismatch':
      return 'Review and escalate';
    case 'initialized_unconfirmed':
      return 'Check if customer completed payment';
    case 'paid_order_pending':
      return 'Force-verify payment to unblock order';
    case 'refund_stuck':
      return 'Retry refund or mark manually resolved';
    default:
      return 'Review and resolve';
  }
}

@ApiTags('admin-problem-queues')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/payments/problem-queues')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminProblemQueuesController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Paginated reconciliation problem queue.' })
  async listProblemQueue(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: ProblemQueueListQueryDto
  ): Promise<ListEnvelope<PaymentQueueItem>> {
    const limit = query.limit ?? 20;
    const campusId = actor.role === 'campus_admin' ? actor.campusId : undefined;

    type IssueRow = {
      id: string;
      issueType: string;
      severity: string;
      paymentId: string | null;
      orderId: string | null;
      providerReference: string | null;
      detail: Record<string, unknown>;
      firstDetectedAt: string;
      reviewedAt: string | null;
      customerName: string | null;
      customerEmail: string | null;
    };

    let rows;
    if (campusId !== undefined) {
      rows = await sql<IssueRow>`
        select
          i.id::text,
          i.issue_type as "issueType",
          i.severity::text,
          i.payment_id::text as "paymentId",
          i.order_id::text as "orderId",
          i.provider_reference as "providerReference",
          i.detail,
          i.first_detected_at::text as "firstDetectedAt",
          i.reviewed_at::text as "reviewedAt",
          pr.display_name as "customerName",
          pr.email::text as "customerEmail"
        from public.payment_reconciliation_issues i
        left join public.orders o on o.id = i.order_id
        left join public.profiles pr on pr.id = o.customer_id
        where i.status = 'open' and i.campus_id = ${campusId}::uuid
        order by i.severity desc, i.first_detected_at asc
        limit ${limit + 1}
      `.execute(this.database.db);
    } else {
      rows = await sql<IssueRow>`
        select
          i.id::text,
          i.issue_type as "issueType",
          i.severity::text,
          i.payment_id::text as "paymentId",
          i.order_id::text as "orderId",
          i.provider_reference as "providerReference",
          i.detail,
          i.first_detected_at::text as "firstDetectedAt",
          i.reviewed_at::text as "reviewedAt",
          pr.display_name as "customerName",
          pr.email::text as "customerEmail"
        from public.payment_reconciliation_issues i
        left join public.orders o on o.id = i.order_id
        left join public.profiles pr on pr.id = o.customer_id
        where i.status = 'open'
        order by i.severity desc, i.first_detected_at asc
        limit ${limit + 1}
      `.execute(this.database.db);
    }

    const hasMore = rows.rows.length > limit;
    const items = rows.rows.slice(0, limit).map((r) => {
      const ageMs = Date.now() - new Date(r.firstDetectedAt).getTime();
      const detail = r.detail;
      return {
        id: r.id,
        paymentId: r.paymentId,
        queue: issueTypeToQueue(r.issueType),
        severity: r.severity,
        paymentReference: r.providerReference ?? 'N/A',
        orderId: r.orderId ?? 'N/A',
        customerName: r.customerName ?? (detail['customerName'] as string | undefined) ?? null,
        customerEmail: r.customerEmail,
        amountKobo:
          (detail['expectedAmountKobo'] as number | undefined) ??
          (detail['webhookAmountKobo'] as number | undefined) ??
          0,
        currency: (detail['currency'] as string | undefined) ?? 'NGN',
        issueAgeSeconds: Math.round(ageMs / 1000),
        suggestedAction: issueSuggestedAction(r.issueType),
        reviewedAt: r.reviewedAt
      };
    });

    return createListEnvelope(items, { hasMore, limit });
  }

  @Post(':issueId/review')
  @HttpCode(200)
  @RequirePermission('reconciliation:manage')
  @ApiParam({ format: 'uuid', name: 'issueId', type: String })
  @ApiOkResponse({ description: 'Marks the problem queue item as investigating.' })
  async reviewQueueItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ProblemQueueIdParamDto,
    @Body() input: ProblemQueueReviewDto
  ): Promise<SuccessEnvelope<{ reviewed: boolean }>> {
    await this.reconciliation.reviewIssue(actor, params.issueId, {
      status: 'investigating',
      ...(input.note !== undefined ? { resolutionNote: input.note } : {})
    });
    return createSuccessEnvelope({ reviewed: true });
  }
}
