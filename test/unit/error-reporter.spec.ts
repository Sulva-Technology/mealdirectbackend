import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { DatabaseError } from 'pg';

import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter.js';
import { NoopErrorReporter } from '../../src/common/observability/error-reporter.js';
import type { ErrorReporter } from '../../src/common/observability/error-reporter.js';
import { JsonLogger } from '../../src/common/logging/json-logger.service.js';
import { EnvService } from '../../src/config/env.service.js';

function makeLogger(): JsonLogger {
  const envService = { get: () => 'silent' } as unknown as EnvService;
  return new JsonLogger(envService);
}

type CapturedReply = { status?: number; body?: unknown };

function fakeHost(captured: CapturedReply = {}): ArgumentsHost {
  const reply = {
    status: (value: number) => {
      captured.status = value;
      return reply;
    },
    send: (value: unknown) => {
      captured.body = value;
      return reply;
    },
    code: () => reply
  } as unknown;
  const request = {
    headers: {},
    id: 'req-1',
    requestId: 'req-1'
  } as unknown;
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request
    })
  } as ArgumentsHost;
}

function pgError(code: string, message: string): DatabaseError {
  const error = new DatabaseError(message, message.length, 'error');
  (error as { code: string }).code = code;
  return error;
}

describe('GlobalExceptionFilter error reporting', () => {
  it('reports unhandled non-HTTP errors to the reporter', () => {
    const reporter: ErrorReporter = { captureException: vi.fn() };
    const filter = new GlobalExceptionFilter(makeLogger(), reporter);

    filter.catch(new Error('boom'), fakeHost());

    expect(reporter.captureException).toHaveBeenCalledTimes(1);
  });

  it('does not report handled HttpExceptions', () => {
    const reporter: ErrorReporter = { captureException: vi.fn() };
    const filter = new GlobalExceptionFilter(makeLogger(), reporter);

    filter.catch(new HttpException('nope', HttpStatus.BAD_REQUEST), fakeHost());

    expect(reporter.captureException).not.toHaveBeenCalled();
  });

  it('maps a Postgres check_violation to a 400 with the raised message', () => {
    const reporter: ErrorReporter = { captureException: vi.fn() };
    const filter = new GlobalExceptionFilter(makeLogger(), reporter);
    const captured: CapturedReply = {};

    filter.catch(
      pgError('23514', 'menu item is not orderable for this date and slot'),
      fakeHost(captured)
    );

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'menu item is not orderable for this date and slot'
      }
    });
    expect(reporter.captureException).not.toHaveBeenCalled();
  });

  it('still reports unmapped Postgres errors as internal errors', () => {
    const reporter: ErrorReporter = { captureException: vi.fn() };
    const filter = new GlobalExceptionFilter(makeLogger(), reporter);
    const captured: CapturedReply = {};

    filter.catch(pgError('08006', 'connection failure'), fakeHost(captured));

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(reporter.captureException).toHaveBeenCalledTimes(1);
  });

  it('NoopErrorReporter is safe to call', () => {
    expect(() => new NoopErrorReporter().captureException(new Error('x'))).not.toThrow();
  });
});
