import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { ErrorCodes } from './errors/error-codes.js';

function flattenValidationErrors(errors: readonly ValidationError[]): Record<string, unknown>[] {
  return errors.flatMap((error) => {
    const ownErrors = Object.values(error.constraints ?? {}).map((message) => ({
      field: error.property,
      message
    }));
    const childErrors = flattenValidationErrors(error.children ?? []);
    return [...ownErrors, ...childErrors];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Request validation failed',
        details: flattenValidationErrors(errors)
      })
  });
}
