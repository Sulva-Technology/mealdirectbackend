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
  Req,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { EnvService } from '../../config/env.service.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  PrintJobEnvelopeDto,
  PrintJobListEnvelopeDto,
  PrintJobListQueryDto,
  PrintOrderIdParamDto,
  PrinterIdParamDto,
  PrinterRegistrationEnvelopeDto,
  ReceiptViewEnvelopeDto,
  RegisterPrinterDto,
  VendorPrinterEnvelopeDto,
  VendorPrinterListEnvelopeDto
} from './dto/printing.dto.js';
import { PrintingService, type ServerUrlBase } from './printing.service.js';
import type {
  PrintJob,
  PrinterRegistration,
  ReceiptView,
  VendorPrinter
} from './printing.types.js';

@ApiTags('vendor-printing')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({
  description:
    'Vendor role and membership required; some actions also need the cloud_printing feature flag.'
})
@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('vendor')
export class VendorPrintersController {
  constructor(
    @Inject(PrintingService) private readonly printing: PrintingService,
    @Inject(EnvService) private readonly env: EnvService
  ) {}

  @Get('printers')
  @ApiOkResponse({
    description: 'Live printers for the vendor.',
    type: VendorPrinterListEnvelopeDto
  })
  async listPrinters(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<VendorPrinter>> {
    const printers = await this.printing.listPrinters(actor);
    return createListEnvelope(printers, { hasMore: false, limit: printers.length });
  }

  @Post('printers')
  @HttpCode(201)
  @ApiBody({ type: RegisterPrinterDto })
  @ApiCreatedResponse({
    description: 'Printer registered. serverUrl is returned only here — paste it into the printer.',
    type: PrinterRegistrationEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid MAC address or body.' })
  @ApiConflictResponse({ description: 'MAC already registered.' })
  async registerPrinter(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: RegisterPrinterDto,
    @Req() request: FastifyRequest
  ): Promise<SuccessEnvelope<PrinterRegistration>> {
    return createSuccessEnvelope(
      await this.printing.registerPrinter(
        actor,
        {
          name: body.name,
          macAddress: body.macAddress,
          ...(body.paperWidthChars === undefined ? {} : { paperWidthChars: body.paperWidthChars })
        },
        this.serverBase(request)
      )
    );
  }

  @Post('printers/:printerId/rotate-key')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'printerId', type: String })
  @ApiOkResponse({
    description: 'New key issued; the old server URL stops working immediately.',
    type: PrinterRegistrationEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Printer not found.' })
  async rotateKey(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PrinterIdParamDto,
    @Req() request: FastifyRequest
  ): Promise<SuccessEnvelope<PrinterRegistration>> {
    return createSuccessEnvelope(
      await this.printing.rotatePrinterKey(actor, params.printerId, this.serverBase(request))
    );
  }

  @Delete('printers/:printerId')
  @ApiParam({ format: 'uuid', name: 'printerId', type: String })
  @ApiOkResponse({ description: 'Printer revoked.', type: VendorPrinterEnvelopeDto })
  @ApiNotFoundResponse({ description: 'Printer not found.' })
  async revokePrinter(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PrinterIdParamDto
  ): Promise<SuccessEnvelope<VendorPrinter>> {
    return createSuccessEnvelope(await this.printing.revokePrinter(actor, params.printerId));
  }

  @Post('printers/:printerId/test-print')
  @HttpCode(201)
  @ApiParam({ format: 'uuid', name: 'printerId', type: String })
  @ApiCreatedResponse({
    description: 'Sample ticket queued (no order data).',
    type: PrintJobEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Printer not found.' })
  async testPrint(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PrinterIdParamDto
  ): Promise<SuccessEnvelope<PrintJob>> {
    return createSuccessEnvelope(await this.printing.testPrint(actor, params.printerId));
  }

  @Get('print-jobs')
  @ApiOkResponse({ description: 'Recent print jobs, newest first.', type: PrintJobListEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid filters.' })
  async listJobs(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: PrintJobListQueryDto
  ): Promise<ListEnvelope<PrintJob>> {
    const limit = query.limit ?? 50;
    const jobs = await this.printing.listJobs(actor, {
      ...(query.status === undefined ? {} : { status: query.status }),
      limit
    });
    return createListEnvelope(jobs, { hasMore: jobs.length === limit, limit });
  }

  @Get('orders/:orderId/receipt')
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Kitchen ticket data plus the rendered text.',
    type: ReceiptViewEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this vendor.' })
  async getReceipt(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PrintOrderIdParamDto
  ): Promise<SuccessEnvelope<ReceiptView>> {
    return createSuccessEnvelope(await this.printing.getReceipt(actor, params.orderId));
  }

  @Post('orders/:orderId/reprint')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'orderId', type: String })
  @ApiOkResponse({
    description: 'Ticket re-queued to print now. Audited.',
    type: PrintJobEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Order not found for this vendor.' })
  @ApiConflictResponse({ description: 'Vendor has no printer.' })
  async reprint(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: PrintOrderIdParamDto
  ): Promise<SuccessEnvelope<PrintJob>> {
    return createSuccessEnvelope(await this.printing.reprint(actor, params.orderId));
  }

  private serverBase(request: FastifyRequest): ServerUrlBase {
    // trustProxy is 1 (Render edge), so protocol/host reflect the public URL the vendor used.
    return {
      baseUrl: `${request.protocol}://${request.host}`,
      apiPrefix: this.env.all.API_PREFIX
    };
  }
}
