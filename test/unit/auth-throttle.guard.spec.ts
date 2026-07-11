import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AuthThrottleGuard } from '../../src/common/http/auth-throttle.guard.js';
import type { EnvService } from '../../src/config/env.service.js';

function makeEnv(max: number, windowMs: number): EnvService {
  return {
    get(key: string): unknown {
      if (key === 'AUTH_RATE_LIMIT_MAX') return max;
      if (key === 'AUTH_RATE_LIMIT_WINDOW_MS') return windowMs;
      return undefined;
    }
  } as unknown as EnvService;
}

function contextFor(ip: string, url: string): ExecutionContext {
  const request = { ip, url, routeOptions: { url } };
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}

describe('AuthThrottleGuard', () => {
  it('allows requests up to the limit then rejects with 429', () => {
    const guard = new AuthThrottleGuard(makeEnv(3, 60_000));
    const ctx = contextFor('1.2.3.4', '/v1/auth/customer/login');

    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);

    try {
      guard.canActivate(ctx);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  it('tracks limits independently per IP', () => {
    const guard = new AuthThrottleGuard(makeEnv(1, 60_000));
    expect(guard.canActivate(contextFor('1.1.1.1', '/v1/auth/customer/login'))).toBe(true);
    expect(guard.canActivate(contextFor('2.2.2.2', '/v1/auth/customer/login'))).toBe(true);
    expect(() => guard.canActivate(contextFor('1.1.1.1', '/v1/auth/customer/login'))).toThrow();
  });

  it('tracks limits independently per route', () => {
    const guard = new AuthThrottleGuard(makeEnv(1, 60_000));
    expect(guard.canActivate(contextFor('1.1.1.1', '/v1/auth/customer/login'))).toBe(true);
    expect(guard.canActivate(contextFor('1.1.1.1', '/v1/auth/vendor/login'))).toBe(true);
  });

  it('resets the window after it expires', () => {
    const guard = new AuthThrottleGuard(makeEnv(1, 1));
    const ctx = contextFor('9.9.9.9', '/v1/auth/refresh');
    expect(guard.canActivate(ctx)).toBe(true);
    const later = Date.now() + 5;
    while (Date.now() < later) {
      // spin briefly so the 1ms window elapses
    }
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
