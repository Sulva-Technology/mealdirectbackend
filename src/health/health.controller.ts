import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';

import { ErrorCodes } from '../common/errors/error-codes.js';
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

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EnvService) private readonly env: EnvService
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
    } catch {
      throw new ServiceUnavailableException({
        code: ErrorCodes.DATABASE_UNAVAILABLE,
        message: 'Database is unavailable.'
      });
    }
  }
}
