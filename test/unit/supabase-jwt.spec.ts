import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { EnvService } from '../../src/config/env.service.js';
import { SupabaseJwtService } from '../../src/modules/auth/supabase-jwt.service.js';

const issuer = 'https://project.supabase.co/auth/v1';
const audience = 'authenticated';
const jwksUrl = 'https://project.supabase.co/auth/v1/.well-known/jwks.json';
const hsSecret = 'test-jwt-secret-at-least-32-characters-long';

function makeEnv(overrides: Record<string, unknown>): EnvService {
  return {
    get(key: string): unknown {
      const base: Record<string, unknown> = {
        SUPABASE_JWT_ISSUER: issuer,
        SUPABASE_JWT_AUDIENCE: audience
      };
      return { ...base, ...overrides }[key];
    }
  } as unknown as EnvService;
}

const claims = {
  email: 'rider@example.com',
  app_metadata: { meal_direct_role: 'rider' }
};

describe('SupabaseJwtService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies an RS256 token via the JWKS endpoint', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'key-1';
    jwk.alg = 'RS256';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ keys: [jwk] })
      })
    );

    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setSubject('11111111-1111-4111-8111-111111111111')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const service = new SupabaseJwtService(makeEnv({ SUPABASE_JWKS_URL: jwksUrl }));
    const actor = await service.verifyToken(token);

    expect(actor).toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'rider'
    });
  });

  it('falls back to HS256 verification when only the secret is configured', async () => {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('22222222-2222-4222-8222-222222222222')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(hsSecret));

    const service = new SupabaseJwtService(makeEnv({ SUPABASE_JWT_SECRET: hsSecret }));
    const actor = await service.verifyToken(token);

    expect(actor).toMatchObject({
      userId: '22222222-2222-4222-8222-222222222222',
      role: 'rider'
    });
  });

  it('rejects a token when no verification material is configured', async () => {
    const service = new SupabaseJwtService(makeEnv({}));
    await expect(service.verifyToken('any.token.value')).rejects.toThrow();
  });
});
