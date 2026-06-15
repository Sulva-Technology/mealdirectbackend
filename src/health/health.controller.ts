import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';

import { ErrorCodes } from '../common/errors/error-codes.js';
import { JsonLogger } from '../common/logging/json-logger.service.js';
import { EnvService } from '../config/env.service.js';
import { DatabaseService } from '../database/database.service.js';

type LiveResponse = {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
  release: {
    version: string;
    commitSha: string;
  };
};

type ReadyResponse = LiveResponse & {
  database: {
    status: 'ok';
    latencyMs: number;
  };
};

function sanitizeDatabaseErrorMessage(message: string): string {
  return message
    .replace(/:\/\/[^:\s/@]+:[^@\s/]+@/g, '://[REDACTED]@')
    .replace(/password\s+"[^"]+"/gi, 'password "[REDACTED]"');
}

function stringProperty(error: unknown, key: string): string | undefined {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number') {
    return value.toString();
  }

  return undefined;
}

function databaseErrorDetails(error: unknown): Record<string, string> {
  const details: Record<string, string> = {};
  const name = error instanceof Error ? error.name : undefined;
  const message = error instanceof Error ? error.message : undefined;
  const code = stringProperty(error, 'code');

  if (name !== undefined) {
    details.name = name;
  }
  if (code !== undefined) {
    details.code = code;
  }
  if (message !== undefined) {
    details.message = sanitizeDatabaseErrorMessage(message);
  }

  return details;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(JsonLogger) private readonly logger: JsonLogger
  ) {}

  @Get('live')
  @ApiOkResponse({ description: 'The API process is running.' })
  live(): LiveResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      release: {
        version: this.env.get('RELEASE_VERSION'),
        commitSha: this.env.get('COMMIT_SHA')
      }
    };
  }

  @Get('ready')
  @ApiOkResponse({ description: 'The API is ready to serve traffic.' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable.' })
  async ready(): Promise<ReadyResponse> {
    try {
      const database = await this.database.checkHealth();
      return {
        ...this.live(),
        database: {
          status: 'ok',
          latencyMs: database.latencyMs
        }
      };
    } catch (error) {
      this.logger.error(
        {
          message: 'Database health check failed',
          databaseError: databaseErrorDetails(error)
        },
        error instanceof Error ? error.stack : undefined,
        'HealthController'
      );

      throw new ServiceUnavailableException({
        code: ErrorCodes.DATABASE_UNAVAILABLE,
        message: 'Database is unavailable.'
      });
    }
  }
}
