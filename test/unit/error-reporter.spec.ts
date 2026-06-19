import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';

import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter.js';
import { NoopErrorReporter } from '../../src/common/observability/error-reporter.js';
import type { ErrorReporter } from '../../src/common/observability/error-reporter.js';
import { JsonLogger } from '../../src/common/logging/json-logger.service.js';
import { EnvService } from '../../src/config/env.service.js';

function makeLogger(): JsonLogger {
  const envService = { get: () => 'silent' } as unknown as EnvService;
  return new JsonLogger(envService);
}

function fakeHost(): ArgumentsHost {
  const reply = {
    status: () => reply,
    send: () => reply,
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

  it('NoopErrorReporter is safe to call', () => {
    expect(() => new NoopErrorReporter().captureException(new Error('x'))).not.toThrow();
  });
});
