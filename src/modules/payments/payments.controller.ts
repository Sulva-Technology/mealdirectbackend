import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { OrderIdParamDto } from '../orders/dto/order-api.dto.js';
import {
  AdminPaymentDetailEnvelopeDto,
  AdminPaymentListEnvelopeDto,
  AdminPaymentListQueryDto,
  InitiateRefundDto,
  PaymentIdParamDto,
  PaymentReconciliationEnvelopeDto,
  PaystackInitializationEnvelopeDto,
  RefundEnvelopeDto
} from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';
import type {
  AdminPaymentDetail,
  AdminPaymentRecord,
  PaymentInitializationResponse,
  PaymentReconciliationResponse,
  PaymentTimelineEvent,
  PaymentWebhookRecord,
  RefundRecord
} from './payments.types.js';

@ApiTags('payments')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerPaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post(':orderId/payments/paystack/initialize')
  @HttpCode(200)
  @RequireRoles('customer')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Paystack checkout initialization for a customer-owned pending order.',
    type: PaystackInitializationEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid order or payment state.' })
  async initializePaystack(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: OrderIdParamDto
  ): Promise<SuccessEnvelope<PaymentInitializationResponse>> {
    return createSuccessEnvelope(await this.payments.initializePaystack(actor, params.orderId));
  }
}

@ApiTags('admin-payments')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminPaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Admin-visible payment records scoped by campus for campus admins.',
    type: AdminPaymentListEnvelopeDto
  })
  async listPayments(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminPaymentListQueryDto
  ): Promise<ListEnvelope<AdminPaymentRecord>> {
    const result = await this.payments.listAdminPayments(
      actor,
      {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.vendorId === undefined ? {} : { vendorId: query.vendorId }),
        ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
        ...(query.reference === undefined ? {} : { reference: query.reference }),
        ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
        ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo })
      },
      {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit })
      }
    );
    return createListEnvelope(result.items, {
      hasMore: result.hasMore,
      limit: result.limit,
      ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor })
    });
  }

  @Get(':paymentId')
  @ApiParam({ format: 'uuid', name: 'paymentId', type: String })
  @ApiOkResponse({
    description: 'Admin-visible enriched payment detail scoped by campus for campus admins.',
    type: AdminPaymentDetailEnvelopeDto
  })
  async getPayment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PaymentIdParamDto
  ): Promise<SuccessEnvelope<AdminPaymentDetail>> {
    return createSuccessEnvelope(
      await this.payments.getAdminPaymentDetail(actor, params.paymentId)
    );
  }

  @Get(':paymentId/timeline')
  @ApiParam({ format: 'uuid', name: 'paymentId', type: String })
  @ApiOkResponse({ description: 'Chronological payment/order/refund timeline.' })
  async getTimeline(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PaymentIdParamDto
  ): Promise<ListEnvelope<PaymentTimelineEvent>> {
    const events = await this.payments.getAdminPaymentTimeline(actor, params.paymentId);
    return createListEnvelope(events, { hasMore: false, limit: events.length });
  }

  @Get(':paymentId/webhooks')
  @ApiParam({ format: 'uuid', name: 'paymentId', type: String })
  @ApiOkResponse({ description: 'Paystack webhook events recorded for this payment reference.' })
  async getWebhooks(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PaymentIdParamDto
  ): Promise<ListEnvelope<PaymentWebhookRecord>> {
    const webhooks = await this.payments.getAdminPaymentWebhooks(actor, params.paymentId);
    return createListEnvelope(webhooks, { hasMore: false, limit: webhooks.length });
  }

  @Post(':paymentId/reconcile')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'paymentId', type: String })
  @ApiOkResponse({
    description: 'Verifies a Paystack transaction and marks the local payment successful.',
    type: PaymentReconciliationEnvelopeDto
  })
  async reconcilePayment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PaymentIdParamDto
  ): Promise<SuccessEnvelope<PaymentReconciliationResponse>> {
    return createSuccessEnvelope(
      await this.payments.reconcilePaystackPayment(actor, params.paymentId)
    );
  }

  @Post(':paymentId/refunds')
  @HttpCode(201)
  @ApiParam({ format: 'uuid', name: 'paymentId', type: String })
  @ApiCreatedResponse({
    description: 'Creates a bounded Paystack refund for a successful payment.',
    type: RefundEnvelopeDto
  })
  async initiateRefund(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PaymentIdParamDto,
    @Body() input: InitiateRefundDto
  ): Promise<SuccessEnvelope<RefundRecord>> {
    return createSuccessEnvelope(
      await this.payments.initiateRefund(actor, params.paymentId, input)
    );
  }
}
