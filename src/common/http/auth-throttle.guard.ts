import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ErrorCodes } from '../errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';

type Window = { count: number; resetAt: number };

/**
 * Per-client-IP fixed-window rate limiter for unauthenticated credential
 * endpoints (login/signup/password-reset/refresh). Sits on top of the global
 * @fastify/rate-limit and is far stricter, to blunt password guessing and
 * account-enumeration probing.
 *
 * The store is in-memory, matching the global limiter's default store; on a
 * multi-instance deploy the limit is per instance. That is an accepted trade-off
 * here (no shared Redis) and is still a large improvement over the 120/min global.
 */
@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private lastSweep = 0;

  constructor(@Inject(EnvService) private readonly env: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const max = this.env.get('AUTH_RATE_LIMIT_MAX');
    const windowMs = this.env.get('AUTH_RATE_LIMIT_WINDOW_MS');
    const now = Date.now();

    this.sweep(now);

    // trustProxy is enabled on the adapter, so request.ip reflects the client.
    const routeKey = request.routeOptions.url ?? request.url;
    const key = `${request.ip}:${routeKey}`;
    const existing = this.windows.get(key);

    if (existing === undefined || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (existing.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      throw new HttpException(
        {
          code: ErrorCodes.RATE_LIMITED,
          message: 'Too many attempts. Please wait and try again.',
          retryAfterSeconds: retryAfterSec
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    existing.count += 1;
    return true;
  }

  /** Drop expired windows periodically so the map cannot grow unbounded. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) {
      return;
    }
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
