import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
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
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AdminService } from './admin.service.js';
import type { AdminDashboard, AdminRecord, AdminSession } from './admin.types.js';
import {
  AdminAnalyticsQueryDto,
  AdminAssignRiderDto,
  AdminAuditLogQueryDto,
  AdminBatchIdParamDto,
  AdminBatchListQueryDto,
  AdminCreateMembershipDto,
  AdminCreateVendorDto,
  AdminCreateVendorInvitationDto,
  AdminDashboardQueryDto,
  AdminEscalationAssignDto,
  AdminEscalationQueryDto,
  AdminEscalationResolveDto,
  AdminInventoryAdjustmentDto,
  AdminInventoryIdParamDto,
  AdminInventoryQueryDto,
  AdminMarkPaidDto,
  AdminModerateReviewDto,
  AdminOrderIdParamDto,
  AdminOrderListQueryDto,
  AdminPatchVendorDto,
  AdminReasonDto,
  AdminRiderIdParamDto,
  AdminRiderListQueryDto,
  AdminReviewIdParamDto,
  AdminReviewQueryDto,
  AdminSettlementAdjustmentDto,
  AdminSettlementGenerationDto,
  AdminSettlementQueryDto,
  AdminStatusTransitionDto,
  AdminUserIdParamDto,
  AdminUserListQueryDto,
  AdminVendorDeliveryDto,
  AdminVendorIdParamDto,
  AdminVendorListQueryDto,
  AdminVendorUserDto,
  UuidIdParamDto
} from './dto/admin.dto.js';

function listEnvelope(result: {
  items: AdminRecord[];
  hasMore: boolean;
  limit: number;
}): ListEnvelope<AdminRecord> {
  return createListEnvelope(result.items, {
    hasMore: result.hasMore,
    limit: result.limit
  });
}

@ApiTags('admin')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('session')
  @ApiOkResponse({ description: 'Authenticated admin session and scope.' })
  getSession(@CurrentActor() actor: AuthenticatedActor): SuccessEnvelope<AdminSession> {
    return createSuccessEnvelope(this.admin.getSession(actor));
  }

  @Get('dashboard')
  @ApiOkResponse({ description: 'Admin operational dashboard for a service date.' })
  async getDashboard(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminDashboardQueryDto
  ): Promise<SuccessEnvelope<AdminDashboard>> {
    return createSuccessEnvelope(await this.admin.getDashboard(actor, query));
  }

  @Get('orders')
  async listOrders(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminOrderListQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listOrders(actor, query));
  }

  @Get('orders/:orderId')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  async getOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminOrderIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getOrder(actor, params.orderId));
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  async cancelOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminOrderIdParamDto,
    @Body() input: AdminReasonDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.cancelOrder(actor, params.orderId, input));
  }

  @Post('orders/:orderId/status-transition')
  @HttpCode(200)
  async transitionOrder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminOrderIdParamDto,
    @Body() input: AdminStatusTransitionDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.transitionOrder(actor, params.orderId, input));
  }

  @Get('batches')
  async listBatches(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminBatchListQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listBatches(actor, query));
  }

  @Get('batches/:batchId')
  async getBatch(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminBatchIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getBatch(actor, params.batchId));
  }

  @Post('batches/:batchId/close')
  @HttpCode(200)
  async closeBatch(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminBatchIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.closeBatch(actor, params.batchId));
  }

  @Post('batches/:batchId/assign-rider')
  @HttpCode(200)
  async assignRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminBatchIdParamDto,
    @Body() input: AdminAssignRiderDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.assignBatch(actor, params.batchId, { riderId: input.riderId })
    );
  }

  @Post('batches/:batchId/assign-vendor-delivery')
  @HttpCode(200)
  async assignVendorDelivery(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminBatchIdParamDto,
    @Body() input: AdminVendorDeliveryDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.assignBatch(actor, params.batchId, { vendorId: input.vendorId })
    );
  }

  @Post('batches/:batchId/reassign-rider')
  @HttpCode(200)
  async reassignRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminBatchIdParamDto,
    @Body() input: AdminAssignRiderDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.assignBatch(actor, params.batchId, { riderId: input.riderId })
    );
  }

  @Post('batches/:batchId/cancel-assignment')
  @HttpCode(200)
  async cancelAssignment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminBatchIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.cancelBatchAssignment(actor, params.batchId));
  }

  @Get('vendors')
  async listVendors(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminVendorListQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listVendors(actor, query));
  }

  @Post('vendors')
  async createVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: AdminCreateVendorDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.createVendor(actor, input));
  }

  @Get('vendors/:vendorId')
  async getVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getVendor(actor, params.vendorId));
  }

  @Patch('vendors/:vendorId')
  async updateVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto,
    @Body() input: AdminPatchVendorDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.updateVendor(actor, params.vendorId, input));
  }

  @Post('vendors/:vendorId/approve')
  @HttpCode(200)
  async approveVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.setVendorStatus(actor, params.vendorId, 'approved')
    );
  }

  @Post('vendors/:vendorId/suspend')
  @HttpCode(200)
  async suspendVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.setVendorStatus(actor, params.vendorId, 'suspended')
    );
  }

  @Post('vendors/:vendorId/activate')
  @HttpCode(200)
  async activateVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.setVendorStatus(actor, params.vendorId, 'approved')
    );
  }

  @Post('vendors/:vendorId/users')
  async addVendorUser(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto,
    @Body() input: AdminVendorUserDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.addVendorUser(actor, params.vendorId, input));
  }

  @Post('vendors/:vendorId/invitations')
  async createVendorInvitation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto,
    @Body() input: AdminCreateVendorInvitationDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.createVendorInvitation(actor, params.vendorId, input)
    );
  }

  @Get('vendors/:vendorId/performance')
  async getVendorPerformance(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminVendorIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getVendorPerformance(actor, params.vendorId));
  }

  @Get('riders')
  async listRiders(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminRiderListQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listRiders(actor, query));
  }

  @Get('riders/:riderId')
  async getRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminRiderIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getRider(actor, params.riderId));
  }

  @Get('riders/:riderId/assignments')
  async getRiderAssignments(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminRiderIdParamDto
  ): Promise<ListEnvelope<AdminRecord>> {
    const items = await this.admin.listRiderAssignments(actor, params.riderId);
    return createListEnvelope(items, { hasMore: false, limit: items.length });
  }

  @Get('riders/:riderId/settlements')
  async getRiderSettlements(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminRiderIdParamDto
  ): Promise<ListEnvelope<AdminRecord>> {
    const items = await this.admin.listRiderSettlements(actor, params.riderId);
    return createListEnvelope(items, { hasMore: false, limit: items.length });
  }

  @Post('riders/:riderId/verify')
  @HttpCode(200)
  async verifyRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminRiderIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.setRiderStatus(actor, params.riderId, 'verified')
    );
  }

  @Post('riders/:riderId/suspend')
  @HttpCode(200)
  async suspendRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminRiderIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.setRiderStatus(actor, params.riderId, 'suspended')
    );
  }

  @Post('riders/:riderId/activate')
  @HttpCode(200)
  async activateRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminRiderIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(
      await this.admin.setRiderStatus(actor, params.riderId, 'verified')
    );
  }

  @Get('inventory')
  async listInventory(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminInventoryQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    const items = await this.admin.listInventory(actor, query);
    return createListEnvelope(items, { hasMore: false, limit: items.length });
  }

  @Post('inventory/:inventoryId/adjustments')
  async adjustInventory(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminInventoryIdParamDto,
    @Body() input: AdminInventoryAdjustmentDto
  ): Promise<SuccessEnvelope<AdminRecord | undefined>> {
    return createSuccessEnvelope(
      await this.admin.adjustInventory(actor, params.inventoryId, input)
    );
  }

  @Get('escalations')
  async listEscalations(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminEscalationQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listEscalations(actor, query));
  }

  @Get('escalations/:id')
  async getEscalation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getEscalation(actor, params.id));
  }

  @Post('escalations/:id/assign')
  @HttpCode(200)
  async assignEscalation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto,
    @Body() input: AdminEscalationAssignDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.assignEscalation(actor, params.id, input));
  }

  @Post('escalations/:id/request-evidence')
  @HttpCode(200)
  async requestEvidence(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.requestEvidence(actor, params.id));
  }

  @Post('escalations/:id/resolve')
  @HttpCode(200)
  async resolveEscalation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto,
    @Body() input: AdminEscalationResolveDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.resolveEscalation(actor, params.id, input));
  }

  @Post('escalations/:id/refunds')
  async refundEscalation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.refundEscalation(actor, params.id));
  }

  @Get('settlements')
  async listSettlements(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminSettlementQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listSettlements(actor, query));
  }

  @Post('settlements/preview')
  @HttpCode(200)
  async previewSettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: AdminSettlementGenerationDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.previewSettlement(actor, input));
  }

  @Post('settlements/generate')
  @HttpCode(200)
  async generateSettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: AdminSettlementGenerationDto
  ): Promise<SuccessEnvelope<AdminRecord | undefined>> {
    return createSuccessEnvelope(await this.admin.generateSettlement(actor, input));
  }

  @Get('settlements/:id')
  async getSettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getSettlement(actor, params.id));
  }

  @Post('settlements/:id/approve')
  @HttpCode(200)
  async approveSettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.approveSettlement(actor, params.id));
  }

  @Post('settlements/:id/mark-paid')
  @HttpCode(200)
  async markSettlementPaid(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto,
    @Body() input: AdminMarkPaidDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.markSettlementPaid(actor, params.id, input));
  }

  @Post('settlements/:id/adjustments')
  async adjustSettlement(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto,
    @Body() input: AdminSettlementAdjustmentDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.adjustSettlement(actor, params.id, input));
  }

  @Get('reviews')
  async listReviews(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminReviewQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listReviews(actor, query));
  }

  @Post('reviews/:reviewId/moderate')
  @HttpCode(200)
  async moderateReview(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminReviewIdParamDto,
    @Body() input: AdminModerateReviewDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.moderateReview(actor, params.reviewId, input));
  }

  @Get('users')
  async listUsers(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminUserListQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listUsers(actor, query));
  }

  @Get('users/:userId')
  async getUser(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminUserIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getUser(actor, params.userId));
  }

  @Post('users/:userId/suspend')
  @HttpCode(200)
  async suspendUser(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminUserIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.setUserStatus(actor, params.userId, 'suspended'));
  }

  @Post('users/:userId/activate')
  @HttpCode(200)
  async activateUser(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: AdminUserIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.setUserStatus(actor, params.userId, 'active'));
  }

  @Get('admin-memberships')
  async listAdminMemberships(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<AdminRecord>> {
    const items = await this.admin.listAdminMemberships(actor);
    return createListEnvelope(items, { hasMore: false, limit: items.length });
  }

  @Post('admin-memberships')
  async createAdminMembership(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: AdminCreateMembershipDto
  ): Promise<SuccessEnvelope<AdminRecord | undefined>> {
    return createSuccessEnvelope(await this.admin.createAdminMembership(actor, input));
  }

  @Post('admin-memberships/:id/revoke')
  @HttpCode(200)
  async revokeAdminMembership(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord | undefined>> {
    return createSuccessEnvelope(
      await this.admin.setAdminMembershipActive(actor, params.id, false)
    );
  }

  @Post('admin-memberships/:id/activate')
  @HttpCode(200)
  async activateAdminMembership(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<AdminRecord | undefined>> {
    return createSuccessEnvelope(await this.admin.setAdminMembershipActive(actor, params.id, true));
  }

  @Get('analytics')
  async getAnalytics(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminAnalyticsQueryDto
  ): Promise<SuccessEnvelope<AdminRecord>> {
    return createSuccessEnvelope(await this.admin.getAnalytics(actor, query));
  }

  @Get('audit-logs')
  async listAuditLogs(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminAuditLogQueryDto
  ): Promise<ListEnvelope<AdminRecord>> {
    return listEnvelope(await this.admin.listAuditLogs(actor, query));
  }
}
