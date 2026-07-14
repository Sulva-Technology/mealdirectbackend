import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { AdminRepository } from '../../src/modules/admin/admin.repository.js';
import { AdminService } from '../../src/modules/admin/admin.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { SupabaseAuthService } from '../../src/modules/auth/supabase-auth.service.js';
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
let addVendorUserMock: ReturnType<typeof vi.fn>;
let createAdminMembershipMock: ReturnType<typeof vi.fn>;
let setUserAppMetadataMock: ReturnType<typeof vi.fn>;
let getUserDeletionSnapshotMock: ReturnType<typeof vi.fn>;
let purgeUserMock: ReturnType<typeof vi.fn>;
let anonymizeUserMock: ReturnType<typeof vi.fn>;
let deleteAuthUserMock: ReturnType<typeof vi.fn>;
let banAuthUserMock: ReturnType<typeof vi.fn>;

function repositoryMock(): AdminRepository {
  listOrdersMock = vi.fn().mockResolvedValue({ hasMore: false, items: [], limit: 20 });
  return {
    getVendor: vi.fn().mockResolvedValue({
      campusId,
      id: '55555555-5555-4555-8555-555555555555'
    }),
    addVendorUser: addVendorUserMock,
    createAdminMembership: createAdminMembershipMock,
    listOrders: listOrdersMock,
    getUserDeletionSnapshot: getUserDeletionSnapshotMock,
    purgeUser: purgeUserMock,
    anonymizeUser: anonymizeUserMock,
    setUserStatus: vi.fn().mockResolvedValue({ id: 'user-1', accountStatus: 'suspended' })
  } as unknown as AdminRepository;
}

function invitationsMock(): VendorInvitationsRepository {
  createInvitationMock = vi
    .fn<(input: CreateVendorInvitationInput) => Promise<VendorInvitationRecord | undefined>>()
    .mockResolvedValue({
      acceptedAt: null,
      acceptedByUserId: null,
      createdAt: '2026-06-29T09:00:00.000Z',
      createdByAdminId: '33333333-3333-4333-8333-333333333333',
      email: 'owner@example.com',
      expiresAt: '2026-06-30T09:00:00.000Z',
      id: '99999999-9999-4999-8999-999999999999',
      revokedAt: null,
      role: 'staff',
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

function authMock(): SupabaseAuthService {
  setUserAppMetadataMock = vi.fn().mockResolvedValue(undefined);
  deleteAuthUserMock = vi.fn().mockResolvedValue(undefined);
  banAuthUserMock = vi.fn().mockResolvedValue(undefined);
  return {
    setUserAppMetadata: setUserAppMetadataMock,
    deleteAuthUser: deleteAuthUserMock,
    banAuthUser: banAuthUserMock
  } as unknown as SupabaseAuthService;
}

describe('AdminService', () => {
  let repository: AdminRepository;
  let invitations: VendorInvitationsRepository;
  let auth: SupabaseAuthService;
  let service: AdminService;
  let campusAdmin: AuthenticatedActor;
  let superAdmin: AuthenticatedActor;

  beforeEach(() => {
    addVendorUserMock = vi.fn().mockResolvedValue({
      active: true,
      id: '77777777-7777-4777-8777-777777777777',
      role: 'owner',
      userId: '33333333-3333-4333-8333-333333333333',
      vendorId: '55555555-5555-4555-8555-555555555555'
    });
    createAdminMembershipMock = vi.fn().mockResolvedValue({
      active: true,
      campusId,
      id: '88888888-8888-4888-8888-888888888888',
      role: 'campus_admin',
      userId: '33333333-3333-4333-8333-333333333333'
    });
    getUserDeletionSnapshotMock = vi.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      email: 'victim@example.com',
      displayName: 'Victim',
      orderCount: 0,
      isVendor: false,
      isRider: false,
      isAdmin: false,
      hasHistory: false
    });
    purgeUserMock = vi.fn().mockResolvedValue(true);
    anonymizeUserMock = vi.fn().mockResolvedValue(true);
    repository = repositoryMock();
    invitations = invitationsMock();
    auth = authMock();
    service = new AdminService(repository, envMock(), invitations, auth);
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
        role: 'owner',
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
      role: 'owner',
      vendorId: '55555555-5555-4555-8555-555555555555'
    });
    expect(invitationInput?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('syncs campus admin grants into Supabase app metadata', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';

    await expect(
      service.createAdminMembership(superAdmin, { campusId, role: 'campus_admin', userId })
    ).resolves.toMatchObject({
      active: true,
      campusId,
      role: 'campus_admin',
      userId
    });

    expect(createAdminMembershipMock).toHaveBeenCalledWith(
      { campusId, role: 'campus_admin', userId },
      superAdmin.userId
    );
    expect(setUserAppMetadataMock).toHaveBeenCalledWith(userId, {
      campus_id: campusId,
      meal_direct_role: 'campus_admin'
    });
  });

  it('syncs vendor user grants into Supabase app metadata', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';
    const vendorId = '55555555-5555-4555-8555-555555555555';

    await expect(
      service.addVendorUser(campusAdmin, vendorId, { role: 'owner', userId })
    ).resolves.toMatchObject({
      active: true,
      role: 'owner',
      userId,
      vendorId
    });

    expect(addVendorUserMock).toHaveBeenCalledWith(vendorId, userId, 'owner');
    expect(setUserAppMetadataMock).toHaveBeenCalledWith(userId, {
      meal_direct_role: 'vendor',
      vendor_id: vendorId
    });
  });

  it('hard-deletes a pristine user (purge then auth delete)', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';

    await expect(service.deleteUser(superAdmin, userId)).resolves.toMatchObject({
      userId,
      outcome: 'deleted'
    });

    expect(getUserDeletionSnapshotMock).toHaveBeenCalledWith(userId);
    expect(purgeUserMock).toHaveBeenCalledWith(userId);
    expect(deleteAuthUserMock).toHaveBeenCalledWith(userId);
    expect(anonymizeUserMock).not.toHaveBeenCalled();
    expect(banAuthUserMock).not.toHaveBeenCalled();
  });

  it('anonymizes + bans a user with append-only history instead of hard-deleting', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';
    getUserDeletionSnapshotMock.mockResolvedValue({
      id: userId,
      email: 'victim@example.com',
      displayName: 'Victim',
      orderCount: 3,
      isVendor: false,
      isRider: false,
      isAdmin: false,
      hasHistory: true
    });

    await expect(service.deleteUser(superAdmin, userId)).resolves.toMatchObject({
      userId,
      outcome: 'anonymized'
    });

    expect(anonymizeUserMock).toHaveBeenCalledWith(userId);
    expect(banAuthUserMock).toHaveBeenCalledWith(userId);
    expect(purgeUserMock).not.toHaveBeenCalled();
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
  });

  it('rejects a campus admin from deleting a user', async () => {
    await expect(
      service.deleteUser(campusAdmin, '33333333-3333-4333-8333-333333333333')
    ).rejects.toMatchObject({ status: 403 });
    expect(purgeUserMock).not.toHaveBeenCalled();
  });

  it('rejects an admin deleting their own account', async () => {
    await expect(service.deleteUser(superAdmin, superAdmin.userId)).rejects.toMatchObject({
      status: 400
    });
    expect(purgeUserMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the user has no profile', async () => {
    getUserDeletionSnapshotMock.mockResolvedValue(undefined);
    await expect(
      service.deleteUser(superAdmin, '33333333-3333-4333-8333-333333333333')
    ).rejects.toMatchObject({ status: 404 });
    expect(purgeUserMock).not.toHaveBeenCalled();
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
  });
});
