import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
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
  AdminPaymentEnvelopeDto,
  AdminPaymentListEnvelopeDto,
  InitiateRefundDto,
  PaymentIdParamDto,
  PaymentReconciliationEnvelopeDto,
  PaystackInitializationEnvelopeDto,
  RefundEnvelopeDto
} from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';
import type {
  AdminPaymentRecord,
  PaymentInitializationResponse,
  PaymentRecord,
  PaymentReconciliationResponse,
  RefundRecord
} from './payments.types.js';

function toAdminPaymentRecord(payment: PaymentRecord): AdminPaymentRecord {
  return {
    campusId: payment.campusId,
    currency: payment.currency,
    customerEmail: payment.customerEmail,
    customerId: payment.customerId,
    expectedAmountKobo: payment.expectedAmountKobo,
    id: payment.id,
    initializedAt: payment.initializedAt,
    orderId: payment.orderId,
    orderNumber: payment.orderNumber,
    orderStatus: payment.orderStatus,
    orderTotalKobo: payment.orderTotalKobo,
    paidAmountKobo: payment.paidAmountKobo,
    paidAt: payment.paidAt,
    paymentStatus: payment.paymentStatus,
    providerReference: payment.providerReference,
    providerTransactionId: payment.providerTransactionId,
    verifiedAt: payment.verifiedAt
  };
}

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
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<AdminPaymentRecord>> {
    const payments = await this.payments.listAdminPayments(actor);
    return createListEnvelope(
      payments.map((payment) => toAdminPaymentRecord(payment)),
      {
        hasMore: false,
        limit: payments.length
      }
    );
  }

  @Get(':paymentId')
  @ApiParam({ format: 'uuid', name: 'paymentId', type: String })
  @ApiOkResponse({
    description: 'Admin-visible payment detail scoped by campus for campus admins.',
    type: AdminPaymentEnvelopeDto
  })
  async getPayment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PaymentIdParamDto
  ): Promise<SuccessEnvelope<AdminPaymentRecord>> {
    return createSuccessEnvelope(
      toAdminPaymentRecord(await this.payments.getAdminPayment(actor, params.paymentId))
    );
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
