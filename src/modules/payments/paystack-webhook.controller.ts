import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
  handlePaystackWebhook(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() payload: PaystackWebhookEvent
  ): Record<string, unknown> {
    const signatureHeader = request.headers['x-paystack-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const rawBody = request.rawBody ?? JSON.stringify(payload);
    const result = this.webhookService.process(rawBody, signature, payload);

    if (result.status === 'duplicate') {
      reply.status(200);
    }

    return result;
  }
}
