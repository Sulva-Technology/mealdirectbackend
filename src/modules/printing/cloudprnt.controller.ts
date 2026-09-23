import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { CloudPrntService, type CloudPrntPollResponse } from './cloudprnt.service.js';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Star CloudPRNT endpoint. Called by printers, not people: no JWT — the secret key in the
 * path is the credential, bound to the printer MAC. Bodies/queries are the printer's own
 * shape (extra fields vary by firmware), so they are read loosely rather than via DTOs.
 * Excluded from OpenAPI: it is a device protocol, not part of the client API.
 */
@ApiExcludeController()
@Controller('printers/cloudprnt/:printerKey')
export class CloudPrntController {
  constructor(@Inject(CloudPrntService) private readonly cloudPrnt: CloudPrntService) {}

  @Post()
  @HttpCode(200)
  async poll(
    @Param('printerKey') printerKey: string,
    @Body() body: unknown
  ): Promise<CloudPrntPollResponse> {
    return this.cloudPrnt.poll(printerKey, asRecord(body));
  }

  @Get()
  async fetchJob(
    @Param('printerKey') printerKey: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<string> {
    const job = await this.cloudPrnt.fetchJob(printerKey, asRecord(query));
    void reply.header('content-type', `${job.contentType}; charset=utf-8`);
    void reply.header('cache-control', 'no-store');
    return job.body;
  }

  @Delete()
  @HttpCode(200)
  async acknowledge(
    @Param('printerKey') printerKey: string,
    @Query() query: unknown
  ): Promise<{ ok: true }> {
    await this.cloudPrnt.acknowledge(printerKey, asRecord(query));
    return { ok: true };
  }
}
