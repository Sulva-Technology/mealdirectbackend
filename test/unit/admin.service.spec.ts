import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminRepository } from '../../src/modules/admin/admin.repository.js';
import { AdminService } from '../../src/modules/admin/admin.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';

const campusId = '11111111-1111-4111-8111-111111111111';
const otherCampusId = '22222222-2222-4222-8222-222222222222';
let listOrdersMock: ReturnType<typeof vi.fn>;

function repositoryMock(): AdminRepository {
  listOrdersMock = vi.fn().mockResolvedValue({ hasMore: false, items: [], limit: 20 });
  return {
    listOrders: listOrdersMock,
    setUserStatus: vi.fn().mockResolvedValue({ id: 'user-1', accountStatus: 'suspended' })
  } as unknown as AdminRepository;
}

describe('AdminService', () => {
  let repository: AdminRepository;
  let service: AdminService;
  let campusAdmin: AuthenticatedActor;
  let superAdmin: AuthenticatedActor;

  beforeEach(() => {
    repository = repositoryMock();
    service = new AdminService(repository);
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

    expect(listOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ campusId }),
      campusId
    );
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
});
