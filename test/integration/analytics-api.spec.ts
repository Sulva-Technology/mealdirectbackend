import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { AnalyticsRepository } from '../../src/modules/analytics/analytics.repository.js';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const userId = '22222222-2222-4222-8222-222222222222';
const campusId = '11111111-1111-4111-8111-111111111111';
const anonymousId = '33333333-3333-4333-8333-333333333333';

async function signToken(role: string, extra: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: { meal_direct_role: role, ...extra }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

describe('analytics API', () => {
  let app: NestFastifyApplication;
  let repository: AnalyticsRepository;
  let service: AnalyticsService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    repository = app.get(AnalyticsRepository);
    service = app.get(AnalyticsService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/analytics/events', () => {
    it('records an anonymous step without a token', async () => {
      const record = vi.spyOn(repository, 'recordEvent').mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/analytics/events',
        payload: { event: 'campus_link_opened', anonymousId, campusSlug: ' Venite-University ' }
      });

      expect(response.statusCode).toBe(204);
      expect(record).toHaveBeenCalledWith({
        event: 'campus_link_opened',
        anonymousId,
        campusSlug: 'venite-university'
      });
    });

    it('links the step to the user behind a valid bearer token', async () => {
      const record = vi.spyOn(repository, 'recordEvent').mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/analytics/events',
        headers: { authorization: `Bearer ${await signToken('customer')}` },
        payload: { event: 'campus_selected', anonymousId, campusId }
      });

      expect(response.statusCode).toBe(204);
      expect(record).toHaveBeenCalledWith({
        event: 'campus_selected',
        anonymousId,
        userId,
        campusId
      });
    });

    it('records anonymously when the token is invalid', async () => {
      const record = vi.spyOn(repository, 'recordEvent').mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/analytics/events',
        headers: { authorization: 'Bearer not-a-jwt' },
        payload: { event: 'signup_started', anonymousId }
      });

      expect(response.statusCode).toBe(204);
      expect(record).toHaveBeenCalledWith({ event: 'signup_started', anonymousId });
    });

    it('still answers 204 when storage fails', async () => {
      vi.spyOn(repository, 'recordEvent').mockRejectedValue(new Error('db down'));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/analytics/events',
        payload: { event: 'signup_started', anonymousId }
      });

      expect(response.statusCode).toBe(204);
    });

    it('rejects unknown events, bad ids and smuggled user ids', async () => {
      const record = vi.spyOn(repository, 'recordEvent').mockResolvedValue(undefined);

      for (const payload of [
        { event: 'page_viewed', anonymousId },
        { event: 'signup_started', anonymousId: 'nope' },
        { event: 'signup_started', anonymousId, campusSlug: 'Bad Slug!' },
        { event: 'signup_started', anonymousId, userId }
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/analytics/events',
          payload
        });
        expect(response.statusCode).toBe(400);
      }
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/admin/analytics/funnel', () => {
    it('requires a token', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/analytics/funnel' });
      expect(response.statusCode).toBe(401);
    });

    it('is closed to customers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics/funnel',
        headers: { authorization: `Bearer ${await signToken('customer')}` }
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns the funnel for a super admin', async () => {
      const funnel = vi.spyOn(service, 'getSignupFunnel').mockResolvedValue({
        campusId,
        dateFrom: '2026-10-01',
        dateTo: null,
        steps: [{ key: 'first_order', label: 'Placed first paid order', count: 3 }],
        byCampus: []
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/admin/analytics/funnel?campusId=${campusId}&dateFrom=2026-10-01`,
        headers: { authorization: `Bearer ${await signToken('super_admin')}` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { steps: { count: number }[] } }>().data.steps[0]?.count).toBe(
        3
      );
      expect(funnel).toHaveBeenCalledWith(expect.objectContaining({ role: 'super_admin' }), {
        campusId,
        dateFrom: '2026-10-01'
      });
    });

    it('validates the date filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/analytics/funnel?dateFrom=yesterday',
        headers: { authorization: `Bearer ${await signToken('super_admin')}` }
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
