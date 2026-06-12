import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { SupabaseJwtService } from './supabase-jwt.service.js';

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new UnauthorizedException({
      code: ErrorCodes.UNAUTHORIZED,
      message: 'Bearer token is required.'
    });
  }

  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    throw new UnauthorizedException({
      code: ErrorCodes.UNAUTHORIZED,
      message: 'Bearer token is required.'
    });
  }

  return token;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(SupabaseJwtService) private readonly jwt: SupabaseJwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    request.actor = await this.jwt.verifyToken(extractBearerToken(request));
    return true;
  }
}
