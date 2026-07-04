import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import type { EnvService } from '../../src/config/env.service.js';
import type { AuthRoleGrantsRepository } from '../../src/modules/auth/auth-role-grants.repository.js';
import { SupabaseAuthService } from '../../src/modules/auth/supabase-auth.service.js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn()
}));

const campusId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const vendorId = '33333333-3333-4333-8333-333333333333';

let signInWithPasswordMock: ReturnType<typeof vi.fn>;
let refreshSessionMock: ReturnType<typeof vi.fn>;

function envMock(): EnvService {
  return {
    get: vi.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_URL: 'https://project.supabase.co'
      };
      return values[key];
    })
  } as unknown as EnvService;
}

function grantsMock(): AuthRoleGrantsRepository {
  return {
    findAdminGrantForUser: vi.fn().mockResolvedValue(undefined),
    findVendorGrantForUser: vi.fn().mockResolvedValue(undefined)
  } as unknown as AuthRoleGrantsRepository;
}

function authClient() {
  return {
    auth: {
      refreshSession: refreshSessionMock,
      signInWithPassword: signInWithPasswordMock
    }
  };
}

function signInResponse() {
  return {
    data: {
      session: {
        access_token: 'old-token',
        expires_in: 3600,
        refresh_token: 'refresh-token'
      },
      user: {
        app_metadata: {},
        email: 'person@example.com',
        id: userId,
        user_metadata: {}
      }
    },
    error: null
  };
}

function refreshResponse(appMetadata: Record<string, unknown>, accessToken: string) {
  return {
    data: {
      session: {
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: 'new-refresh-token'
      },
      user: {
        app_metadata: appMetadata,
        email: 'person@example.com',
        id: userId,
        user_metadata: {}
      }
    },
    error: null
  };
}

describe('SupabaseAuthService', () => {
  let grants: AuthRoleGrantsRepository;
  let service: SupabaseAuthService;

  beforeEach(() => {
    signInWithPasswordMock = vi.fn().mockResolvedValue(signInResponse());
    refreshSessionMock = vi.fn();
    vi.mocked(createClient).mockReturnValue(authClient() as never);
    grants = grantsMock();
    service = new SupabaseAuthService(envMock(), undefined, grants);
    vi.spyOn(service, 'setUserAppMetadata').mockResolvedValue(undefined);
  });

  it('repairs DB-only campus admin grants during admin login', async () => {
    vi.mocked(grants.findAdminGrantForUser).mockResolvedValue({
      campusId,
      role: 'campus_admin'
    });
    refreshSessionMock.mockResolvedValue(
      refreshResponse({ campus_id: campusId, meal_direct_role: 'campus_admin' }, 'admin-token')
    );

    const result = await service.signIn('person@example.com', 'Password123!', [
      'campus_admin',
      'super_admin'
    ]);

    expect(grants.findAdminGrantForUser).toHaveBeenCalledWith(userId);
    expect(service.setUserAppMetadata).toHaveBeenCalledWith(userId, {
      campus_id: campusId,
      meal_direct_role: 'campus_admin'
    });
    expect(refreshSessionMock).toHaveBeenCalledWith({ refresh_token: 'refresh-token' });
    expect(result).toMatchObject({
      accessToken: 'admin-token',
      refreshToken: 'new-refresh-token',
      user: { role: 'campus_admin' }
    });
  });

  it('repairs DB-only vendor grants during vendor login', async () => {
    vi.mocked(grants.findVendorGrantForUser).mockResolvedValue({ vendorId });
    refreshSessionMock.mockResolvedValue(
      refreshResponse({ meal_direct_role: 'vendor', vendor_id: vendorId }, 'vendor-token')
    );

    const result = await service.signIn('person@example.com', 'Password123!', ['vendor']);

    expect(grants.findVendorGrantForUser).toHaveBeenCalledWith(userId);
    expect(service.setUserAppMetadata).toHaveBeenCalledWith(userId, {
      meal_direct_role: 'vendor',
      vendor_id: vendorId
    });
    expect(result).toMatchObject({
      accessToken: 'vendor-token',
      refreshToken: 'new-refresh-token',
      user: { role: 'vendor' }
    });
  });
});
