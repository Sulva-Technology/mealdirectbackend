import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { AuditService, actorTypeForRole } from '../../common/audit/audit.service.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { SupabaseAuthService } from '../auth/supabase-auth.service.js';
import { FleetRepository } from './fleet.repository.js';
import type {
  FleetBatch,
  FleetEarningsSummary,
  FleetMember,
  FleetMemberRole,
  FleetMembership,
  FleetPartner,
  FleetPartnerCreateInput,
  FleetPartnerListFilters,
  FleetPartnerUpdateInput,
  FleetRider,
  FleetRiderListFilters,
  FleetRiderRef,
  RiderFleet
} from './fleet.types.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

function conflict(message: string): ConflictException {
  return new ConflictException({ code: ErrorCodes.CONFLICT, message });
}

function postgresError(error: unknown): { code?: string; message?: string } {
  return typeof error === 'object' && error !== null ? error : {};
}

/**
 * fleet_assign_batch raises FP-class SQLSTATEs with a client-safe message. Anything else
 * is unexpected and propagates as a 500.
 */
function mapDispatchError(error: unknown): HttpException | undefined {
  const { code, message = 'Batch could not be assigned.' } = postgresError(error);
  switch (code) {
    case 'FP404':
      return notFound(message);
    case 'FP403':
      return forbidden(message);
    case 'FP409':
      return conflict(message);
    case 'FP422':
      return badRequest(message);
    default:
      return undefined;
  }
}

// No 0/O or 1/I: riders type this code in from a WhatsApp message or a poster.
const joinCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCodeLength = 8;
const joinCodeAttempts = 5;

export function generateJoinCode(): string {
  let code = '';
  for (let index = 0; index < joinCodeLength; index += 1) {
    code += joinCodeAlphabet.charAt(randomInt(joinCodeAlphabet.length));
  }
  return code;
}

export function normalizeJoinCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** Partner commission on its riders' delivery earnings, rounded down to the kobo. */
export function commissionKobo(totalKobo: number, commissionBps: number): number {
  return Math.floor((totalKobo * commissionBps) / 10_000);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Everything a fleet manager may do is gated on one of these. */
type FleetAccess = { partner: FleetPartner; role: FleetMemberRole };

@Injectable()
export class FleetService {
  constructor(
    @Inject(FleetRepository) private readonly repository: FleetRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional()
    @Inject(SupabaseAuthService)
    private readonly auth?: SupabaseAuthService
  ) {}

  // ---------------------------------------------------------------------------
  // Platform admin
  // ---------------------------------------------------------------------------

  async listPartners(
    actor: AuthenticatedActor,
    filters: FleetPartnerListFilters
  ): Promise<FleetPartner[]> {
    return await this.repository.listPartners({
      ...filters,
      ...this.optionalCampusFilter(actor, filters.campusId)
    });
  }

  async getPartnerForAdmin(
    actor: AuthenticatedActor,
    partnerId: string
  ): Promise<FleetPartner & { managers: FleetMember[]; riders: FleetRider[] }> {
    const partner = await this.requirePartnerForAdmin(actor, partnerId);
    const [managers, riders] = await Promise.all([
      this.repository.listMembers(partnerId),
      this.repository.listRiders(partnerId, {})
    ]);
    return { ...partner, managers, riders };
  }

  async createPartner(
    actor: AuthenticatedActor,
    input: FleetPartnerCreateInput
  ): Promise<FleetPartner> {
    this.assertAdminCampus(actor, input.campusId);

    let partnerId: string | undefined;
    for (let attempt = 0; partnerId === undefined; attempt += 1) {
      try {
        partnerId = await this.repository.createPartner(input, generateJoinCode(), actor.userId);
      } catch (error) {
        const { code, message = '' } = postgresError(error);
        if (code === '23505' && message.includes('join_code') && attempt < joinCodeAttempts) {
          continue;
        }
        if (code === '23505') {
          throw conflict('A fleet partner with this name already exists on this campus.');
        }
        if (code === '23503') {
          throw badRequest('Campus was not found.');
        }
        throw error;
      }
    }

    const partner = await this.requirePartner(partnerId);
    await this.audit.record({
      action: 'fleet_partner.created',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      after: { ...partner },
      campusId: partner.campusId,
      entityId: partner.id,
      entityType: 'fleet_partner'
    });
    return partner;
  }

  async updatePartner(
    actor: AuthenticatedActor,
    partnerId: string,
    input: FleetPartnerUpdateInput
  ): Promise<FleetPartner> {
    const before = await this.requirePartnerForAdmin(actor, partnerId);

    try {
      await this.repository.updatePartner(partnerId, input);
    } catch (error) {
      if (postgresError(error).code === '23505') {
        throw conflict('A fleet partner with this name already exists on this campus.');
      }
      throw error;
    }

    if (input.status !== undefined && input.status !== 'active') {
      await this.repository.markFleetRidersUnavailable(partnerId);
    }

    const after = await this.requirePartner(partnerId);
    await this.audit.record({
      action: 'fleet_partner.updated',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      after: { ...after },
      before: { ...before },
      campusId: after.campusId,
      entityId: partnerId,
      entityType: 'fleet_partner'
    });
    return after;
  }

  async rotateJoinCodeAsAdmin(actor: AuthenticatedActor, partnerId: string): Promise<FleetPartner> {
    await this.requirePartnerForAdmin(actor, partnerId);
    return this.rotateJoinCode(actor, partnerId);
  }

  /**
   * Make a user a manager of a fleet by email. A known account is granted at once; an
   * unknown email is sent a Supabase invite that lands on the fleet dashboard and is
   * granted up front, so access is live once the invitee sets a password.
   */
  async addManager(
    actor: AuthenticatedActor,
    partnerId: string,
    input: { email: string; role?: FleetMemberRole }
  ): Promise<FleetMember & { invited: boolean }> {
    const partner = await this.requirePartnerForAdmin(actor, partnerId);
    const email = input.email.trim().toLowerCase();

    let userId = await this.repository.findUserIdByEmail(email);
    let invited = false;
    if (userId === undefined) {
      if (this.auth === undefined) {
        throw badRequest('Supabase auth is not configured.');
      }
      userId = (await this.auth.inviteAdminByEmail(email, 'fleet')).userId;
      await this.repository.ensureProfile(userId, email);
      invited = true;
    }

    try {
      await this.repository.upsertMember(partnerId, userId, input.role ?? 'manager', actor.userId);
    } catch (error) {
      if (postgresError(error).code === '23505') {
        throw conflict('This user already manages this fleet.');
      }
      throw error;
    }

    const member = (await this.repository.listMembers(partnerId)).find(
      (candidate) => candidate.userId === userId
    );
    if (member === undefined) {
      throw new Error('Fleet manager grant did not persist.');
    }

    await this.audit.record({
      action: 'fleet_partner.manager_added',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      after: { ...member },
      campusId: partner.campusId,
      entityId: partnerId,
      entityType: 'fleet_partner',
      metadata: { invited }
    });
    return { ...member, invited };
  }

  async removeManager(
    actor: AuthenticatedActor,
    partnerId: string,
    userId: string
  ): Promise<{ removed: true }> {
    const partner = await this.requirePartnerForAdmin(actor, partnerId);
    if (!(await this.repository.deactivateMember(partnerId, userId))) {
      throw notFound('Active fleet manager was not found.');
    }

    await this.audit.record({
      action: 'fleet_partner.manager_removed',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      campusId: partner.campusId,
      entityId: partnerId,
      entityType: 'fleet_partner',
      metadata: { userId }
    });
    return { removed: true };
  }

  /** Admin override: put a rider into a fleet without the join code. */
  async attachRiderAsAdmin(
    actor: AuthenticatedActor,
    partnerId: string,
    riderId: string
  ): Promise<FleetRider> {
    const partner = await this.requirePartnerForAdmin(actor, partnerId);
    const rider = await this.repository.findRiderById(riderId);
    if (rider?.campusId !== partner.campusId) {
      throw notFound('Rider was not found on this campus.');
    }
    if (rider.fleetPartnerId === partnerId) {
      return this.requireFleetRider(partnerId, riderId);
    }
    if (rider.fleetPartnerId !== null) {
      throw conflict('Rider already belongs to another fleet. Remove it from that fleet first.');
    }

    await this.moveRider(rider, partnerId);
    await this.audit.record({
      action: 'fleet_partner.rider_attached',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      campusId: partner.campusId,
      entityId: riderId,
      entityType: 'rider',
      metadata: { fleetPartnerId: partnerId }
    });
    return this.requireFleetRider(partnerId, riderId);
  }

  async detachRiderAsAdmin(
    actor: AuthenticatedActor,
    partnerId: string,
    riderId: string
  ): Promise<{ removed: true }> {
    const partner = await this.requirePartnerForAdmin(actor, partnerId);
    return this.releaseRider(actor, partner, riderId);
  }

  // ---------------------------------------------------------------------------
  // Fleet manager (/fleet). Access comes from fleet_partner_members, not the JWT role.
  // ---------------------------------------------------------------------------

  listMyFleets(actor: AuthenticatedActor): Promise<FleetMembership[]> {
    return this.repository.listMembershipsForUser(actor.userId);
  }

  async getMyFleet(
    actor: AuthenticatedActor,
    partnerId: string
  ): Promise<FleetPartner & { role: FleetMemberRole }> {
    const { partner, role } = await this.requireFleetAccess(actor, partnerId);
    return { ...partner, role };
  }

  async rotateJoinCodeAsManager(
    actor: AuthenticatedActor,
    partnerId: string
  ): Promise<FleetPartner> {
    await this.requireFleetAccess(actor, partnerId, { requireActive: true });
    return this.rotateJoinCode(actor, partnerId);
  }

  async listFleetRiders(
    actor: AuthenticatedActor,
    partnerId: string,
    filters: FleetRiderListFilters
  ): Promise<FleetRider[]> {
    await this.requireFleetAccess(actor, partnerId);
    return this.repository.listRiders(partnerId, filters);
  }

  async removeRiderAsManager(
    actor: AuthenticatedActor,
    partnerId: string,
    riderId: string
  ): Promise<{ removed: true }> {
    const { partner } = await this.requireFleetAccess(actor, partnerId);
    return this.releaseRider(actor, partner, riderId);
  }

  async listFleetBatches(
    actor: AuthenticatedActor,
    partnerId: string,
    date?: string
  ): Promise<FleetBatch[]> {
    const { partner } = await this.requireFleetAccess(actor, partnerId);
    return this.repository.listBatches(partnerId, partner.campusId, date ?? today());
  }

  async assignBatch(
    actor: AuthenticatedActor,
    partnerId: string,
    batchId: string,
    riderId: string
  ): Promise<FleetBatch> {
    const { partner } = await this.requireFleetAccess(actor, partnerId);

    try {
      await this.repository.assignBatch(partnerId, batchId, riderId, actor.userId);
    } catch (error) {
      throw mapDispatchError(error) ?? error;
    }

    await this.audit.record({
      action: 'fleet_partner.batch_assigned',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      campusId: partner.campusId,
      entityId: batchId,
      entityType: 'delivery_batch',
      metadata: { fleetPartnerId: partnerId, riderId }
    });

    const [batch] = await this.repository.listBatches(
      partnerId,
      partner.campusId,
      today(),
      batchId
    );
    if (batch === undefined) {
      throw notFound('Batch was not found.');
    }
    return batch;
  }

  async getEarnings(
    actor: AuthenticatedActor,
    partnerId: string,
    range: { dateFrom?: string; dateTo?: string }
  ): Promise<FleetEarningsSummary> {
    const { partner } = await this.requireFleetAccess(actor, partnerId);
    return this.buildEarnings(partner, range);
  }

  async getEarningsForAdmin(
    actor: AuthenticatedActor,
    partnerId: string,
    range: { dateFrom?: string; dateTo?: string }
  ): Promise<FleetEarningsSummary> {
    const partner = await this.requirePartnerForAdmin(actor, partnerId);
    return this.buildEarnings(partner, range);
  }

  // ---------------------------------------------------------------------------
  // Rider (/rider/fleet)
  // ---------------------------------------------------------------------------

  async getRiderFleet(actor: AuthenticatedActor): Promise<RiderFleet | null> {
    const rider = await this.requireRiderForActor(actor);
    if (rider.fleetPartnerId === null) {
      return null;
    }
    return (await this.repository.getRiderFleet(rider.fleetPartnerId)) ?? null;
  }

  async joinFleet(actor: AuthenticatedActor, joinCode: string): Promise<RiderFleet> {
    const rider = await this.requireRiderForActor(actor);
    const partnerId = await this.repository.findPartnerIdByJoinCode(normalizeJoinCode(joinCode));
    const partner =
      partnerId === undefined ? undefined : await this.repository.getPartner(partnerId);

    // One message for every miss so a code cannot be probed across campuses.
    if (partner?.campusId !== rider.campusId) {
      throw notFound('Join code was not recognised for your campus.');
    }
    if (partner.status !== 'active') {
      throw forbidden('This fleet is not accepting riders right now.');
    }
    if (rider.fleetPartnerId === partner.id) {
      return this.requireRiderFleet(partner.id);
    }
    if (rider.fleetPartnerId !== null) {
      throw conflict('Leave your current fleet before joining another.');
    }

    await this.moveRider(rider, partner.id);
    await this.audit.record({
      action: 'fleet_partner.rider_joined',
      actorType: 'rider',
      actorUserId: actor.userId,
      campusId: partner.campusId,
      entityId: rider.id,
      entityType: 'rider',
      metadata: { fleetPartnerId: partner.id }
    });
    return this.requireRiderFleet(partner.id);
  }

  async leaveFleet(actor: AuthenticatedActor): Promise<{ left: true }> {
    const rider = await this.requireRiderForActor(actor);
    if (rider.fleetPartnerId === null) {
      throw badRequest('You are not part of a fleet.');
    }

    await this.moveRider(rider, null);
    await this.audit.record({
      action: 'fleet_partner.rider_left',
      actorType: 'rider',
      actorUserId: actor.userId,
      campusId: rider.campusId,
      entityId: rider.id,
      entityType: 'rider',
      metadata: { fleetPartnerId: rider.fleetPartnerId }
    });
    return { left: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async buildEarnings(
    partner: FleetPartner,
    range: { dateFrom?: string; dateTo?: string }
  ): Promise<FleetEarningsSummary> {
    if (
      range.dateFrom !== undefined &&
      range.dateTo !== undefined &&
      range.dateFrom > range.dateTo
    ) {
      throw badRequest('dateFrom must be on or before dateTo.');
    }

    const riders = await this.repository.listRiderEarnings(
      partner.id,
      range.dateFrom,
      range.dateTo
    );
    const totalAmountKobo = riders.reduce((sum, rider) => sum + rider.totalAmountKobo, 0);
    return {
      commissionBps: partner.commissionBps,
      commissionKobo: commissionKobo(totalAmountKobo, partner.commissionBps),
      currency: 'NGN',
      dateFrom: range.dateFrom ?? null,
      dateTo: range.dateTo ?? null,
      deliveredOrderCount: riders.reduce((sum, rider) => sum + rider.deliveredOrderCount, 0),
      fleetPartnerId: partner.id,
      riders,
      settledAmountKobo: riders.reduce((sum, rider) => sum + rider.settledAmountKobo, 0),
      totalAmountKobo
    };
  }

  private async rotateJoinCode(
    actor: AuthenticatedActor,
    partnerId: string
  ): Promise<FleetPartner> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.repository.setJoinCode(partnerId, generateJoinCode());
        break;
      } catch (error) {
        if (postgresError(error).code !== '23505' || attempt >= joinCodeAttempts) {
          throw error;
        }
      }
    }

    const partner = await this.requirePartner(partnerId);
    await this.audit.record({
      action: 'fleet_partner.join_code_rotated',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      campusId: partner.campusId,
      entityId: partnerId,
      entityType: 'fleet_partner'
    });
    return partner;
  }

  private async releaseRider(
    actor: AuthenticatedActor,
    partner: FleetPartner,
    riderId: string
  ): Promise<{ removed: true }> {
    const rider = await this.repository.findRiderById(riderId);
    if (rider?.fleetPartnerId !== partner.id) {
      throw notFound('Rider was not found in this fleet.');
    }

    await this.moveRider(rider, null);
    await this.audit.record({
      action: 'fleet_partner.rider_removed',
      actorType: actorTypeForRole(actor.role),
      actorUserId: actor.userId,
      campusId: partner.campusId,
      entityId: riderId,
      entityType: 'rider',
      metadata: { fleetPartnerId: partner.id }
    });
    return { removed: true };
  }

  private async moveRider(rider: FleetRiderRef, partnerId: string | null): Promise<void> {
    if (!(await this.repository.setRiderFleet(rider.id, partnerId, rider.fleetPartnerId))) {
      throw conflict('Rider fleet membership changed. Refresh and try again.');
    }
  }

  private async requireFleetAccess(
    actor: AuthenticatedActor,
    partnerId: string,
    options: { requireActive?: boolean } = {}
  ): Promise<FleetAccess> {
    const role = await this.repository.findActiveMemberRole(actor.userId, partnerId);
    const partner = role === undefined ? undefined : await this.repository.getPartner(partnerId);
    // Non-members get the same 404 as a missing fleet, so ids cannot be probed.
    if (role === undefined || partner === undefined || partner.status === 'deactivated') {
      throw notFound('Fleet was not found.');
    }
    if (options.requireActive === true && partner.status !== 'active') {
      throw forbidden('Fleet is suspended. Contact Meal Direct.');
    }
    return { partner, role };
  }

  private async requirePartner(partnerId: string): Promise<FleetPartner> {
    const partner = await this.repository.getPartner(partnerId);
    if (partner === undefined) {
      throw notFound('Fleet partner was not found.');
    }
    return partner;
  }

  private async requirePartnerForAdmin(
    actor: AuthenticatedActor,
    partnerId: string
  ): Promise<FleetPartner> {
    const partner = await this.repository.getPartner(partnerId);
    if (partner === undefined || !this.canAdminCampus(actor, partner.campusId)) {
      throw notFound('Fleet partner was not found.');
    }
    return partner;
  }

  private async requireFleetRider(partnerId: string, riderId: string): Promise<FleetRider> {
    const rider = (await this.repository.listRiders(partnerId, {})).find(
      (candidate) => candidate.id === riderId
    );
    if (rider === undefined) {
      throw notFound('Rider was not found in this fleet.');
    }
    return rider;
  }

  private async requireRiderFleet(partnerId: string): Promise<RiderFleet> {
    const fleet = await this.repository.getRiderFleet(partnerId);
    if (fleet === undefined) {
      throw notFound('Fleet was not found.');
    }
    return fleet;
  }

  private async requireRiderForActor(actor: AuthenticatedActor): Promise<FleetRiderRef> {
    const rider = await this.repository.findRiderForUser(actor.userId, actor.riderId);
    if (rider === undefined) {
      throw notFound('Rider profile was not found. Complete rider onboarding first.');
    }
    return rider;
  }

  private canAdminCampus(actor: AuthenticatedActor, campusId: string): boolean {
    if (actor.role === 'super_admin') return true;
    return actor.role === 'campus_admin' && actor.campusId === campusId;
  }

  private assertAdminCampus(actor: AuthenticatedActor, campusId: string): void {
    if (!this.canAdminCampus(actor, campusId)) {
      throw forbidden('Campus scope is not allowed for this admin.');
    }
  }

  /** Campus admins are pinned to their campus; super admins may filter or see all. */
  private optionalCampusFilter(
    actor: AuthenticatedActor,
    requestedCampusId?: string
  ): { campusId?: string } {
    if (actor.role === 'super_admin') {
      return requestedCampusId === undefined ? {} : { campusId: requestedCampusId };
    }
    if (actor.role !== 'campus_admin' || actor.campusId === undefined) {
      throw forbidden('Campus admin campus scope is required.');
    }
    if (requestedCampusId !== undefined && requestedCampusId !== actor.campusId) {
      throw forbidden('Campus scope is not allowed for this admin.');
    }
    return { campusId: actor.campusId };
  }
}
