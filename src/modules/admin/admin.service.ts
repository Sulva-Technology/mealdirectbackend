import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { AuditService, actorTypeForRole } from '../../common/audit/audit.service.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import type { CursorPage, CursorPaginationInput } from '../../common/api/pagination.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { ChatService } from '../chat/chat.service.js';
import type { ChatMessage, ChatParticipant } from '../chat/chat.types.js';
import { SupabaseAuthService } from '../auth/supabase-auth.service.js';
import { VendorInvitationsRepository } from '../auth/vendor-invitations.repository.js';
import type { VendorInvitationRecord } from '../auth/vendor-invitations.repository.js';
import { AdminRepository } from './admin.repository.js';
import type { AdminDashboard, AdminListResult, AdminRecord, AdminSession } from './admin.types.js';
import type {
  AdminAnalyticsQueryDto,
  AdminAuditLogQueryDto,
  AdminBatchListQueryDto,
  AdminCreateMembershipDto,
  AdminCreateVendorDto,
  AdminCreateVendorInvitationDto,
  AdminDirectoryQueryDto,
  AdminEscalationAssignDto,
  AdminEscalationQueryDto,
  AdminEscalationResolveDto,
  AdminInventoryAdjustmentDto,
  AdminInventoryQueryDto,
  AdminMarkPaidDto,
  AdminModerateReviewDto,
  AdminOrderListQueryDto,
  AdminPatchVendorDto,
  AdminReasonDto,
  AdminRiderListQueryDto,
  AdminReviewQueryDto,
  AdminSettlementAdjustmentDto,
  AdminSettlementGenerationDto,
  AdminSettlementQueryDto,
  AdminStatusTransitionDto,
  AdminUserListQueryDto,
  AdminVendorListQueryDto,
  AdminVendorUserDto
} from './dto/admin.dto.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_FAILED,
    message
  });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(AdminRepository) private readonly repository: AdminRepository,
    @Optional() @Inject(EnvService) private readonly env?: EnvService,
    @Optional()
    @Inject(VendorInvitationsRepository)
    private readonly invitations?: VendorInvitationsRepository,
    @Optional()
    @Inject(SupabaseAuthService)
    private readonly auth?: SupabaseAuthService,
    @Optional()
    @Inject(AuditService)
    private readonly audit?: AuditService,
    @Optional()
    @Inject(ChatService)
    private readonly chat?: ChatService
  ) {}

  /**
   * Remove a user (any type). Super admin only; an admin cannot delete their own account.
   * A user with no append-only history is hard-deleted (profile + Auth user gone). A user
   * with history cannot be hard-deleted (append-only guard) and is instead anonymized (PII
   * scrubbed, roles deactivated) and banned from signing in. The chosen outcome is returned
   * and audited with a pre-action snapshot.
   */
  async deleteUser(
    actor: AuthenticatedActor,
    userId: string
  ): Promise<{ userId: string; outcome: 'deleted' | 'anonymized' }> {
    this.assertSuperAdmin(actor);
    if (userId === actor.userId) {
      throw badRequest('You cannot delete your own account.');
    }
    if (this.auth === undefined) {
      throw badRequest('Supabase auth admin is not configured.');
    }

    const snapshot = await this.repository.getUserDeletionSnapshot(userId);
    if (snapshot === undefined) {
      throw notFound('User was not found.');
    }

    const outcome: 'deleted' | 'anonymized' = snapshot.hasHistory ? 'anonymized' : 'deleted';

    // Capture the target identity before it is scrubbed/removed; the audit actor FK survives
    // but the target's details would otherwise be unrecoverable.
    await this.audit?.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'admin.user.delete',
      entityType: 'user',
      entityId: userId,
      before: { ...snapshot },
      metadata: { orderCount: snapshot.orderCount, outcome }
    });

    if (outcome === 'deleted') {
      await this.repository.purgeUser(userId);
      // profiles row is gone, so the Auth user can now be removed (FK restrict cleared).
      await this.auth.deleteAuthUser(userId);
    } else {
      await this.repository.anonymizeUser(userId);
      // Profile stays (append-only refs), so ban login rather than deleting the Auth user.
      await this.auth.banAuthUser(userId);
    }

    return { userId, outcome };
  }

  getSession(actor: AuthenticatedActor): AdminSession {
    this.assertAdmin(actor);
    return {
      campusId: actor.campusId ?? null,
      role: actor.role,
      scopes:
        actor.role === 'super_admin'
          ? ['admin:global']
          : [`admin:campus:${actor.campusId ?? 'unscoped'}`],
      userId: actor.userId,
      ...(actor.email === undefined ? {} : { email: actor.email })
    };
  }

  getDashboard(
    actor: AuthenticatedActor,
    query: AdminDirectoryQueryDto & { date?: string }
  ): Promise<AdminDashboard> {
    return this.repository.getDashboard(
      this.campusScope(actor, query.campusId),
      query.date ?? today()
    );
  }

  listOrders(actor: AuthenticatedActor, query: AdminOrderListQueryDto): Promise<AdminListResult> {
    return this.repository.listOrders(query, this.campusScope(actor, query.campusId));
  }

  async getOrder(actor: AuthenticatedActor, orderId: string): Promise<AdminRecord> {
    return this.requireRecord(
      await this.repository.getOrder(orderId, this.campusScope(actor)),
      'Order was not found.'
    );
  }

  async cancelOrder(
    actor: AuthenticatedActor,
    orderId: string,
    input: AdminReasonDto
  ): Promise<AdminRecord> {
    await this.getOrder(actor, orderId);
    return this.transitionOrder(actor, orderId, {
      reason: input.reason ?? 'Cancelled by admin.',
      status: 'cancelled'
    });
  }

  async transitionOrder(
    actor: AuthenticatedActor,
    orderId: string,
    input: AdminStatusTransitionDto
  ): Promise<AdminRecord> {
    await this.getOrder(actor, orderId);
    try {
      return this.requireRecord(
        await this.repository.transitionOrder(orderId, input.status, actor.userId, input.reason),
        'Order was not found.'
      );
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Order status transition failed.');
    }
  }

  listBatches(actor: AuthenticatedActor, query: AdminBatchListQueryDto): Promise<AdminListResult> {
    return this.repository.listBatches(query, this.campusScope(actor, query.campusId));
  }

  async getBatch(actor: AuthenticatedActor, batchId: string): Promise<AdminRecord> {
    const batch = this.requireRecord(
      await this.repository.getBatch(batchId, this.campusScope(actor)),
      'Batch was not found.'
    );
    const orders = await this.repository.findBatchOrders(batchId);
    return { ...batch, orders };
  }

  async closeBatch(actor: AuthenticatedActor, batchId: string): Promise<AdminRecord> {
    await this.getBatch(actor, batchId);
    return this.requireRecord(await this.repository.closeBatch(batchId), 'Batch was not found.');
  }

  // Read-only chat oversight. getBatch enforces admin campus scope + existence first.
  async getBatchChatMessages(
    actor: AuthenticatedActor,
    batchId: string,
    input: CursorPaginationInput
  ): Promise<CursorPage<ChatMessage>> {
    await this.getBatch(actor, batchId);
    if (this.chat === undefined) {
      throw badRequest('Chat oversight is not configured.');
    }
    return this.chat.listMessagesForOversight(batchId, input);
  }

  async getBatchChatParticipants(
    actor: AuthenticatedActor,
    batchId: string
  ): Promise<ChatParticipant[]> {
    await this.getBatch(actor, batchId);
    if (this.chat === undefined) {
      throw badRequest('Chat oversight is not configured.');
    }
    return this.chat.listParticipantsForOversight(batchId);
  }

  // Admin posts into the batch chat as "Support". getBatch enforces campus scope first.
  async postBatchChatMessage(
    actor: AuthenticatedActor,
    batchId: string,
    body: string
  ): Promise<ChatMessage> {
    await this.getBatch(actor, batchId);
    if (this.chat === undefined) {
      throw badRequest('Chat oversight is not configured.');
    }
    return this.chat.postAsAdmin(batchId, actor.userId, body);
  }

  async assignBatch(
    actor: AuthenticatedActor,
    batchId: string,
    input: { riderId?: string; vendorId?: string }
  ): Promise<AdminRecord> {
    await this.getBatch(actor, batchId);
    return this.requireRecord(
      await this.repository.assignBatch(batchId, actor.userId, input),
      'Batch was not found.'
    );
  }

  async cancelBatchAssignment(actor: AuthenticatedActor, batchId: string): Promise<AdminRecord> {
    await this.getBatch(actor, batchId);
    return this.requireRecord(
      await this.repository.cancelAssignment(batchId),
      'Batch was not found.'
    );
  }

  listVendors(actor: AuthenticatedActor, query: AdminVendorListQueryDto): Promise<AdminListResult> {
    return this.repository.listVendors(query, this.campusScope(actor, query.campusId));
  }

  async createVendor(actor: AuthenticatedActor, input: AdminCreateVendorDto): Promise<AdminRecord> {
    this.campusScope(actor, input.campusId);
    return this.requireRecord(
      await this.repository.createVendor({
        campusId: input.campusId,
        createdByAdminId: actor.userId,
        displayName: input.displayName,
        legalName: input.legalName,
        slug: input.slug
      }),
      'Vendor was not created.'
    );
  }

  async getVendor(actor: AuthenticatedActor, vendorId: string): Promise<AdminRecord> {
    return this.requireRecord(
      await this.repository.getVendor(vendorId, this.campusScope(actor)),
      'Vendor was not found.'
    );
  }

  async updateVendor(
    actor: AuthenticatedActor,
    vendorId: string,
    input: AdminPatchVendorDto
  ): Promise<AdminRecord> {
    await this.getVendor(actor, vendorId);
    return this.requireRecord(
      await this.repository.updateVendor(vendorId, input),
      'Vendor was not found.'
    );
  }

  async setVendorStatus(
    actor: AuthenticatedActor,
    vendorId: string,
    status: 'approved' | 'pending' | 'suspended'
  ): Promise<AdminRecord> {
    await this.getVendor(actor, vendorId);
    return this.requireRecord(
      await this.repository.setVendorStatus(vendorId, status, actor.userId),
      'Vendor was not found.'
    );
  }

  async addVendorUser(
    actor: AuthenticatedActor,
    vendorId: string,
    input: AdminVendorUserDto
  ): Promise<AdminRecord> {
    await this.getVendor(actor, vendorId);
    const record = this.requireRecord(
      await this.repository.addVendorUser(vendorId, input.userId, input.role),
      'Vendor user was not created.'
    );
    await this.syncUserAppMetadata(input.userId, {
      meal_direct_role: 'vendor',
      vendor_id: vendorId
    });
    return record;
  }

  async createVendorInvitation(
    actor: AuthenticatedActor,
    vendorId: string,
    input: AdminCreateVendorInvitationDto
  ): Promise<VendorInvitationRecord & { inviteUrl: string }> {
    await this.getVendor(actor, vendorId);
    if (this.invitations === undefined) {
      throw badRequest('Vendor invitations are not configured.');
    }

    const token = randomBytes(32).toString('base64url');
    const record = await this.invitations.create({
      actorUserId: actor.userId,
      email: input.email.trim().toLowerCase(),
      expiresInHours: input.expiresInHours ?? 72,
      role: input.role,
      tokenHash: hashInviteToken(token),
      vendorId
    });

    return {
      ...this.requireRecord(record, 'Vendor invitation was not created.'),
      inviteUrl: this.vendorInviteUrl(token)
    };
  }

  async listVendorInvitations(
    actor: AuthenticatedActor,
    vendorId: string
  ): Promise<VendorInvitationRecord[]> {
    await this.getVendor(actor, vendorId);
    if (this.invitations === undefined) {
      throw badRequest('Vendor invitations are not configured.');
    }
    return this.invitations.listByVendor(vendorId);
  }

  async getVendorPerformance(actor: AuthenticatedActor, vendorId: string): Promise<AdminRecord> {
    await this.getVendor(actor, vendorId);
    return this.repository.getVendorPerformance(vendorId);
  }

  listRiders(actor: AuthenticatedActor, query: AdminRiderListQueryDto): Promise<AdminListResult> {
    return this.repository.listRiders(query, this.campusScope(actor, query.campusId));
  }

  async getRider(actor: AuthenticatedActor, riderId: string): Promise<AdminRecord> {
    return this.requireRecord(
      await this.repository.getRider(riderId, this.campusScope(actor)),
      'Rider was not found.'
    );
  }

  async listRiderAssignments(actor: AuthenticatedActor, riderId: string): Promise<AdminRecord[]> {
    await this.getRider(actor, riderId);
    return this.repository.listRiderAssignments(riderId, this.campusScope(actor));
  }

  async listRiderSettlements(actor: AuthenticatedActor, riderId: string): Promise<AdminRecord[]> {
    await this.getRider(actor, riderId);
    return this.repository.listRiderSettlements(riderId, this.campusScope(actor));
  }

  async setRiderStatus(
    actor: AuthenticatedActor,
    riderId: string,
    status: 'suspended' | 'verified'
  ): Promise<AdminRecord> {
    await this.getRider(actor, riderId);
    return this.requireRecord(
      await this.repository.setRiderStatus(riderId, status, actor.userId),
      'Rider was not found.'
    );
  }

  listInventory(actor: AuthenticatedActor, query: AdminInventoryQueryDto): Promise<AdminRecord[]> {
    return this.repository.listInventory(query, this.campusScope(actor, query.campusId));
  }

  adjustInventory(
    actor: AuthenticatedActor,
    inventoryId: string,
    input: AdminInventoryAdjustmentDto
  ): Promise<AdminRecord | undefined> {
    this.assertAdmin(actor);
    return this.repository.adjustInventory(inventoryId, input.delta, input.reason, actor.userId);
  }

  listEscalations(
    actor: AuthenticatedActor,
    query: AdminEscalationQueryDto
  ): Promise<AdminListResult> {
    return this.repository.listEscalations(query, this.campusScope(actor, query.campusId));
  }

  async getEscalation(actor: AuthenticatedActor, id: string): Promise<AdminRecord> {
    return this.requireRecord(
      await this.repository.getEscalation(id, this.campusScope(actor)),
      'Escalation was not found.'
    );
  }

  async assignEscalation(
    actor: AuthenticatedActor,
    id: string,
    input: AdminEscalationAssignDto
  ): Promise<AdminRecord> {
    await this.getEscalation(actor, id);
    return this.requireRecord(
      await this.repository.updateEscalation(id, {
        assignedAdminId: input.adminUserId,
        status: 'investigating'
      }),
      'Escalation was not found.'
    );
  }

  async requestEvidence(actor: AuthenticatedActor, id: string): Promise<AdminRecord> {
    await this.getEscalation(actor, id);
    return this.requireRecord(
      await this.repository.updateEscalation(id, { status: 'investigating' }),
      'Escalation was not found.'
    );
  }

  async resolveEscalation(
    actor: AuthenticatedActor,
    id: string,
    input: AdminEscalationResolveDto
  ): Promise<AdminRecord> {
    await this.getEscalation(actor, id);
    return this.requireRecord(
      await this.repository.updateEscalation(id, {
        resolution: input.resolution,
        status: 'resolved'
      }),
      'Escalation was not found.'
    );
  }

  async refundEscalation(actor: AuthenticatedActor, id: string): Promise<AdminRecord> {
    await this.getEscalation(actor, id);
    return this.requireRecord(
      await this.repository.updateEscalation(id, { status: 'resolved' }),
      'Escalation was not found.'
    );
  }

  listSettlements(
    actor: AuthenticatedActor,
    query: AdminSettlementQueryDto
  ): Promise<AdminListResult> {
    return this.repository.listSettlements(query, this.campusScope(actor, query.campusId));
  }

  async getSettlement(actor: AuthenticatedActor, id: string): Promise<AdminRecord> {
    return this.requireRecord(
      await this.repository.getSettlement(id, this.campusScope(actor)),
      'Settlement was not found.'
    );
  }

  previewSettlement(
    actor: AuthenticatedActor,
    input: AdminSettlementGenerationDto
  ): Promise<AdminRecord> {
    this.assertAdmin(actor);
    return this.repository.previewSettlement(
      input.beneficiaryType,
      input.beneficiaryId,
      input.settlementDate
    );
  }

  generateSettlement(
    actor: AuthenticatedActor,
    input: AdminSettlementGenerationDto
  ): Promise<AdminRecord | undefined> {
    this.assertAdmin(actor);
    return this.repository.generateSettlement(
      input.beneficiaryType,
      input.beneficiaryId,
      input.settlementDate,
      actor.userId
    );
  }

  async approveSettlement(actor: AuthenticatedActor, id: string): Promise<AdminRecord> {
    await this.getSettlement(actor, id);
    return this.requireRecord(
      await this.repository.setSettlementStatus(id, 'approved', actor.userId),
      'Settlement was not found.'
    );
  }

  async markSettlementPaid(
    actor: AuthenticatedActor,
    id: string,
    input: AdminMarkPaidDto
  ): Promise<AdminRecord> {
    await this.getSettlement(actor, id);
    return this.requireRecord(
      await this.repository.setSettlementStatus(id, 'paid', actor.userId, input.externalReference),
      'Settlement was not found.'
    );
  }

  async adjustSettlement(
    actor: AuthenticatedActor,
    id: string,
    input: AdminSettlementAdjustmentDto
  ): Promise<AdminRecord> {
    await this.getSettlement(actor, id);
    return this.requireRecord(
      await this.repository.adjustSettlement(id, input.amountKobo, input.description),
      'Settlement was not found.'
    );
  }

  listReviews(actor: AuthenticatedActor, query: AdminReviewQueryDto): Promise<AdminListResult> {
    return this.repository.listReviews(query, this.campusScope(actor, query.campusId));
  }

  async moderateReview(
    actor: AuthenticatedActor,
    reviewId: string,
    input: AdminModerateReviewDto
  ): Promise<AdminRecord> {
    this.assertAdmin(actor);
    return this.requireRecord(
      await this.repository.moderateReview(reviewId, input.status),
      'Review was not found.'
    );
  }

  listUsers(actor: AuthenticatedActor, query: AdminUserListQueryDto): Promise<AdminListResult> {
    return this.repository.listUsers(query, this.campusScope(actor, query.campusId));
  }

  async getUser(actor: AuthenticatedActor, userId: string): Promise<AdminRecord> {
    return this.requireRecord(
      await this.repository.getUser(userId, this.campusScope(actor)),
      'User was not found.'
    );
  }

  async setUserStatus(
    actor: AuthenticatedActor,
    userId: string,
    status: 'active' | 'suspended'
  ): Promise<AdminRecord> {
    this.assertSuperAdmin(actor);
    return this.requireRecord(
      await this.repository.setUserStatus(userId, status),
      'User was not found.'
    );
  }

  listAdminMemberships(actor: AuthenticatedActor): Promise<AdminRecord[]> {
    this.assertSuperAdmin(actor);
    return this.repository.listAdminMemberships();
  }

  async createAdminMembership(
    actor: AuthenticatedActor,
    input: AdminCreateMembershipDto
  ): Promise<AdminRecord | undefined> {
    this.assertSuperAdmin(actor);
    if (input.role === 'campus_admin' && input.campusId === undefined) {
      throw badRequest('campusId is required for campus admin memberships.');
    }
    const record = await this.repository.createAdminMembership(input, actor.userId);
    if (record !== undefined) {
      await this.syncUserAppMetadata(input.userId, this.adminAppMetadata(input));
    }
    return record;
  }

  setAdminMembershipActive(
    actor: AuthenticatedActor,
    id: string,
    active: boolean
  ): Promise<AdminRecord | undefined> {
    this.assertSuperAdmin(actor);
    return this.repository.setAdminMembershipActive(id, active);
  }

  getAnalytics(actor: AuthenticatedActor, query: AdminAnalyticsQueryDto): Promise<AdminRecord> {
    return this.repository.getAnalytics(query, this.campusScope(actor, query.campusId));
  }

  listAuditLogs(actor: AuthenticatedActor, query: AdminAuditLogQueryDto): Promise<AdminListResult> {
    return this.repository.listAuditLogs(query, this.campusScope(actor, query.campusId));
  }

  private assertAdmin(actor: AuthenticatedActor): void {
    if (actor.role !== 'campus_admin' && actor.role !== 'super_admin') {
      throw forbidden('Admin role is required.');
    }
    if (actor.role === 'campus_admin' && actor.campusId === undefined) {
      throw forbidden('Campus admin campus scope is required.');
    }
  }

  private assertSuperAdmin(actor: AuthenticatedActor): void {
    if (actor.role !== 'super_admin') {
      throw forbidden('Super admin access is required.');
    }
  }

  private campusScope(actor: AuthenticatedActor, requestedCampusId?: string): string | undefined {
    this.assertAdmin(actor);
    if (actor.role === 'super_admin') {
      return requestedCampusId;
    }
    if (requestedCampusId !== undefined && requestedCampusId !== actor.campusId) {
      throw forbidden('Campus scope is not allowed for this admin.');
    }
    return actor.campusId;
  }

  private requireRecord<T>(record: T | undefined, message: string): T {
    if (record === undefined) {
      throw notFound(message);
    }
    return record;
  }

  private vendorInviteUrl(token: string): string {
    const baseUrl = this.env?.get('APP_URL_VENDOR') ?? 'https://vendor.mealdirectly.com';
    const url = new URL('/accept-invite', baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private adminAppMetadata(input: AdminCreateMembershipDto): Record<string, unknown> {
    if (input.role === 'super_admin') {
      return {
        campus_id: null,
        meal_direct_role: 'super_admin'
      };
    }

    return {
      campus_id: input.campusId ?? null,
      meal_direct_role: 'campus_admin'
    };
  }

  private async syncUserAppMetadata(
    userId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (this.auth === undefined) {
      throw badRequest('Supabase auth metadata sync is not configured.');
    }
    await this.auth.setUserAppMetadata(userId, metadata);
  }
}

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
