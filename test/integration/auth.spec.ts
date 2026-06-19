import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { SupabaseAuthService } from '../../src/modules/auth/supabase-auth.service.js';

const testSecret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const issuer = 'http://127.0.0.1:54321/auth/v1';
const audience = 'authenticated';
const subject = '11111111-1111-4111-8111-111111111111';

async function signToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({
    email: 'student@example.com',
    app_metadata: {
      meal_direct_role: 'campus_admin',
      campus_id: 'campus-a'
    },
    ...overrides
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(testSecret);
}

describe('Supabase JWT authentication', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects protected routes without a bearer token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'UNAUTHORIZED'
      }
    });
  });

  it('rejects expired JWTs', async () => {
    const token = await new SignJWT({ email: 'student@example.com' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(testSecret);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'UNAUTHORIZED'
      }
    });
  });

  it('returns a filtered actor context for a valid Supabase JWT', async () => {
    const token = await signToken();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      actor: {
        userId: subject,
        email: 'student@example.com',
        role: 'campus_admin',
        campusId: 'campus-a'
      }
    });
  });

  describe('public auth endpoints', () => {
    it('customer/signup returns 201 and tokens', async () => {
      const authService = app.get(SupabaseAuthService);
      const mockResponse = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: { id: 'user-uuid', email: 'test@example.com', role: 'customer' }
      };
      const signUpSpy = vi.spyOn(authService, 'signUp').mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/customer/signup',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
          fullName: 'Test User',
          redirectTo: 'http://localhost:3000/auth/callback'
        }
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(mockResponse);
      expect(signUpSpy).toHaveBeenCalledWith(
        'test@example.com',
        'Password123!',
        'customer',
        'Test User',
        'http://localhost:3000/auth/callback'
      );
    });

    it('customer/login returns 200 and tokens', async () => {
      const authService = app.get(SupabaseAuthService);
      const mockResponse = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: { id: 'user-uuid', email: 'test@example.com', role: 'customer' }
      };
      const signInSpy = vi.spyOn(authService, 'signIn').mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/customer/login',
        payload: {
          email: 'test@example.com',
          password: 'Password123!'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResponse);
      expect(signInSpy).toHaveBeenCalledWith('test@example.com', 'Password123!', ['customer']);
    });

    it('refresh returns 200 and new tokens', async () => {
      const authService = app.get(SupabaseAuthService);
      const mockResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        user: { id: 'user-uuid', email: 'test@example.com', role: 'customer' }
      };
      const refreshSpy = vi.spyOn(authService, 'refresh').mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: {
          refreshToken: 'old-refresh-token'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResponse);
      expect(refreshSpy).toHaveBeenCalledWith('old-refresh-token');
    });

    it('password-reset returns 200 with a non-enumerating message', async () => {
      const authService = app.get(SupabaseAuthService);
      const resetSpy = vi
        .spyOn(authService, 'requestPasswordReset')
        .mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/password-reset',
        payload: { email: 'test@example.com' }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ message: string }>().message).toMatch(/password reset/i);
      expect(resetSpy).toHaveBeenCalledWith('test@example.com');
    });

    it('password-reset validates the email shape', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/password-reset',
        payload: { email: 'not-an-email' }
      });

      expect(response.statusCode).toBe(400);
    });

    it('resend-confirmation returns 200 with a non-enumerating message', async () => {
      const authService = app.get(SupabaseAuthService);
      const resendSpy = vi
        .spyOn(authService, 'resendConfirmation')
        .mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/resend-confirmation',
        payload: { email: 'test@example.com' }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ message: string }>().message).toMatch(/confirmation/i);
      expect(resendSpy).toHaveBeenCalledWith('test@example.com');
    });

    it('logout returns 200', async () => {
      const authService = app.get(SupabaseAuthService);
      const signOutSpy = vi.spyOn(authService, 'signOut').mockResolvedValue(undefined);
      const token = await signToken();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(signOutSpy).toHaveBeenCalledWith(token);
    });
  });
});
