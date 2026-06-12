import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { EnvService } from '../config/env.service.js';

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

@Injectable()
export class InternalOperationsGuard implements CanActivate {
  constructor(@Inject(EnvService) private readonly env: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedToken = this.env.get('INTERNAL_OPERATIONS_TOKEN');
    if (expectedToken === undefined) {
      throw new UnauthorizedException({
        code: 'OPERATIONS_AUTH_REQUIRED',
        message: 'Operations endpoint is not configured.'
      });
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;

    if (token === undefined || !safeCompare(token, expectedToken)) {
      throw new UnauthorizedException({
        code: 'OPERATIONS_AUTH_REQUIRED',
        message: 'Valid operations credentials are required.'
      });
    }

    return true;
  }
}
