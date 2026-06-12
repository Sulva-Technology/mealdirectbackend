import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthenticatedActor } from './actor-context.js';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.actor === undefined) {
      throw new Error('Authenticated actor is missing from request context.');
    }
    return request.actor;
  }
);
