import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ErrorCodes } from '../errors/error-codes.js';
import type { SafeErrorDetails } from '../errors/error-envelope.js';
import { createErrorEnvelope } from '../errors/error-envelope.js';
import { getRequestId } from '../request/request-id.js';
import { JsonLogger } from '../logging/json-logger.service.js';
import { NoopErrorReporter, type ErrorReporter } from '../observability/error-reporter.js';

type ExceptionResponse = {
  code?: string;
  message?: string | readonly string[];
  details?: SafeErrorDetails;
  error?: string;
};

const httpStatusErrorCodes: Readonly<Record<number, string>> = {
  [HttpStatus.UNAUTHORIZED]: ErrorCodes.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCodes.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCodes.NOT_FOUND,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCodes.RATE_LIMITED,
  [HttpStatus.BAD_REQUEST]: ErrorCodes.VALIDATION_FAILED
};

function mapStatusToCode(status: number): string {
  return httpStatusErrorCodes[status] ?? ErrorCodes.INTERNAL_SERVER_ERROR;
}

function normalizeExceptionResponse(exception: HttpException): ExceptionResponse {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return { message: response };
  }
  return response;
}

function normalizeMessage(message: ExceptionResponse['message'], fallback: string): string {
  return typeof message === 'string' ? message : fallback;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: JsonLogger,
    private readonly reporter: ErrorReporter = new NoopErrorReporter()
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const requestId = getRequestId(request);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = normalizeExceptionResponse(exception);
      const message = normalizeMessage(response.message, exception.message);

      const envelope = createErrorEnvelope({
        code: response.code ?? mapStatusToCode(status),
        message,
        requestId,
        ...(response.details === undefined ? {} : { details: response.details })
      });

      void reply.status(status).send(envelope);
      return;
    }

    this.reporter.captureException(exception);

    this.logger.error(
      {
        requestId,
        error: exception instanceof Error ? exception.message : 'Unknown error'
      },
      exception instanceof Error ? exception.stack : undefined,
      'GlobalExceptionFilter'
    );

    const envelope = createErrorEnvelope({
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred.',
      requestId
    });

    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(envelope);
  }
}
