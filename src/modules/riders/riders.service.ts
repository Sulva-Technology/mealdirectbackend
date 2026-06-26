import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { createCursorPage, decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import type { CursorPage, CursorPayload } from '../../common/api/pagination.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { SupabaseAuthService } from '../auth/supabase-auth.service.js';
import type { OrderStatus } from '../orders/orders.types.js';
import type {
  CreateRiderIssueDto,
  OnboardRiderDto,
  RiderAssignmentListQueryDto,
  RiderEarningsQueryDto,
  RiderProfileUpdateDto,
  RiderSettlementListQueryDto
} from './dto/rider.dto.js';
import { RidersRepository } from './riders.repository.js';
import type {
  RiderAssignmentDetail,
  RiderAssignmentSummary,
  RiderEarningsSummary,
  RiderIssueRecord,
  RiderOrderDetail,
  RiderProfile,
  RiderSettlementDetail,
  RiderSettlementSummary,
  RidersRepositoryContract
} from './riders.types.js';

export type RiderOnboardResult = {
  rider: RiderProfile;
  tokenRefreshRequired: boolean;
};

function conflict(message: string): ConflictException {
  return new ConflictException({ code: ErrorCodes.CONFLICT, message });
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

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

function decodeTwoPartCursor(cursor: string, label: string, firstKey: string): string {
  let payload: CursorPayload;
  try {
    payload = decodeCursor(cursor);
  } catch {
    throw badRequest(`Invalid ${label} cursor.`);
  }

  if (typeof payload[firstKey] !== 'string' || typeof payload.id !== 'string') {
    throw badRequest(`Invalid ${label} cursor.`);
  }

  return `${payload[firstKey]}|${payload.id}`;
}

@Injectable()
export class RidersService {
  constructor(
    @Inject(RidersRepository)
    private readonly repository: RidersRepositoryContract,
    @Inject(SupabaseAuthService)
    private readonly auth: SupabaseAuthService
  ) {}

  /**
   * Self-service rider onboarding: provisions the rider record and writes
   * meal_direct_role + rider_id into the caller's app_metadata. The rider starts
   * `pending`/inactive and an admin must verify it before delivery access. The new
   * rider_id only reaches the JWT after the client refreshes its session, hence
   * tokenRefreshRequired.
   */
  async onboardRider(
    actor: AuthenticatedActor,
    input: OnboardRiderDto
  ): Promise<RiderOnboardResult> {
    if (actor.role !== 'rider') {
      throw forbidden('Rider access is required.');
    }

    const alreadyLinked = await this.repository.findRiderIdForUser(actor.userId);
    if (alreadyLinked !== undefined) {
      throw conflict('This account is already linked to a rider.');
    }

    let rider: RiderProfile;
    try {
      rider = await this.repository.onboardRider({
        campusId: input.campusId,
        displayName: input.displayName.trim(),
        phone: input.phone.trim(),
        userId: actor.userId
      });
    } catch (error) {
      const code = postgresErrorCode(error);
      if (code === '23503') {
        // foreign key violation — campus_id does not exist
        throw badRequest('Campus was not found.');
      }
      if (code === '23505') {
        // unique (campus_id, user_id) — already onboarded on this campus
        throw conflict('This account is already linked to a rider.');
      }
      throw error;
    }

    await this.auth.setUserAppMetadata(actor.userId, {
      meal_direct_role: 'rider',
      rider_id: rider.id
    });

    return { rider, tokenRefreshRequired: true };
  }

  async getProfile(actor: AuthenticatedActor): Promise<RiderProfile> {
    return this.resolveRiderProfile(actor, { requireActiveVerified: false });
  }

  async updateProfile(
    actor: AuthenticatedActor,
    input: RiderProfileUpdateDto
  ): Promise<RiderProfile> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: false });
    const update = {
      ...(input.displayName === undefined ? {} : { displayName: input.displayName.trim() }),
      ...(input.phone === undefined ? {} : { phone: input.phone.trim() })
    };

    const updated = await this.repository.updateRiderProfile(profile.id, actor.userId, update);
    if (updated === undefined) {
      throw notFound('Rider profile was not found.');
    }
    return updated;
  }

  async setAvailability(actor: AuthenticatedActor, available: boolean): Promise<RiderProfile> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const updated = await this.repository.setRiderAvailability(
      profile.id,
      actor.userId,
      available
    );
    if (updated === undefined) {
      throw notFound('Rider profile was not found.');
    }
    return updated;
  }

  async listAssignments(
    actor: AuthenticatedActor,
    query: RiderAssignmentListQueryDto
  ): Promise<CursorPage<RiderAssignmentSummary>> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const limit = query.limit ?? 20;
    const rows = await this.repository.listAssignments(profile.id, {
      ...(query.cursor === undefined
        ? {}
        : { cursor: decodeTwoPartCursor(query.cursor, 'assignment', 'assignedAt') }),
      ...(query.date === undefined ? {} : { date: query.date }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit
    });

    return createCursorPage(rows, limit, (assignment) =>
      encodeCursor({
        assignedAt: assignment.assignedAt,
        id: assignment.id
      })
    );
  }

  async getAssignment(
    actor: AuthenticatedActor,
    assignmentId: string
  ): Promise<RiderAssignmentDetail> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const assignment = await this.repository.findAssignmentById(profile.id, assignmentId);
    if (assignment === undefined) {
      throw notFound('Assignment was not found.');
    }

    return {
      ...assignment,
      orders: await this.repository.findAssignmentOrders(assignment.batchId)
    };
  }

  async acceptAssignment(
    actor: AuthenticatedActor,
    assignmentId: string
  ): Promise<RiderAssignmentDetail> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const assignment = await this.repository.acceptAssignment(profile.id, assignmentId);
    if (assignment === undefined) {
      throw notFound('Assignment was not found.');
    }
    if (assignment.status !== 'accepted') {
      throw badRequest('Assignment cannot be accepted from its current status.');
    }

    return {
      ...assignment,
      orders: await this.repository.findAssignmentOrders(assignment.batchId)
    };
  }

  async markAssignmentPickedUp(
    actor: AuthenticatedActor,
    assignmentId: string
  ): Promise<RiderAssignmentDetail> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const assignment = await this.repository.markAssignmentPickedUp(profile.id, assignmentId);
    if (assignment === undefined) {
      throw notFound('Assignment was not found.');
    }
    if (assignment.status !== 'picked_up') {
      throw badRequest('Assignment cannot be marked picked up from its current status.');
    }

    return {
      ...assignment,
      orders: await this.repository.findAssignmentOrders(assignment.batchId)
    };
  }

  async getOrder(actor: AuthenticatedActor, orderId: string): Promise<RiderOrderDetail> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const order = await this.repository.findAssignedOrderById(profile.id, orderId);
    if (order === undefined) {
      throw notFound('Order was not found.');
    }
    return order;
  }

  async markOrderOutForDelivery(
    actor: AuthenticatedActor,
    orderId: string
  ): Promise<RiderOrderDetail> {
    return this.transitionOrder(actor, orderId, 'out_for_delivery');
  }

  async markOrderDelivered(actor: AuthenticatedActor, orderId: string): Promise<RiderOrderDetail> {
    return this.transitionOrder(actor, orderId, 'delivered');
  }

  async createIssue(
    actor: AuthenticatedActor,
    orderId: string,
    input: CreateRiderIssueDto
  ): Promise<RiderIssueRecord> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const issue = await this.repository.createOrderIssue(profile.id, orderId, actor.userId, input);
    if (issue === undefined) {
      throw notFound('Order was not found.');
    }
    return issue;
  }

  async getEarnings(
    actor: AuthenticatedActor,
    query: RiderEarningsQueryDto
  ): Promise<RiderEarningsSummary> {
    this.assertDateRange(query.dateFrom, query.dateTo);
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    return this.repository.getEarningsSummary(profile.id, query.dateFrom, query.dateTo);
  }

  async listSettlements(
    actor: AuthenticatedActor,
    query: RiderSettlementListQueryDto
  ): Promise<CursorPage<RiderSettlementSummary>> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const limit = query.limit ?? 20;
    const rows = await this.repository.listRiderSettlements(profile.id, {
      ...(query.cursor === undefined
        ? {}
        : { cursor: decodeTwoPartCursor(query.cursor, 'settlement', 'settlementDate') }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit
    });

    return createCursorPage(rows, limit, (settlement) =>
      encodeCursor({
        id: settlement.id,
        settlementDate: settlement.settlementDate
      })
    );
  }

  async getSettlement(
    actor: AuthenticatedActor,
    settlementId: string
  ): Promise<RiderSettlementDetail> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const settlement = await this.repository.findRiderSettlementById(profile.id, settlementId);
    if (settlement === undefined) {
      throw notFound('Settlement was not found.');
    }
    return settlement;
  }

  private async transitionOrder(
    actor: AuthenticatedActor,
    orderId: string,
    toStatus: OrderStatus
  ): Promise<RiderOrderDetail> {
    const profile = await this.resolveRiderProfile(actor, { requireActiveVerified: true });
    const before = await this.repository.findAssignedOrderById(profile.id, orderId);
    if (before === undefined) {
      throw notFound('Order was not found.');
    }

    try {
      await this.repository.transitionAssignedOrderStatus(
        profile.id,
        orderId,
        toStatus,
        actor.userId
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Order status transition failed.';
      throw badRequest(message);
    }

    const updated = await this.repository.findAssignedOrderById(profile.id, orderId);
    if (updated === undefined) {
      throw notFound('Order was not found.');
    }
    return updated;
  }

  private async resolveRiderProfile(
    actor: AuthenticatedActor,
    options: { requireActiveVerified: boolean }
  ): Promise<RiderProfile> {
    if (actor.role !== 'rider') {
      throw forbidden('Rider access is required.');
    }

    const profile = await this.repository.findRiderProfileForActor(actor.userId, actor.riderId);
    if (profile === undefined) {
      throw notFound('Rider profile was not found.');
    }

    if (options.requireActiveVerified && (!profile.active || profile.status !== 'verified')) {
      throw forbidden('Verified active rider access is required.');
    }

    if (
      options.requireActiveVerified &&
      !(await this.repository.assertRiderAccess(profile.id, actor.userId))
    ) {
      throw forbidden('Verified active rider access is required.');
    }

    return profile;
  }

  private assertDateRange(dateFrom: string | undefined, dateTo: string | undefined): void {
    if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
      throw badRequest('dateFrom must be before or equal to dateTo.');
    }
  }
}
