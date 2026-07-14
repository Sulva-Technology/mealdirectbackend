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
let resetPasswordForEmailMock: ReturnType<typeof vi.fn>;
let resendMock: ReturnType<typeof vi.fn>;
let getUserMock: ReturnType<typeof vi.fn>;
let updateUserByIdMock: ReturnType<typeof vi.fn>;

function envMock(): EnvService {
  return {
    get: vi.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_URL: 'https://project.supabase.co',
        APP_URL_CUSTOMER: 'https://user.example.com',
        APP_URL_VENDOR: 'https://vendor.example.com',
        APP_URL_RIDER: 'https://rider.example.com',
        APP_URL_ADMIN: 'https://admin.example.com'
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
      signInWithPassword: signInWithPasswordMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
      resend: resendMock,
      getUser: getUserMock,
      admin: {
        updateUserById: updateUserByIdMock
      }
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
    resetPasswordForEmailMock = vi.fn().mockResolvedValue({ data: {}, error: null });
    resendMock = vi.fn().mockResolvedValue({ data: {}, error: null });
    getUserMock = vi
      .fn()
      .mockResolvedValue({
        data: { user: { id: userId, email: 'person@example.com' } },
        error: null
      });
    updateUserByIdMock = vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null });
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

  it('lets a rider whose base role was overwritten by an admin grant back into the rider portal', async () => {
    // The account signed up as a rider (user_metadata.meal_direct_role='rider'),
    // then was granted campus_admin, which overwrote app_metadata.meal_direct_role.
    signInWithPasswordMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'old-token',
          expires_in: 3600,
          refresh_token: 'refresh-token'
        },
        user: {
          app_metadata: { campus_id: campusId, meal_direct_role: 'campus_admin' },
          email: 'person@example.com',
          id: userId,
          user_metadata: { meal_direct_role: 'rider' }
        }
      },
      error: null
    });
    refreshSessionMock.mockResolvedValue(
      refreshResponse({ meal_direct_role: 'rider' }, 'rider-token')
    );

    const result = await service.signIn('person@example.com', 'Password123!', ['rider']);

    // The self-service base role is restored from user_metadata without touching
    // the DB grant tables (which have no rider concept).
    expect(grants.findAdminGrantForUser).not.toHaveBeenCalled();
    expect(service.setUserAppMetadata).toHaveBeenCalledWith(userId, {
      meal_direct_role: 'rider'
    });
    expect(result).toMatchObject({
      accessToken: 'rider-token',
      user: { role: 'rider' }
    });
  });

  it('lets a legacy customer whose base role was overwritten by an admin grant back into the customer portal', async () => {
    // Seeded/legacy customer: no meal_direct_role in user_metadata, then granted
    // campus_admin, which wrote app_metadata.meal_direct_role='campus_admin'. The
    // erased default no longer resolves to 'customer' and there is no customer
    // grant table, so the customer portal must fall back to the base identity.
    signInWithPasswordMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'old-token',
          expires_in: 3600,
          refresh_token: 'refresh-token'
        },
        user: {
          app_metadata: { campus_id: campusId, meal_direct_role: 'campus_admin' },
          email: 'person@example.com',
          id: userId,
          user_metadata: {}
        }
      },
      error: null
    });
    refreshSessionMock.mockResolvedValue(
      refreshResponse({ meal_direct_role: 'customer' }, 'customer-token')
    );

    const result = await service.signIn('person@example.com', 'Password123!', ['customer']);

    expect(service.setUserAppMetadata).toHaveBeenCalledWith(userId, {
      meal_direct_role: 'customer'
    });
    expect(result).toMatchObject({
      accessToken: 'customer-token',
      user: { role: 'customer' }
    });
  });

  it('normalizes the email (trim + lowercase) before authenticating', async () => {
    await service.signIn('  Person@Example.COM ', 'Password123!', ['customer']);
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'Password123!'
    });
  });

  it('rejects a valid credential on the wrong portal with a non-credential message', async () => {
    await expect(service.signIn('person@example.com', 'Password123!', ['rider'])).rejects.toThrow(
      'Your account is not permitted to sign in to this portal.'
    );
  });

  it('routes the password reset redirect to the requested portal', async () => {
    await service.requestPasswordReset('person@example.com', 'admin');
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith('person@example.com', {
      redirectTo: 'https://admin.example.com/auth/callback'
    });
  });

  it('defaults the reset redirect to the customer portal', async () => {
    await service.requestPasswordReset('person@example.com');
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith('person@example.com', {
      redirectTo: 'https://user.example.com/auth/callback'
    });
  });

  it('routes the confirmation resend redirect to the requested portal', async () => {
    await service.resendConfirmation('person@example.com', 'vendor');
    expect(resendMock).toHaveBeenCalledWith({
      type: 'signup',
      email: 'person@example.com',
      options: { emailRedirectTo: 'https://vendor.example.com/auth/callback' }
    });
  });

  it('updates the password for the user the recovery token identifies', async () => {
    await service.updatePassword('recovery-token', 'NewPassword123!');
    // Validates the token by resolving the user it belongs to...
    expect(getUserMock).toHaveBeenCalledWith('recovery-token');
    // ...then sets the new password via the service-role admin API.
    expect(updateUserByIdMock).toHaveBeenCalledWith(userId, { password: 'NewPassword123!' });
  });

  it('backfills a missing role from an active grant after a password reset', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: { id: userId, email: 'person@example.com', app_metadata: {}, user_metadata: {} }
      },
      error: null
    });
    vi.mocked(grants.findVendorGrantForUser).mockResolvedValue({ vendorId });

    await service.updatePassword('recovery-token', 'NewPassword123!');

    expect(service.setUserAppMetadata).toHaveBeenCalledWith(userId, {
      meal_direct_role: 'vendor',
      vendor_id: vendorId
    });
  });

  it('does not overwrite an existing role during a password reset', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: 'person@example.com',
          app_metadata: { meal_direct_role: 'campus_admin', campus_id: campusId },
          user_metadata: {}
        }
      },
      error: null
    });

    await service.updatePassword('recovery-token', 'NewPassword123!');

    expect(service.setUserAppMetadata).not.toHaveBeenCalled();
    expect(grants.findAdminGrantForUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired recovery token', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
    await expect(service.updatePassword('bad-token', 'NewPassword123!')).rejects.toThrow(
      /invalid|expired/i
    );
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });
});
