import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { ActorRole } from '../../domain/authorization.js';
import { requiredRolesMetadataKey } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<readonly ActorRole[]>(requiredRolesMetadataKey, [
        context.getHandler(),
        context.getClass()
      ]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = request.actor;

    if (actor !== undefined && requiredRoles.includes(actor.role)) {
      return true;
    }

    throw new ForbiddenException({
      code: ErrorCodes.FORBIDDEN,
      message: 'Insufficient permissions.'
    });
  }
}
