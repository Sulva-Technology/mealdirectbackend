import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
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
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { sql } from 'kysely';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DatabaseService } from '../../database/database.service.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';

const processingStatuses = ['pending', 'processed', 'failed'] as const;
type ProcessingStatus = (typeof processingStatuses)[number];

type WebhookEvent = {
  id: string;
  eventType: string;
  paymentReference: string | null;
  orderId: string | null;
  signatureVerified: boolean;
  processingStatus: string;
  receivedAt: string;
  processedAt: string | null;
  failureReason: string | null;
  retryCount: number;
};

type WebhookDetail = WebhookEvent & {
  safeSummary?: Record<string, unknown> | null;
  processingLogs?: unknown[];
};

class AdminWebhookListQueryDto {
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

  @ApiPropertyOptional({ enum: processingStatuses })
  @IsOptional()
  @IsIn(processingStatuses)
  status?: ProcessingStatus;
}

class WebhookIdParamDto {
  @IsString()
  webhookId!: string;
}

class AdminWebhookReviewDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

function dbRowToWebhookEvent(r: {
  id: string;
  eventType: string;
  providerReference: string | null;
  orderId: string | null;
  signatureValid: boolean;
  processingError: string | null;
  receivedAt: string;
  processedAt: string | null;
}): WebhookEvent {
  return {
    id: r.id,
    eventType: r.eventType,
    paymentReference: r.providerReference,
    orderId: r.orderId,
    signatureVerified: r.signatureValid,
    processingStatus:
      r.processingError != null ? 'failed' : r.processedAt != null ? 'processed' : 'pending',
    receivedAt: r.receivedAt,
    processedAt: r.processedAt,
    failureReason: r.processingError,
    retryCount: 0
  };
}

@ApiTags('admin-webhooks')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/webhooks')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminWebhooksController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  @ApiOkResponse({ description: 'Paginated list of Paystack webhook events.' })
  async listWebhooks(
    @CurrentActor() _actor: AuthenticatedActor,
    @Query() query: AdminWebhookListQueryDto
  ): Promise<ListEnvelope<WebhookEvent>> {
    const limit = query.limit ?? 20;

    type WebhookRow = {
      id: string;
      eventType: string;
      providerReference: string | null;
      orderId: string | null;
      signatureValid: boolean;
      processingError: string | null;
      receivedAt: string;
      processedAt: string | null;
    };

    let rows;
    if (query.status === 'failed') {
      rows = await sql<WebhookRow>`
        select
          id::text,
          event_type as "eventType",
          provider_reference as "providerReference",
          null::text as "orderId",
          signature_valid as "signatureValid",
          processing_error as "processingError",
          received_at::text as "receivedAt",
          processed_at::text as "processedAt"
        from public.payment_events
        where processing_error is not null
        order by received_at desc
        limit ${limit + 1}
      `.execute(this.database.db);
    } else if (query.status === 'processed') {
      rows = await sql<WebhookRow>`
        select
          id::text,
          event_type as "eventType",
          provider_reference as "providerReference",
          null::text as "orderId",
          signature_valid as "signatureValid",
          processing_error as "processingError",
          received_at::text as "receivedAt",
          processed_at::text as "processedAt"
        from public.payment_events
        where processed_at is not null and processing_error is null
        order by received_at desc
        limit ${limit + 1}
      `.execute(this.database.db);
    } else if (query.status === 'pending') {
      rows = await sql<WebhookRow>`
        select
          id::text,
          event_type as "eventType",
          provider_reference as "providerReference",
          null::text as "orderId",
          signature_valid as "signatureValid",
          processing_error as "processingError",
          received_at::text as "receivedAt",
          processed_at::text as "processedAt"
        from public.payment_events
        where processed_at is null and processing_error is null
        order by received_at desc
        limit ${limit + 1}
      `.execute(this.database.db);
    } else {
      rows = await sql<WebhookRow>`
        select
          id::text,
          event_type as "eventType",
          provider_reference as "providerReference",
          null::text as "orderId",
          signature_valid as "signatureValid",
          processing_error as "processingError",
          received_at::text as "receivedAt",
          processed_at::text as "processedAt"
        from public.payment_events
        order by received_at desc
        limit ${limit + 1}
      `.execute(this.database.db);
    }

    const hasMore = rows.rows.length > limit;
    const items = rows.rows.slice(0, limit).map(dbRowToWebhookEvent);
    return createListEnvelope(items, { hasMore, limit });
  }

  @Get(':webhookId')
  @ApiParam({ name: 'webhookId', type: String })
  @ApiOkResponse({ description: 'Single webhook event detail.' })
  async getWebhook(
    @CurrentActor() _actor: AuthenticatedActor,
    @Param() params: WebhookIdParamDto
  ): Promise<SuccessEnvelope<WebhookDetail>> {
    type DetailRow = {
      id: string;
      eventType: string;
      providerReference: string | null;
      signatureValid: boolean;
      processingError: string | null;
      receivedAt: string;
      processedAt: string | null;
      payload: Record<string, unknown>;
    };

    const rows = await sql<DetailRow>`
      select
        id::text,
        event_type as "eventType",
        provider_reference as "providerReference",
        signature_valid as "signatureValid",
        processing_error as "processingError",
        received_at::text as "receivedAt",
        processed_at::text as "processedAt",
        payload
      from public.payment_events
      where id = ${params.webhookId}::uuid
      limit 1
    `.execute(this.database.db);

    const r = rows.rows[0];
    if (r === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Webhook event not found.'
      });
    }

    // Strip customer PII from payload for safe summary (drop 'data' field which has raw Paystack data)
    const { data: _data, ...safeSummary } = r.payload as Record<string, unknown> & {
      data?: unknown;
    };

    return createSuccessEnvelope({
      ...dbRowToWebhookEvent({ ...r, orderId: null }),
      safeSummary
    });
  }

  @Post(':webhookId/retry')
  @HttpCode(200)
  @ApiParam({ name: 'webhookId', type: String })
  @ApiOkResponse({ description: 'Webhook cleared for reprocessing.' })
  async retryWebhook(
    @CurrentActor() _actor: AuthenticatedActor,
    @Param() params: WebhookIdParamDto
  ): Promise<SuccessEnvelope<{ queued: boolean }>> {
    const result = await sql<{ id: string }>`
      update public.payment_events
      set processing_error = null, processed_at = null
      where id = ${params.webhookId}::uuid
      returning id::text
    `.execute(this.database.db);

    if (result.rows.length === 0) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Webhook event not found.'
      });
    }
    return createSuccessEnvelope({ queued: true });
  }

  @Post(':webhookId/review')
  @HttpCode(200)
  @ApiParam({ name: 'webhookId', type: String })
  @ApiOkResponse({ description: 'Webhook acknowledged and marked as reviewed.' })
  async reviewWebhook(
    @CurrentActor() _actor: AuthenticatedActor,
    @Param() params: WebhookIdParamDto,
    @Body() _input: AdminWebhookReviewDto
  ): Promise<SuccessEnvelope<{ reviewed: boolean }>> {
    const result = await sql<{ id: string }>`
      update public.payment_events
      set processed_at = now(), processing_error = null
      where id = ${params.webhookId}::uuid and processing_error is not null
      returning id::text
    `.execute(this.database.db);

    if (result.rows.length === 0) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Webhook event not found or not in a failed state.'
      });
    }
    return createSuccessEnvelope({ reviewed: true });
  }
}
