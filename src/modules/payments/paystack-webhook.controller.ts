import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { PaystackWebhookEvent } from '../../domain/payments.js';
import { PaystackWebhookService } from './paystack-webhook.service.js';

@ApiTags('payments')
@Controller('payments/webhooks')
export class PaystackWebhookController {
  constructor(
    @Inject(PaystackWebhookService) private readonly webhookService: PaystackWebhookService
  ) {}

  @Post('paystack')
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'Paystack webhook was verified and accepted idempotently.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid Paystack signature.' })
  async handlePaystackWebhook(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() payload: PaystackWebhookEvent
  ): Promise<Record<string, unknown>> {
    const signatureHeader = request.headers['x-paystack-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    // Signature verification MUST run against the exact bytes Paystack signed. The JSON
    // content-type parser (app.factory) captures request.rawBody for us; if it is missing
    // we refuse rather than re-stringify, since re-serialization can silently drift from
    // the signed payload and defeat verification.
    const rawBody = request.rawBody;
    if (rawBody === undefined || rawBody.length === 0) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Paystack webhook raw body was not preserved.'
      });
    }
    const result = await this.webhookService.process(rawBody, signature, payload);

    if (result.status === 'duplicate') {
      reply.status(200);
    }

    return result;
  }
}
