import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import type { ActorRole } from '../../domain/authorization.js';
import { AuthRoleGrantsRepository } from './auth-role-grants.repository.js';
import type { AuthPortal, AuthTokensResponseDto } from './dto/auth.dto.js';
import { VendorInvitationsRepository } from './vendor-invitations.repository.js';

type MealDirectUserMetadata = {
  meal_direct_role?: unknown;
  role?: unknown;
};

type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type SupabaseUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

type ResolvedGrant = {
  role: ActorRole;
  metadata: Record<string, unknown>;
};

@Injectable()
export class SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthService.name);

  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Optional()
    @Inject(VendorInvitationsRepository)
    private readonly invitations?: VendorInvitationsRepository,
    @Optional()
    @Inject(AuthRoleGrantsRepository)
    private readonly roleGrants?: AuthRoleGrantsRepository
  ) {}

  private getAdminClient() {
    const serviceRoleKey = this.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (serviceRoleKey === undefined) {
      return undefined;
    }
    return createClient(this.env.get('SUPABASE_URL'), serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  /**
   * Merge keys into a user's app_metadata using the service_role key. app_metadata
   * is the authoritative, non-user-editable store for role and tenancy ids
   * (meal_direct_role, vendor_id, rider_id). Requires SUPABASE_SERVICE_ROLE_KEY.
   * The change only appears in the user's JWT after the session is refreshed.
   */
  async setUserAppMetadata(userId: string, metadata: Record<string, unknown>): Promise<void> {
    const admin = this.getAdminClient();
    if (admin === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message:
          'Server is not configured to update user roles (SUPABASE_SERVICE_ROLE_KEY missing).'
      });
    }

    const existing = await admin.auth.admin.getUserById(userId);
    if (existing.error) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: existing.error.message
      });
    }

    const merged = { ...(existing.data.user?.app_metadata ?? {}), ...metadata };
    const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: merged });
    if (error) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }
  }

  /**
   * Permanently delete a Supabase Auth user via the service_role admin API. Callers must
   * first remove the public.profiles row (profiles.id references auth.users on delete
   * restrict), otherwise the delete is rejected. Idempotent: a missing user is treated as
   * already deleted.
   */
  async deleteAuthUser(userId: string): Promise<void> {
    const admin = this.getAdminClient();
    if (admin === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message:
          'Server is not configured to delete users (SUPABASE_SERVICE_ROLE_KEY missing).'
      });
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && !/not found|does not exist/i.test(error.message)) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }
  }

  /**
   * Ban a Supabase Auth user indefinitely so they can no longer sign in. Used when a user
   * has append-only history and cannot be hard-deleted; combined with a PII scrub this makes
   * the account effectively removed. Requires the service_role key.
   */
  async banAuthUser(userId: string): Promise<void> {
    const admin = this.getAdminClient();
    if (admin === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'Server is not configured to ban users (SUPABASE_SERVICE_ROLE_KEY missing).'
      });
    }

    // 876000h ~= 100 years: an effectively permanent ban.
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
    if (error) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }
  }

  /**
   * Public base URL of the web app that the given role signs in to. Confirmation
   * and password-reset emails must redirect back to the matching front-end.
   */
  private appBaseUrlForRole(role: string): string {
    switch (role) {
      case 'vendor':
        return this.env.get('APP_URL_VENDOR');
      case 'rider':
        return this.env.get('APP_URL_RIDER');
      case 'admin':
      case 'super_admin':
      case 'campus_admin':
        return this.env.get('APP_URL_ADMIN');
      default:
        return this.env.get('APP_URL_CUSTOMER');
    }
  }

  /** Supabase auth redirect target (the front-end route that handles the email link). */
  private authRedirectUrl(role: string): string {
    return `${this.appBaseUrlForRole(role)}/auth/callback`;
  }

  private getClient(accessToken?: string) {
    const supabaseUrl = this.env.get('SUPABASE_URL');
    const supabaseAnonKey = this.env.get('SUPABASE_ANON_KEY');
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      ...(accessToken
        ? {
            global: {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }
          }
        : {})
    });
  }

  async signUp(
    email: string,
    password: string,
    role: string,
    fullName?: string,
    redirectTo?: string
  ): Promise<AuthTokensResponseDto> {
    const { data, error } = await this.getClient().auth.signUp({
      email,
      password,
      options: {
        // Honor a caller-supplied redirect (e.g. the front-end's own callback),
        // falling back to the role's default app. Supabase only follows
        // allow-listed URLs, so an unknown value safely degrades to site_url.
        emailRedirectTo: redirectTo ?? this.authRedirectUrl(role),
        data: {
          meal_direct_role: role,
          ...(fullName ? { full_name: fullName } : {})
        }
      }
    });

    if (error) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }

    const user = data.user;
    if (!user) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'Failed to create user.'
      });
    }

    // Promote the role into app_metadata (authoritative, non-user-editable).
    // Best-effort: if the service_role key is not configured the role still lives
    // in user_metadata, which the JWT verifier honors transitionally.
    if (this.env.get('SUPABASE_SERVICE_ROLE_KEY') !== undefined) {
      try {
        await this.setUserAppMetadata(user.id, { meal_direct_role: role });
      } catch (error) {
        this.logger.error(
          `Failed to set app_metadata.meal_direct_role for ${user.id}`,
          error instanceof Error ? error.stack : String(error)
        );
      }
    }

    const appMetadata = (user.app_metadata ?? {}) as MealDirectUserMetadata;
    const userMetadata = (user.user_metadata ?? {}) as MealDirectUserMetadata;
    const rawRole =
      appMetadata.meal_direct_role ?? appMetadata.role ?? userMetadata.meal_direct_role;
    const resolvedRole = typeof rawRole === 'string' ? rawRole : role;

    const response: AuthTokensResponseDto = {
      user: {
        id: user.id,
        email: user.email ?? '',
        role: resolvedRole
      }
    };

    if (data.session) {
      response.accessToken = data.session.access_token;
      response.refreshToken = data.session.refresh_token;
      response.expiresIn = data.session.expires_in;
    } else {
      response.message = 'Registration successful. Please check your email for verification.';
    }

    return response;
  }

  async acceptVendorInvite(input: {
    email: string;
    password: string;
    fullName?: string;
    redirectTo?: string;
    token: string;
  }): Promise<AuthTokensResponseDto> {
    if (this.invitations === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'Vendor invitations are not configured.'
      });
    }

    const email = input.email.trim().toLowerCase();
    const tokenHash = hashInviteToken(input.token);
    const invite = await this.invitations.findOpenByToken({ email, tokenHash });
    if (invite === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'Vendor invitation is invalid or expired.'
      });
    }

    const { data, error } = await this.getClient().auth.signUp({
      email,
      password: input.password,
      options: {
        emailRedirectTo: input.redirectTo ?? this.authRedirectUrl('vendor'),
        data: {
          meal_direct_role: 'vendor',
          ...(input.fullName ? { full_name: input.fullName } : {})
        }
      }
    });

    if (error) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }

    const user = data.user;
    if (!user) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'Failed to create user.'
      });
    }

    const accepted = await this.invitations.accept({
      email,
      tokenHash,
      userId: user.id
    });
    if (accepted === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'Vendor invitation is invalid or expired.'
      });
    }

    await this.setUserAppMetadata(user.id, {
      meal_direct_role: 'vendor',
      vendor_id: accepted.vendorId
    });

    const response: AuthTokensResponseDto = {
      user: {
        id: user.id,
        email: user.email ?? email,
        role: 'vendor'
      }
    };

    if (data.session) {
      response.accessToken = data.session.access_token;
      response.refreshToken = data.session.refresh_token;
      response.expiresIn = data.session.expires_in;
    } else {
      response.message = 'Registration successful. Please check your email for verification.';
    }

    return response;
  }

  async signIn(
    email: string,
    password: string,
    allowedRoles: string[]
  ): Promise<AuthTokensResponseDto> {
    // Normalize the email the way signup stores it so copy-paste whitespace/case is never
    // the cause of a failed sign-in.
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await this.getClient().auth.signInWithPassword({
      email: normalizedEmail,
      password
    });

    if (error) {
      // Log the underlying Supabase reason server-side (distinguishes "no such user" vs
      // "bad password" vs "email not confirmed") without leaking it to the client.
      this.logger.warn(
        `Sign-in failed for ${normalizedEmail} (portals: ${allowedRoles.join(',')}): ${error.message}`
      );
      throw new UnauthorizedException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }

    if (!data.session) {
      throw new UnauthorizedException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'No active session was returned.'
      });
    }

    let session: SupabaseSession = data.session;
    let user: SupabaseUser = data.user;
    let role = this.resolveUserRole(user);

    if (!allowedRoles.includes(role)) {
      const grant = await this.resolveGrantForLogin(user.id, allowedRoles);
      if (grant === undefined) {
        // Credentials were valid; the account simply is not permitted on this portal.
        // Distinct from the pre-auth "Invalid login credentials" above.
        throw new ForbiddenException({
          code: ErrorCodes.AUTH_FAILED,
          message: 'Your account is not permitted to sign in to this portal.'
        });
      }

      await this.setUserAppMetadata(user.id, grant.metadata);
      const refreshed = await this.refreshSessionAfterMetadataSync(session.refresh_token);
      session = refreshed.session;
      user = refreshed.user;
      role = this.resolveUserRole(user);
      if (!allowedRoles.includes(role)) {
        role = grant.role;
      }
    }

    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
      user: {
        id: user.id,
        email: user.email ?? '',
        role
      }
    };
  }

  private resolveUserRole(user: {
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  }): ActorRole {
    const appMetadata = (user.app_metadata ?? {}) as MealDirectUserMetadata;
    const userMetadata = (user.user_metadata ?? {}) as MealDirectUserMetadata;
    const rawRole =
      appMetadata.meal_direct_role ?? appMetadata.role ?? userMetadata.meal_direct_role;
    return typeof rawRole === 'string' ? (rawRole as ActorRole) : 'customer';
  }

  private async resolveGrantForLogin(
    userId: string,
    allowedRoles: string[]
  ): Promise<ResolvedGrant | undefined> {
    if (this.roleGrants === undefined) {
      return undefined;
    }

    if (allowedRoles.includes('super_admin') || allowedRoles.includes('campus_admin')) {
      const grant = await this.roleGrants.findAdminGrantForUser(userId);
      if (grant !== undefined) {
        if (grant.role === 'super_admin' && allowedRoles.includes('super_admin')) {
          return {
            metadata: {
              campus_id: null,
              meal_direct_role: 'super_admin'
            },
            role: 'super_admin'
          };
        }
        if (allowedRoles.includes('campus_admin')) {
          return {
            metadata: {
              campus_id: grant.campusId,
              meal_direct_role: 'campus_admin'
            },
            role: 'campus_admin'
          };
        }
      }
    }

    if (allowedRoles.includes('vendor')) {
      const grant = await this.roleGrants.findVendorGrantForUser(userId);
      if (grant !== undefined) {
        return {
          metadata: {
            meal_direct_role: 'vendor',
            vendor_id: grant.vendorId
          },
          role: 'vendor'
        };
      }
    }

    return undefined;
  }

  private async refreshSessionAfterMetadataSync(
    refreshToken: string
  ): Promise<{ session: SupabaseSession; user: SupabaseUser }> {
    const { data, error } = await this.getClient().auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      throw new UnauthorizedException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }

    if (!data.session) {
      throw new UnauthorizedException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'No active session was returned.'
      });
    }

    return {
      session: data.session,
      user: data.user ?? data.session.user
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokensResponseDto> {
    const { data, error } = await this.getClient().auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      throw new UnauthorizedException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }

    if (!data.session) {
      throw new UnauthorizedException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'No active session was returned.'
      });
    }

    const user = data.user ?? data.session.user;
    const appMetadata = (user.app_metadata ?? {}) as MealDirectUserMetadata;
    const userMetadata = (user.user_metadata ?? {}) as MealDirectUserMetadata;
    const rawRole =
      appMetadata.meal_direct_role ?? appMetadata.role ?? userMetadata.meal_direct_role;
    const role = typeof rawRole === 'string' ? rawRole : 'customer';

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
      user: {
        id: user.id,
        email: user.email ?? '',
        role
      }
    };
  }

  async requestPasswordReset(email: string, portal: AuthPortal = 'customer'): Promise<void> {
    // Swallow provider errors so the response never reveals whether an account exists.
    try {
      await this.getClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: this.authRedirectUrl(portal)
      });
    } catch {
      // intentionally ignored to prevent user enumeration
    }
  }

  async resendConfirmation(email: string, portal: AuthPortal = 'customer'): Promise<void> {
    try {
      await this.getClient().auth.resend({
        type: 'signup',
        email: email.trim(),
        options: {
          emailRedirectTo: this.authRedirectUrl(portal)
        }
      });
    } catch {
      // intentionally ignored to prevent user enumeration
    }
  }

  /**
   * Complete a password reset. The front-end hands back the short-lived recovery
   * access token Supabase returned to its `/auth/callback` page. We validate that
   * token by resolving the user it belongs to (an expired/forged token yields no
   * user), then set the new password via the service-role admin API. Only the
   * holder of a valid recovery token — i.e. the person who received the reset
   * email — can reach this, so it needs no separate credential check.
   */
  async updatePassword(accessToken: string, newPassword: string): Promise<void> {
    const { data, error } = await this.getClient(accessToken).auth.getUser(accessToken);
    if (error || !data.user) {
      throw new UnauthorizedException({
        code: ErrorCodes.AUTH_FAILED,
        message: 'Your password reset link is invalid or has expired. Please request a new one.'
      });
    }

    const admin = this.getAdminClient();
    if (admin === undefined) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message:
          'Server is not configured to update passwords (SUPABASE_SERVICE_ROLE_KEY missing).'
      });
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, {
      password: newPassword
    });
    if (updateError) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: updateError.message
      });
    }
  }

  async signOut(accessToken: string): Promise<void> {
    const { error } = await this.getClient(accessToken).auth.signOut();
    if (error) {
      throw new BadRequestException({
        code: ErrorCodes.AUTH_FAILED,
        message: error.message
      });
    }
  }
}

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
