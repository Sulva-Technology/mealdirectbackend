import 'fastify';

import type { AuthenticatedActor } from '../modules/auth/actor-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId?: string;
    traceId?: string;
    startedAtMs?: number;
    actor?: AuthenticatedActor;
    rawBody?: string;
  }
}
