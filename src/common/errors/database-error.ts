import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException
} from '@nestjs/common';
import { DatabaseError } from 'pg';

import { ErrorCodes } from './error-codes.js';

type DatabaseErrorMapping = (message: string) => HttpException;

// Postgres SQLSTATE → HTTP. Business rules in plpgsql functions raise with
// `using errcode = '23514'`; raises without an explicit errcode default to
// 'P0001'. Both carry an intentional, client-safe message we surface as-is.
const sqlStateMappings: Readonly<Record<string, DatabaseErrorMapping>> = {
  // check_violation — business-rule guards and table CHECK constraints.
  '23514': (message) =>
    new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message }),
  // raise_exception — plpgsql `raise exception` without an explicit errcode.
  P0001: (message) => new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message }),
  // unique_violation.
  '23505': (message) => new ConflictException({ code: ErrorCodes.CONFLICT, message }),
  // foreign_key_violation.
  '23503': (message) =>
    new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message }),
  // not_null_violation.
  '23502': (message) => new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message }),
  // no_data_found — explicit `raise no_data_found` in plpgsql.
  P0002: (message) => new NotFoundException({ code: ErrorCodes.NOT_FOUND, message })
};

/**
 * Translate a node-postgres `DatabaseError` into the matching `HttpException`
 * so business-rule failures raised inside Postgres functions surface as proper
 * 4xx responses instead of an opaque 500. Returns `undefined` for unknown error
 * shapes so the caller can fall back to a generic internal error.
 */
export function mapDatabaseError(exception: unknown): HttpException | undefined {
  if (!(exception instanceof DatabaseError) || exception.code === undefined) {
    return undefined;
  }

  const mapping = sqlStateMappings[exception.code];
  if (mapping === undefined) {
    return undefined;
  }

  return mapping(exception.message);
}
