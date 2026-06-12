import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

const fallbackHeader = 'x-request-id';

export function extractRequestId(request: FastifyRequest, headerName = fallbackHeader): string {
  const rawHeader = request.headers[headerName.toLowerCase()];
  if (Array.isArray(rawHeader)) {
    const first = rawHeader.find((value) => value.trim().length > 0);
    return first ?? randomUUID();
  }

  if (typeof rawHeader === 'string' && rawHeader.trim().length > 0) {
    return rawHeader;
  }

  return randomUUID();
}

export function getRequestId(request: FastifyRequest | undefined): string {
  return request?.requestId ?? randomUUID();
}

export function extractTraceId(request: FastifyRequest, headerName: string): string {
  const traceHeader = request.headers[headerName.toLowerCase()];
  if (Array.isArray(traceHeader)) {
    return (
      traceHeader.find((value) => value.trim().length > 0) ?? request.requestId ?? randomUUID()
    );
  }

  if (typeof traceHeader === 'string' && traceHeader.trim().length > 0) {
    return traceHeader;
  }

  const traceparent = request.headers.traceparent;
  if (typeof traceparent === 'string' && traceparent.trim().length > 0) {
    return traceparent;
  }

  return request.requestId ?? randomUUID();
}

export function attachRequestId(
  request: FastifyRequest,
  reply: FastifyReply,
  headerName = fallbackHeader
): void {
  const requestId = extractRequestId(request, headerName);
  request.requestId = requestId;
  reply.header(headerName, requestId);
}
