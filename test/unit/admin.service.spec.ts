import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { AdminRepository } from '../../src/modules/admin/admin.repository.js';
import { AdminService } from '../../src/modules/admin/admin.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type {
  CreateVendorInvitationInput,
  VendorInvitationRecord,
  VendorInvitationsRepository
} from '../../src/modules/auth/vendor-invitations.repository.js';
import type { EnvService } from '../../src/config/env.service.js';

const campusId = '11111111-1111-4111-8111-111111111111';
const otherCampusId = '22222222-2222-4222-8222-222222222222';
let listOrdersMock: ReturnType<typeof vi.fn>;
let createInvitationMock: Mock<
  (input: CreateVendorInvitationInput) => Promise<VendorInvitationRecord | undefined>
>;

function repositoryMock(): AdminRepository {
  listOrdersMock = vi.fn().mockResolvedValue({ hasMore: false, items: [], limit: 20 });
  return {
    getVendor: vi.fn().mockResolvedValue({
      campusId,
      id: '55555555-5555-4555-8555-555555555555'
    }),
    listOrders: listOrdersMock,
    setUserStatus: vi.fn().mockResolvedValue({ id: 'user-1', accountStatus: 'suspended' })
  } as unknown as AdminRepository;
}

function invitationsMock(): VendorInvitationsRepository {
  createInvitationMock = vi.fn<
    (input: CreateVendorInvitationInput) => Promise<VendorInvitationRecord | undefined>
  >().mockResolvedValue({
    acceptedAt: null,
    acceptedByUserId: null,
    createdAt: '2026-06-29T09:00:00.000Z',
    createdByAdminId: '33333333-3333-4333-8333-333333333333',
    email: 'owner@example.com',
    expiresAt: '2026-06-30T09:00:00.000Z',
    id: '99999999-9999-4999-8999-999999999999',
    revokedAt: null,
    vendorId: '55555555-5555-4555-8555-555555555555'
  });
  return {
    create: createInvitationMock
  } as unknown as VendorInvitationsRepository;
}

function envMock(): EnvService {
  return {
    get: vi.fn().mockReturnValue('https://vendor.mealdirectly.com')
  } as unknown as EnvService;
}

describe('AdminService', () => {
  let repository: AdminRepository;
  let invitations: VendorInvitationsRepository;
  let service: AdminService;
  let campusAdmin: AuthenticatedActor;
  let superAdmin: AuthenticatedActor;

  beforeEach(() => {
    repository = repositoryMock();
    invitations = invitationsMock();
    service = new AdminService(repository, envMock(), invitations);
    campusAdmin = {
      campusId,
      role: 'campus_admin',
      userId: '33333333-3333-4333-8333-333333333333'
    };
    superAdmin = {
      role: 'super_admin',
      userId: '44444444-4444-4444-8444-444444444444'
    };
  });

  it('pins campus admins to their own campus scope', async () => {
    await service.listOrders(campusAdmin, { campusId, limit: 20 });

    expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ campusId }), campusId);
  });

  it('rejects cross-campus queries from campus admins', () => {
    expect(() => service.listOrders(campusAdmin, { campusId: otherCampusId })).toThrow(
      'Campus scope is not allowed for this admin.'
    );
  });

  it('allows super admins to manage user status', async () => {
    await expect(service.setUserStatus(superAdmin, 'user-1', 'suspended')).resolves.toMatchObject({
      accountStatus: 'suspended'
    });
  });

  it('rejects campus admins from user status changes', async () => {
    await expect(service.setUserStatus(campusAdmin, 'user-1', 'suspended')).rejects.toMatchObject({
      response: {
        code: 'FORBIDDEN'
      },
      status: 403
    });
  });

  it('creates vendor invite links with the creating admin recorded', async () => {
    await expect(
      service.createVendorInvitation(campusAdmin, '55555555-5555-4555-8555-555555555555', {
        email: ' Owner@Example.com ',
        expiresInHours: 12
      })
    ).resolves.toMatchObject({
      createdByAdminId: campusAdmin.userId,
      email: 'owner@example.com',
      vendorId: '55555555-5555-4555-8555-555555555555'
    });

    const invitationInput = createInvitationMock.mock.calls[0]?.[0];
    expect(invitationInput).toMatchObject({
      actorUserId: campusAdmin.userId,
      email: 'owner@example.com',
      expiresInHours: 12,
      vendorId: '55555555-5555-4555-8555-555555555555'
    });
    expect(invitationInput?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
