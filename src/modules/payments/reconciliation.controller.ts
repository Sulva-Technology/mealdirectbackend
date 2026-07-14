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
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import {
  ReconciliationIssueDetailEnvelopeDto,
  ReconciliationIssueEnvelopeDto,
  ReconciliationIssueIdParamDto,
  ReconciliationIssueListEnvelopeDto,
  ReconciliationIssueListQueryDto,
  ReconciliationNoteDto,
  ReconciliationNoteEnvelopeDto,
  ReconciliationReviewDto,
  ReconciliationScanEnvelopeDto
} from './dto/reconciliation.dto.js';
import type { PaymentReconciliationResponse } from './payments.types.js';
import { ReconciliationService } from './reconciliation.service.js';
import type {
  ReconciliationIssueDetail,
  ReconciliationIssueRecord,
  ReconciliationNoteRecord
} from './reconciliation.types.js';

@ApiTags('admin-reconciliation')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/payments/reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService
  ) {}

  @Post('scan')
  @HttpCode(200)
  @RequirePermission('reconciliation:manage')
  @ApiOkResponse({
    description: 'Scans the database for reconciliation discrepancies and upserts issues.',
    type: ReconciliationScanEnvelopeDto
  })
  async scan(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<{ detected: number }>> {
    return createSuccessEnvelope(await this.reconciliation.scan(actor));
  }

  @Get('issues')
  @ApiOkResponse({
    description: 'Reconciliation issues scoped by campus for campus admins.',
    type: ReconciliationIssueListEnvelopeDto
  })
  async listIssues(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: ReconciliationIssueListQueryDto
  ): Promise<ListEnvelope<ReconciliationIssueRecord>> {
    const result = await this.reconciliation.listIssues(
      actor,
      {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.issueType === undefined ? {} : { issueType: query.issueType }),
        ...(query.severity === undefined ? {} : { severity: query.severity })
      },
      {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit })
      }
    );
    return createListEnvelope(result.items, {
      hasMore: result.hasMore,
      limit: result.limit,
      ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor })
    });
  }

  @Get('issues/:issueId')
  @ApiParam({ format: 'uuid', name: 'issueId', type: String })
  @ApiOkResponse({
    description: 'Reconciliation issue detail with investigation notes.',
    type: ReconciliationIssueDetailEnvelopeDto
  })
  async getIssue(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ReconciliationIssueIdParamDto
  ): Promise<SuccessEnvelope<ReconciliationIssueDetail>> {
    return createSuccessEnvelope(await this.reconciliation.getIssue(actor, params.issueId));
  }

  @Post('issues/:issueId/verify-payment')
  @HttpCode(200)
  @RequirePermission('payments:verify')
  @ApiParam({ format: 'uuid', name: 'issueId', type: String })
  @ApiOkResponse({ description: 'Re-verifies the issue payment against Paystack.' })
  async verifyPayment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ReconciliationIssueIdParamDto
  ): Promise<SuccessEnvelope<PaymentReconciliationResponse>> {
    return createSuccessEnvelope(await this.reconciliation.verifyPayment(actor, params.issueId));
  }

  @Post('issues/:issueId/retry-webhook')
  @HttpCode(200)
  @RequirePermission('reconciliation:manage')
  @ApiParam({ format: 'uuid', name: 'issueId', type: String })
  @ApiOkResponse({ description: 'Retries a failed webhook by re-verifying its payment.' })
  async retryWebhook(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ReconciliationIssueIdParamDto
  ): Promise<SuccessEnvelope<PaymentReconciliationResponse>> {
    return createSuccessEnvelope(await this.reconciliation.retryWebhook(actor, params.issueId));
  }

  @Post('issues/:issueId/review')
  @HttpCode(200)
  @RequirePermission('reconciliation:manage')
  @ApiParam({ format: 'uuid', name: 'issueId', type: String })
  @ApiOkResponse({
    description: 'Marks a reconciliation issue investigating/resolved/ignored.',
    type: ReconciliationIssueEnvelopeDto
  })
  async reviewIssue(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ReconciliationIssueIdParamDto,
    @Body() input: ReconciliationReviewDto
  ): Promise<SuccessEnvelope<ReconciliationIssueRecord>> {
    return createSuccessEnvelope(
      await this.reconciliation.reviewIssue(actor, params.issueId, {
        status: input.status,
        ...(input.resolutionNote === undefined ? {} : { resolutionNote: input.resolutionNote })
      })
    );
  }

  @Post('issues/:issueId/notes')
  @HttpCode(201)
  @RequirePermission('reconciliation:manage')
  @ApiParam({ format: 'uuid', name: 'issueId', type: String })
  @ApiOkResponse({
    description: 'Adds an internal investigation note to a reconciliation issue.',
    type: ReconciliationNoteEnvelopeDto
  })
  async addNote(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ReconciliationIssueIdParamDto,
    @Body() input: ReconciliationNoteDto
  ): Promise<SuccessEnvelope<ReconciliationNoteRecord>> {
    return createSuccessEnvelope(
      await this.reconciliation.addNote(actor, params.issueId, input.body)
    );
  }
}
