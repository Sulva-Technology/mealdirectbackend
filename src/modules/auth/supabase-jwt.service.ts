import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { ActorRole } from '../../domain/authorization.js';
import { EnvService } from '../../config/env.service.js';
import type { AuthenticatedActor } from './actor-context.js';
import { isActorRole } from './actor-context.js';

// Roles a user is allowed to self-select at signup. Privileged roles
// (campus_admin, super_admin) must ONLY ever come from app_metadata, which is
// not user-editable. user_metadata IS user-editable, so it can never grant them.
const selfServiceRoles: readonly ActorRole[] = ['customer', 'vendor', 'rider'];

// app_metadata is authoritative. user_metadata.meal_direct_role is user-editable,
// so honoring it lets a user self-assign a role. It is a transitional fallback for
// pre-migration users, gated behind AUTH_ALLOW_USER_METADATA_ROLE_FALLBACK and off
// by default. Drop it entirely once every user's role is backfilled to app_metadata.
function resolveRole(
  appMetadata: Record<string, unknown>,
  userMetadata: Record<string, unknown>,
  allowUserMetadataFallback: boolean
): ActorRole {
  const appRole = appMetadata.meal_direct_role ?? appMetadata.role;
  if (isActorRole(appRole)) {
    return appRole;
  }
  if (allowUserMetadataFallback) {
    const userRole = userMetadata.meal_direct_role;
    if (isActorRole(userRole) && selfServiceRoles.includes(userRole)) {
      return userRole;
    }
  }
  return 'customer';
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function unauthorized(message = 'Invalid or expired bearer token.'): UnauthorizedException {
  return new UnauthorizedException({
    code: ErrorCodes.UNAUTHORIZED,
    message
  });
}

@Injectable()
export class SupabaseJwtService {
  private readonly logger = new Logger(SupabaseJwtService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(EnvService) private readonly env: EnvService) {}

  private logFailure(error: unknown): void {
    const reason =
      error instanceof Error
        ? `${(error as { code?: string }).code ?? error.name}: ${error.message}`
        : String(error);
    this.logger.debug(`JWT verification failed — ${reason}`);
  }

  async verifyToken(token: string): Promise<AuthenticatedActor> {
    const options = {
      issuer: this.env.get('SUPABASE_JWT_ISSUER'),
      audience: this.env.get('SUPABASE_JWT_AUDIENCE')
    };

    const jwksUrl = this.env.get('SUPABASE_JWKS_URL');
    if (jwksUrl !== undefined) {
      try {
        const { payload } = await jwtVerify(token, this.resolveJwks(jwksUrl), options);
        return this.toActor(payload);
      } catch (error) {
        this.logFailure(error);
        throw unauthorized();
      }
    }

    const jwtSecret = this.env.get('SUPABASE_JWT_SECRET');
    if (jwtSecret === undefined) {
      throw unauthorized('JWT verification is not configured.');
    }

    let secretKey: Uint8Array;
    if (
      /^[A-Za-z0-9+/=]+$/.test(jwtSecret) &&
      jwtSecret.length % 4 === 0 &&
      jwtSecret.length > 32
    ) {
      secretKey = Buffer.from(jwtSecret, 'base64');
    } else {
      secretKey = new TextEncoder().encode(jwtSecret);
    }

    try {
      const { payload } = await jwtVerify(token, secretKey, options);
      return this.toActor(payload);
    } catch (error) {
      this.logFailure(error);
      throw unauthorized();
    }
  }

  private resolveJwks(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
    this.jwks ??= createRemoteJWKSet(new URL(jwksUrl));
    return this.jwks;
  }

  private toActor(claims: JWTPayload): AuthenticatedActor {
    const userId = claims.sub;
    if (userId === undefined || userId.length === 0) {
      throw unauthorized('Token subject is missing.');
    }

    const appMetadata = objectValue(claims.app_metadata);
    const userMetadata = objectValue(claims.user_metadata);
    const role = resolveRole(
      appMetadata,
      userMetadata,
      this.env.get('AUTH_ALLOW_USER_METADATA_ROLE_FALLBACK')
    );
    const email = stringValue(claims.email);
    const campusId = stringValue(appMetadata.campus_id);
    const vendorId = stringValue(appMetadata.vendor_id);
    const riderId = stringValue(appMetadata.rider_id);

    return {
      userId,
      role,
      ...(email === undefined ? {} : { email }),
      ...(campusId === undefined ? {} : { campusId }),
      ...(vendorId === undefined ? {} : { vendorId }),
      ...(riderId === undefined ? {} : { riderId })
    };
  }
}
