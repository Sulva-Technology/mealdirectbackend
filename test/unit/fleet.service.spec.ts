import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/common/audit/audit.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { SupabaseAuthService } from '../../src/modules/auth/supabase-auth.service.js';
import type { FleetRepository } from '../../src/modules/fleet/fleet.repository.js';
import {
  FleetService,
  commissionKobo,
  generateJoinCode,
  normalizeJoinCode
} from '../../src/modules/fleet/fleet.service.js';
import type {
  FleetBatch,
  FleetMember,
  FleetPartner,
  FleetRiderRef
} from '../../src/modules/fleet/fleet.types.js';

const campusId = '11111111-1111-4111-8111-111111111111';
const otherCampusId = '11111111-1111-4111-8111-111111111199';
const partnerId = 'f1111111-1111-4111-8111-111111111111';
const otherPartnerId = 'f1111111-1111-4111-8111-111111111112';
const managerUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const adminUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const riderUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const riderId = '22222222-2222-4222-8222-222222222222';
const batchId = '44444444-4444-4444-8444-444444444444';

const superAdmin: AuthenticatedActor = { role: 'super_admin', userId: adminUserId };
const campusAdmin: AuthenticatedActor = { campusId, role: 'campus_admin', userId: adminUserId };
const otherCampusAdmin: AuthenticatedActor = {
  campusId: otherCampusId,
  role: 'campus_admin',
  userId: adminUserId
};
// Fleet managers keep their ordinary JWT role; access comes from the membership table.
const manager: AuthenticatedActor = { role: 'customer', userId: managerUserId };
const rider: AuthenticatedActor = { riderId, role: 'rider', userId: riderUserId };

function partner(overrides: Partial<FleetPartner> = {}): FleetPartner {
  return {
    activeManagerCount: 1,
    campusId,
    campusName: 'Venite University',
    canDispatch: true,
    commissionBps: 1500,
    contactEmail: 'ops@swift.example',
    contactName: 'Tunde',
    contactPhone: '+2348012345678',
    createdAt: '2026-10-15T09:00:00.000Z',
    dispatchPriority: 0,
    id: partnerId,
    joinCode: 'SWFT7K2Q',
    name: 'Swift Logistics',
    riderCount: 1,
    status: 'active',
    updatedAt: '2026-10-15T09:00:00.000Z',
    ...overrides
  };
}

function riderRef(overrides: Partial<FleetRiderRef> = {}): FleetRiderRef {
  return {
    campusId,
    fleetPartnerId: null,
    id: riderId,
    userId: riderUserId,
    ...overrides
  };
}

const member: FleetMember = {
  active: true,
  createdAt: '2026-10-15T09:00:00.000Z',
  displayName: 'Tunde',
  email: 'tunde@swift.example',
  fleetPartnerId: partnerId,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: 'manager',
  userId: managerUserId
};

const batch: FleetBatch = {
  assignmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  assignmentStatus: 'assigned',
  batchNumber: 'B-1',
  deliveryEarningsKobo: 15000,
  deliverySlotId: '51111111-1111-4111-8111-111111111111',
  deliverySlotName: 'Lunch',
  deliveryTime: '12:00:00',
  id: batchId,
  orderCount: 2,
  riderDisplayName: 'Ada Rider',
  riderId,
  serviceDate: '2026-10-15',
  status: 'assigned',
  vendorDisplayName: 'Ada Kitchen',
  vendorId: '31111111-1111-4111-8111-111111111111',
  zoneId: '21111111-1111-4111-8111-111111111111',
  zoneName: 'Zone A'
};

function repositoryMock() {
  return {
    assignBatch: vi.fn().mockResolvedValue('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    createPartner: vi.fn().mockResolvedValue(partnerId),
    deactivateMember: vi.fn().mockResolvedValue(true),
    ensureProfile: vi.fn().mockResolvedValue(undefined),
    findActiveMemberRole: vi.fn().mockResolvedValue('manager'),
    findPartnerIdByJoinCode: vi.fn().mockResolvedValue(partnerId),
    findRiderById: vi.fn().mockResolvedValue(riderRef({ fleetPartnerId: partnerId })),
    findRiderForUser: vi.fn().mockResolvedValue(riderRef()),
    findUserIdByEmail: vi.fn().mockResolvedValue(managerUserId),
    getPartner: vi.fn().mockResolvedValue(partner()),
    getRiderFleet: vi.fn().mockResolvedValue({
      contactName: 'Tunde',
      contactPhone: '+2348012345678',
      fleetPartnerId: partnerId,
      name: 'Swift Logistics',
      status: 'active'
    }),
    listBatches: vi.fn().mockResolvedValue([batch]),
    listMembers: vi.fn().mockResolvedValue([member]),
    listMembershipsForUser: vi.fn().mockResolvedValue([]),
    listPartners: vi.fn().mockResolvedValue([partner()]),
    listRiderEarnings: vi.fn().mockResolvedValue([]),
    listRiders: vi.fn().mockResolvedValue([]),
    markFleetRidersUnavailable: vi.fn().mockResolvedValue(undefined),
    setJoinCode: vi.fn().mockResolvedValue(undefined),
    setRiderFleet: vi.fn().mockResolvedValue(true),
    updatePartner: vi.fn().mockResolvedValue(true),
    upsertMember: vi.fn().mockResolvedValue({ created: true })
  };
}

function pgError(code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { code });
}

describe('fleet helpers', () => {
  it('generates readable 8-character join codes without look-alike characters', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it('normalises typed join codes', () => {
    expect(normalizeJoinCode(' swft-7k2q ')).toBe('SWFT7K2Q');
  });

  it('rounds commission down to the kobo', () => {
    expect(commissionKobo(15_000, 1500)).toBe(2250);
    expect(commissionKobo(7_501, 1500)).toBe(1125);
    expect(commissionKobo(7_500, 0)).toBe(0);
  });
});

describe('FleetService', () => {
  let repository: ReturnType<typeof repositoryMock>;
  let audit: { record: ReturnType<typeof vi.fn> };
  let auth: { inviteAdminByEmail: ReturnType<typeof vi.fn> };
  let service: FleetService;

  beforeEach(() => {
    repository = repositoryMock();
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    auth = { inviteAdminByEmail: vi.fn().mockResolvedValue({ userId: managerUserId }) };
    service = new FleetService(
      repository as unknown as FleetRepository,
      audit as unknown as AuditService,
      auth as unknown as SupabaseAuthService
    );
  });

  describe('admin', () => {
    it('pins campus admins to their own campus when listing', async () => {
      await service.listPartners(campusAdmin, {});
      expect(repository.listPartners).toHaveBeenCalledWith({ campusId });

      await expect(
        service.listPartners(campusAdmin, { campusId: otherCampusId })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets super admins list across campuses', async () => {
      await service.listPartners(superAdmin, {});
      expect(repository.listPartners).toHaveBeenCalledWith({});
    });

    it('creates a partner with a generated join code and audits it', async () => {
      const created = await service.createPartner(campusAdmin, { campusId, name: 'Swift' });

      expect(created.id).toBe(partnerId);
      const [, joinCode, createdBy] = repository.createPartner.mock.calls[0] as [
        unknown,
        string,
        string
      ];
      expect(joinCode).toMatch(/^[A-Z0-9]{8}$/);
      expect(createdBy).toBe(adminUserId);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fleet_partner.created', entityId: partnerId })
      );
    });

    it('retries when a generated join code collides', async () => {
      repository.createPartner
        .mockRejectedValueOnce(
          pgError('23505', 'duplicate key value violates "fleet_partners_join_code_unique"')
        )
        .mockResolvedValueOnce(partnerId);

      await service.createPartner(superAdmin, { campusId, name: 'Swift' });
      expect(repository.createPartner).toHaveBeenCalledTimes(2);
    });

    it('reports a duplicate partner name as a conflict', async () => {
      repository.createPartner.mockRejectedValue(
        pgError('23505', 'duplicate key value violates "fleet_partners_campus_name_unique"')
      );

      await expect(
        service.createPartner(superAdmin, { campusId, name: 'Swift' })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to create a partner on another campus', async () => {
      await expect(
        service.createPartner(otherCampusAdmin, { campusId, name: 'Swift' })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.createPartner).not.toHaveBeenCalled();
    });

    it('hides partners on other campuses from campus admins', async () => {
      await expect(service.getPartnerForAdmin(otherCampusAdmin, partnerId)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('takes the fleet riders off shift when a partner is suspended', async () => {
      await service.updatePartner(campusAdmin, partnerId, { status: 'suspended' });

      expect(repository.updatePartner).toHaveBeenCalledWith(partnerId, { status: 'suspended' });
      expect(repository.markFleetRidersUnavailable).toHaveBeenCalledWith(partnerId);
    });

    it('leaves rider shifts alone for term changes', async () => {
      await service.updatePartner(campusAdmin, partnerId, { commissionBps: 2000 });
      expect(repository.markFleetRidersUnavailable).not.toHaveBeenCalled();
    });

    it('grants an existing account as manager without an invite', async () => {
      const result = await service.addManager(campusAdmin, partnerId, {
        email: ' Tunde@Swift.Example '
      });

      expect(repository.findUserIdByEmail).toHaveBeenCalledWith('tunde@swift.example');
      expect(auth.inviteAdminByEmail).not.toHaveBeenCalled();
      expect(repository.upsertMember).toHaveBeenCalledWith(
        partnerId,
        managerUserId,
        'manager',
        adminUserId
      );
      expect(result).toMatchObject({ invited: false, userId: managerUserId });
    });

    it('invites an unknown email to the fleet portal', async () => {
      repository.findUserIdByEmail.mockResolvedValue(undefined);

      const result = await service.addManager(campusAdmin, partnerId, {
        email: 'tunde@swift.example',
        role: 'owner'
      });

      expect(auth.inviteAdminByEmail).toHaveBeenCalledWith('tunde@swift.example', 'fleet');
      expect(repository.ensureProfile).toHaveBeenCalledWith(managerUserId, 'tunde@swift.example');
      expect(repository.upsertMember).toHaveBeenCalledWith(
        partnerId,
        managerUserId,
        'owner',
        adminUserId
      );
      expect(result.invited).toBe(true);
    });

    it('rejects granting an already active manager', async () => {
      repository.upsertMember.mockRejectedValue(pgError('23505'));
      await expect(
        service.addManager(campusAdmin, partnerId, { email: 'tunde@swift.example' })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s removing a manager who is not active', async () => {
      repository.deactivateMember.mockResolvedValue(false);
      await expect(
        service.removeManager(campusAdmin, partnerId, managerUserId)
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('attaches a platform rider on the same campus', async () => {
      repository.findRiderById.mockResolvedValue(riderRef());
      repository.listRiders.mockResolvedValue([
        {
          active: true,
          available: false,
          campusId,
          createdAt: '2026-10-15T09:00:00.000Z',
          displayName: 'Ada Rider',
          id: riderId,
          openAssignmentCount: 0,
          phone: '+2348012345678',
          status: 'verified'
        }
      ]);

      const attached = await service.attachRiderAsAdmin(campusAdmin, partnerId, riderId);

      expect(repository.setRiderFleet).toHaveBeenCalledWith(riderId, partnerId, null);
      expect(attached.id).toBe(riderId);
    });

    it('will not steal a rider from another fleet', async () => {
      repository.findRiderById.mockResolvedValue(riderRef({ fleetPartnerId: otherPartnerId }));
      await expect(
        service.attachRiderAsAdmin(campusAdmin, partnerId, riderId)
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.setRiderFleet).not.toHaveBeenCalled();
    });

    it('will not attach a rider from another campus', async () => {
      repository.findRiderById.mockResolvedValue(riderRef({ campusId: otherCampusId }));
      await expect(
        service.attachRiderAsAdmin(campusAdmin, partnerId, riderId)
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('fleet manager', () => {
    it('returns 404 to non-members so fleet ids cannot be probed', async () => {
      repository.findActiveMemberRole.mockResolvedValue(undefined);
      await expect(service.getMyFleet(manager, partnerId)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(repository.getPartner).not.toHaveBeenCalled();
    });

    it('locks managers out of a deactivated fleet', async () => {
      repository.getPartner.mockResolvedValue(partner({ status: 'deactivated' }));
      await expect(service.listFleetRiders(manager, partnerId, {})).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('keeps a suspended fleet readable but blocks join-code rotation', async () => {
      repository.getPartner.mockResolvedValue(partner({ status: 'suspended' }));

      await expect(service.getMyFleet(manager, partnerId)).resolves.toMatchObject({
        role: 'manager',
        status: 'suspended'
      });
      await expect(service.rotateJoinCodeAsManager(manager, partnerId)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it('lists batches for the fleet campus, defaulting to today', async () => {
      await service.listFleetBatches(manager, partnerId);
      expect(repository.listBatches).toHaveBeenCalledWith(
        partnerId,
        campusId,
        new Date().toISOString().slice(0, 10)
      );
    });

    it('dispatches a batch through the atomic DB function and audits it', async () => {
      const result = await service.assignBatch(manager, partnerId, batchId, riderId);

      expect(repository.assignBatch).toHaveBeenCalledWith(
        partnerId,
        batchId,
        riderId,
        managerUserId
      );
      expect(result.id).toBe(batchId);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet_partner.batch_assigned',
          entityId: batchId,
          metadata: { fleetPartnerId: partnerId, riderId }
        })
      );
    });

    it.each([
      ['FP404', NotFoundException],
      ['FP403', ForbiddenException],
      ['FP409', ConflictException],
      ['FP422', BadRequestException]
    ])('maps dispatch error %s to an HTTP error', async (code, expected) => {
      repository.assignBatch.mockRejectedValue(pgError(code, 'Batch is already in progress.'));
      await expect(
        service.assignBatch(manager, partnerId, batchId, riderId)
      ).rejects.toBeInstanceOf(expected);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('lets unexpected dispatch errors through untouched', async () => {
      const failure = pgError('08006', 'connection lost');
      repository.assignBatch.mockRejectedValue(failure);
      await expect(service.assignBatch(manager, partnerId, batchId, riderId)).rejects.toBe(failure);
    });

    it('only removes riders that belong to the fleet', async () => {
      repository.findRiderById.mockResolvedValue(riderRef({ fleetPartnerId: otherPartnerId }));
      await expect(
        service.removeRiderAsManager(manager, partnerId, riderId)
      ).rejects.toBeInstanceOf(NotFoundException);

      repository.findRiderById.mockResolvedValue(riderRef({ fleetPartnerId: partnerId }));
      await expect(service.removeRiderAsManager(manager, partnerId, riderId)).resolves.toEqual({
        removed: true
      });
      expect(repository.setRiderFleet).toHaveBeenCalledWith(riderId, null, partnerId);
    });

    it('totals earnings and applies the partner commission', async () => {
      repository.listRiderEarnings.mockResolvedValue([
        {
          deliveredOrderCount: 4,
          displayName: 'Ada Rider',
          riderId,
          settledAmountKobo: 15_000,
          totalAmountKobo: 30_000
        },
        {
          deliveredOrderCount: 1,
          displayName: 'Bayo Rider',
          riderId: '22222222-2222-4222-8222-222222222223',
          settledAmountKobo: 0,
          totalAmountKobo: 7_500
        }
      ]);

      const summary = await service.getEarnings(manager, partnerId, {
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31'
      });

      expect(repository.listRiderEarnings).toHaveBeenCalledWith(
        partnerId,
        '2026-10-01',
        '2026-10-31'
      );
      expect(summary).toMatchObject({
        commissionBps: 1500,
        commissionKobo: 5625,
        deliveredOrderCount: 5,
        settledAmountKobo: 15_000,
        totalAmountKobo: 37_500
      });
    });

    it('rejects an inverted earnings range', async () => {
      await expect(
        service.getEarnings(manager, partnerId, { dateFrom: '2026-10-31', dateTo: '2026-10-01' })
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('rider', () => {
    it('joins a fleet on its campus with a typed code', async () => {
      const fleet = await service.joinFleet(rider, 'swft-7k2q');

      expect(repository.findRiderForUser).toHaveBeenCalledWith(riderUserId, riderId);
      expect(repository.findPartnerIdByJoinCode).toHaveBeenCalledWith('SWFT7K2Q');
      expect(repository.setRiderFleet).toHaveBeenCalledWith(riderId, partnerId, null);
      expect(fleet.fleetPartnerId).toBe(partnerId);
    });

    it('treats a code from another campus like an unknown code', async () => {
      repository.getPartner.mockResolvedValue(partner({ campusId: otherCampusId }));
      await expect(service.joinFleet(rider, 'SWFT7K2Q')).rejects.toBeInstanceOf(NotFoundException);

      repository.findPartnerIdByJoinCode.mockResolvedValue(undefined);
      await expect(service.joinFleet(rider, 'NOPE1234')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.setRiderFleet).not.toHaveBeenCalled();
    });

    it('cannot join a suspended fleet', async () => {
      repository.getPartner.mockResolvedValue(partner({ status: 'suspended' }));
      await expect(service.joinFleet(rider, 'SWFT7K2Q')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('must leave its current fleet before joining another', async () => {
      repository.findRiderForUser.mockResolvedValue(riderRef({ fleetPartnerId: otherPartnerId }));
      await expect(service.joinFleet(rider, 'SWFT7K2Q')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejoining its own fleet is a no-op', async () => {
      repository.findRiderForUser.mockResolvedValue(riderRef({ fleetPartnerId: partnerId }));
      await service.joinFleet(rider, 'SWFT7K2Q');
      expect(repository.setRiderFleet).not.toHaveBeenCalled();
    });

    it('reports a lost race on membership as a conflict', async () => {
      repository.setRiderFleet.mockResolvedValue(false);
      await expect(service.joinFleet(rider, 'SWFT7K2Q')).rejects.toBeInstanceOf(ConflictException);
    });

    it('leaves its fleet', async () => {
      repository.findRiderForUser.mockResolvedValue(riderRef({ fleetPartnerId: partnerId }));
      await expect(service.leaveFleet(rider)).resolves.toEqual({ left: true });
      expect(repository.setRiderFleet).toHaveBeenCalledWith(riderId, null, partnerId);
    });

    it('cannot leave when not in a fleet', async () => {
      await expect(service.leaveFleet(rider)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('needs a rider profile', async () => {
      repository.findRiderForUser.mockResolvedValue(undefined);
      await expect(service.getRiderFleet(rider)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows null for a platform rider', async () => {
      await expect(service.getRiderFleet(rider)).resolves.toBeNull();
    });
  });
});
