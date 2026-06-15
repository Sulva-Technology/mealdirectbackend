import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CampusDirectoryRepository } from './campus-directory.repository.js';
import type {
  CampusDirectoryRepositoryContract,
  CampusLocationRecord,
  CampusRecord,
  CampusZoneRecord,
  CreateCampusInput,
  CreateDeliverySlotInput,
  CreateLocationInput,
  CreateZoneInput,
  DeliverySlotRecord,
  UpdateCampusInput,
  UpdateDeliverySlotInput,
  UpdateLocationInput,
  UpdateZoneInput
} from './campus-directory.types.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCodes.FORBIDDEN,
    message
  });
}

function notFound(entity: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${entity} was not found.`
  });
}

@Injectable()
export class CampusDirectoryService {
  constructor(
    @Inject(CampusDirectoryRepository)
    private readonly repository: CampusDirectoryRepositoryContract
  ) {}

  listPublicCampuses(): Promise<CampusRecord[]> {
    return this.repository.listPublicCampuses();
  }

  listPublicLocations(campusId: string): Promise<CampusLocationRecord[]> {
    return this.repository.listPublicLocations(campusId);
  }

  listPublicDeliverySlots(campusId: string, serviceDate?: string): Promise<DeliverySlotRecord[]> {
    return this.repository.listPublicDeliverySlots(campusId, serviceDate);
  }

  async listAdminCampuses(actor: AuthenticatedActor): Promise<CampusRecord[]> {
    if (actor.role === 'super_admin') {
      return this.repository.listAdminCampuses();
    }
    if (actor.role === 'campus_admin' && actor.campusId !== undefined) {
      return this.repository.listAdminCampuses(actor.campusId);
    }
    throw forbidden('Admin access is required.');
  }

  async createCampus(actor: AuthenticatedActor, input: CreateCampusInput): Promise<CampusRecord> {
    if (actor.role !== 'super_admin') {
      throw forbidden('Only super admins can create campuses.');
    }
    return this.repository.createCampus(input);
  }

  async updateCampus(
    actor: AuthenticatedActor,
    campusId: string,
    input: UpdateCampusInput
  ): Promise<CampusRecord> {
    this.assertCanManageCampus(actor, campusId);
    const campus = await this.repository.updateCampus(campusId, input);
    if (campus === undefined) throw notFound('Campus');
    return campus;
  }

  async listAdminZones(actor: AuthenticatedActor, campusId: string): Promise<CampusZoneRecord[]> {
    this.assertCanManageCampus(actor, campusId);
    return this.repository.listAdminZones(campusId);
  }

  async createZone(
    actor: AuthenticatedActor,
    campusId: string,
    input: CreateZoneInput
  ): Promise<CampusZoneRecord> {
    this.assertCanManageCampus(actor, campusId);
    const zone = await this.repository.createZone(campusId, input);
    if (zone === undefined) throw notFound('Campus');
    return zone;
  }

  async updateZone(
    actor: AuthenticatedActor,
    zoneId: string,
    input: UpdateZoneInput
  ): Promise<CampusZoneRecord> {
    const zone = await this.repository.updateZone(zoneId, input, this.scopedCampusId(actor));
    if (zone === undefined) throw notFound('Zone');
    return zone;
  }

  async listAdminLocations(
    actor: AuthenticatedActor,
    campusId: string
  ): Promise<CampusLocationRecord[]> {
    this.assertCanManageCampus(actor, campusId);
    return this.repository.listAdminLocations(campusId);
  }

  async createLocation(
    actor: AuthenticatedActor,
    campusId: string,
    input: CreateLocationInput
  ): Promise<CampusLocationRecord> {
    this.assertCanManageCampus(actor, campusId);
    const location = await this.repository.createLocation(campusId, input);
    if (location === undefined) throw notFound('Zone');
    return location;
  }

  async updateLocation(
    actor: AuthenticatedActor,
    locationId: string,
    input: UpdateLocationInput
  ): Promise<CampusLocationRecord> {
    const location = await this.repository.updateLocation(
      locationId,
      input,
      this.scopedCampusId(actor)
    );
    if (location === undefined) throw notFound('Location');
    return location;
  }

  async listAdminDeliverySlots(
    actor: AuthenticatedActor,
    campusId: string
  ): Promise<DeliverySlotRecord[]> {
    this.assertCanManageCampus(actor, campusId);
    return this.repository.listAdminDeliverySlots(campusId);
  }

  async createDeliverySlot(
    actor: AuthenticatedActor,
    campusId: string,
    input: CreateDeliverySlotInput
  ): Promise<DeliverySlotRecord> {
    this.assertCanManageCampus(actor, campusId);
    const slot = await this.repository.createDeliverySlot(campusId, input);
    if (slot === undefined) throw notFound('Campus');
    return slot;
  }

  async updateDeliverySlot(
    actor: AuthenticatedActor,
    slotId: string,
    input: UpdateDeliverySlotInput
  ): Promise<DeliverySlotRecord> {
    const slot = await this.repository.updateDeliverySlot(
      slotId,
      input,
      this.scopedCampusId(actor)
    );
    if (slot === undefined) throw notFound('Delivery slot');
    return slot;
  }

  private scopedCampusId(actor: AuthenticatedActor): string | undefined {
    if (actor.role === 'super_admin') return undefined;
    if (actor.role === 'campus_admin' && actor.campusId !== undefined) return actor.campusId;
    throw forbidden('Admin access is required.');
  }

  private assertCanManageCampus(actor: AuthenticatedActor, campusId: string): void {
    if (actor.role === 'super_admin') return;
    if (actor.role === 'campus_admin' && actor.campusId === campusId) return;
    throw forbidden('You cannot manage this campus.');
  }
}
