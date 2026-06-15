import { SignJWT } from 'jose';

import { fixtures } from './fixtures.js';

type E2ERole = 'campus_admin' | 'customer' | 'rider' | 'super_admin' | 'vendor';

const actorByRole: Record<E2ERole, { email: string; userId: string }> = {
  campus_admin: {
    email: 'campus.admin@example.test',
    userId: fixtures.campusAdminId
  },
  customer: {
    email: 'customer.one@example.test',
    userId: fixtures.customerId
  },
  rider: {
    email: 'rider.one@example.test',
    userId: fixtures.riderUserId
  },
  super_admin: {
    email: 'super.admin@example.test',
    userId: fixtures.superAdminId
  },
  vendor: {
    email: 'owner.alliday@example.test',
    userId: fixtures.vendorOwnerId
  }
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for hosted E2E authentication.`);
  }
  return value;
}

export async function signE2EToken(role: E2ERole): Promise<string> {
  const actor = actorByRole[role];
  const secret = requiredEnv('SUPABASE_JWT_SECRET');
  const issuer = process.env.SUPABASE_JWT_ISSUER ?? `${requiredEnv('SUPABASE_URL')}/auth/v1`;

  return new SignJWT({
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'campus_admin' ? { campus_id: fixtures.campusId } : {}),
      ...(role === 'vendor' ? { vendor_id: fixtures.vendorId } : {}),
      ...(role === 'rider' ? { rider_id: fixtures.riderId } : {})
    },
    email: actor.email
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(actor.userId)
    .setIssuer(issuer)
    .setAudience(process.env.SUPABASE_JWT_AUDIENCE ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(new TextEncoder().encode(secret));
}

export async function authHeader(role: E2ERole): Promise<{ authorization: string }> {
  return {
    authorization: `Bearer ${await signE2EToken(role)}`
  };
}
