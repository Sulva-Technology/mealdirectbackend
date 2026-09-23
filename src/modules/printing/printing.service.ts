import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { DatabaseError } from 'pg';

import { AuditService } from '../../common/audit/audit.service.js';
import { ErrorCodes } from '../../common/errors/error-codes.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { FeatureFlagsService, subjectForActor } from '../feature-flags/feature-flags.service.js';
import { FeatureFlagKeys } from '../feature-flags/feature-flags.types.js';
import {
  cloudPrntServerUrl,
  generatePrinterKey,
  hashPrinterKey,
  normalizeMacAddress
} from './printer-key.js';
import { PrintingRepository } from './printing.repository.js';
import type {
  PaperWidth,
  PrintJob,
  PrintJobStatus,
  PrinterRegistration,
  PrintingRepositoryContract,
  ReceiptView,
  VendorPrinter
} from './printing.types.js';
import { renderReceipt } from './receipt.renderer.js';

const PREVIEW_WIDTH: PaperWidth = 48;

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message });
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message });
}

function conflict(message: string): ConflictException {
  return new ConflictException({ code: ErrorCodes.CONFLICT, message });
}

export type RegisterPrinterInput = {
  name: string;
  macAddress: string;
  paperWidthChars?: PaperWidth;
};

/** Where the printer-facing URL is served from, taken from the vendor's request. */
export type ServerUrlBase = {
  baseUrl: string;
  apiPrefix: string;
};

/** Vendor-facing printer management, receipt preview and reprint. */
@Injectable()
export class PrintingService {
  constructor(
    @Inject(PrintingRepository) private readonly repository: PrintingRepositoryContract,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async listPrinters(actor: AuthenticatedActor): Promise<VendorPrinter[]> {
    const vendorId = await this.vendorIdFor(actor);
    return this.repository.listPrinters(vendorId);
  }

  async registerPrinter(
    actor: AuthenticatedActor,
    input: RegisterPrinterInput,
    server: ServerUrlBase
  ): Promise<PrinterRegistration> {
    const vendorId = await this.vendorIdFor(actor);
    await this.assertPrintingEnabled(actor);

    const macAddress = normalizeMacAddress(input.macAddress);
    if (macAddress === undefined) {
      throw badRequest('macAddress must be 12 hex digits, e.g. 00:11:62:AA:BB:CC.');
    }

    const key = generatePrinterKey();
    let printer: VendorPrinter;
    try {
      printer = await this.repository.insertPrinter({
        vendorId,
        name: input.name.trim(),
        macAddress,
        paperWidthChars: input.paperWidthChars ?? 48,
        keyHash: hashPrinterKey(key),
        createdBy: actor.userId
      });
    } catch (error) {
      if (error instanceof DatabaseError && error.code === '23505') {
        throw conflict('A printer with this MAC address is already registered.');
      }
      throw error;
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: 'vendor',
      action: 'vendor_printer.register',
      entityType: 'vendor_printer',
      entityId: printer.id,
      after: { name: printer.name, macAddress: printer.macAddress },
      metadata: { vendorId }
    });

    return {
      printer,
      serverUrl: cloudPrntServerUrl(server.baseUrl, server.apiPrefix, key)
    };
  }

  async rotatePrinterKey(
    actor: AuthenticatedActor,
    printerId: string,
    server: ServerUrlBase
  ): Promise<PrinterRegistration> {
    const vendorId = await this.vendorIdFor(actor);
    const key = generatePrinterKey();
    const printer = await this.repository.rotatePrinterKey(
      vendorId,
      printerId,
      hashPrinterKey(key)
    );
    if (printer === undefined) {
      throw notFound('Printer was not found.');
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: 'vendor',
      action: 'vendor_printer.rotate_key',
      entityType: 'vendor_printer',
      entityId: printer.id,
      metadata: { vendorId }
    });

    return {
      printer,
      serverUrl: cloudPrntServerUrl(server.baseUrl, server.apiPrefix, key)
    };
  }

  async revokePrinter(actor: AuthenticatedActor, printerId: string): Promise<VendorPrinter> {
    const vendorId = await this.vendorIdFor(actor);
    const printer = await this.repository.revokePrinter(vendorId, printerId);
    if (printer === undefined) {
      throw notFound('Printer was not found.');
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: 'vendor',
      action: 'vendor_printer.revoke',
      entityType: 'vendor_printer',
      entityId: printer.id,
      before: { name: printer.name, macAddress: printer.macAddress },
      metadata: { vendorId }
    });

    return printer;
  }

  async testPrint(actor: AuthenticatedActor, printerId: string): Promise<PrintJob> {
    const vendorId = await this.vendorIdFor(actor);
    await this.assertPrintingEnabled(actor);
    const printer = await this.repository.findPrinter(vendorId, printerId);
    if (printer === undefined) {
      throw notFound('Printer was not found.');
    }
    return this.repository.insertTestJob(vendorId);
  }

  async listJobs(
    actor: AuthenticatedActor,
    filters: { status?: PrintJobStatus; limit?: number }
  ): Promise<PrintJob[]> {
    const vendorId = await this.vendorIdFor(actor);
    return this.repository.listJobs(vendorId, {
      ...(filters.status === undefined ? {} : { status: filters.status }),
      limit: filters.limit ?? 50
    });
  }

  async getReceipt(actor: AuthenticatedActor, orderId: string): Promise<ReceiptView> {
    const vendorId = await this.vendorIdFor(actor);
    const receipt = await this.repository.findReceipt(vendorId, orderId);
    if (receipt === undefined) {
      throw notFound('Order was not found.');
    }
    return { receipt, text: renderReceipt(receipt, PREVIEW_WIDTH) };
  }

  async reprint(actor: AuthenticatedActor, orderId: string): Promise<PrintJob> {
    const vendorId = await this.vendorIdFor(actor);
    await this.assertPrintingEnabled(actor);

    const receipt = await this.repository.findReceipt(vendorId, orderId);
    if (receipt === undefined) {
      throw notFound('Order was not found.');
    }
    const printers = await this.repository.listPrinters(vendorId);
    if (printers.length === 0) {
      throw conflict('No printer is registered. Add a printer before reprinting.');
    }

    const job = await this.repository.requeueOrderJob(vendorId, orderId);

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: 'vendor',
      action: 'print_job.reprint',
      entityType: 'print_job',
      entityId: job.id,
      metadata: { vendorId, orderId }
    });

    return job;
  }

  private async vendorIdFor(actor: AuthenticatedActor): Promise<string> {
    if (actor.role !== 'vendor' || actor.vendorId === undefined || actor.vendorId.length === 0) {
      throw forbidden('Vendor access is required.');
    }
    if (!(await this.repository.hasVendorAccess(actor.vendorId, actor.userId))) {
      throw forbidden('Vendor access is required.');
    }
    return actor.vendorId;
  }

  private async assertPrintingEnabled(actor: AuthenticatedActor): Promise<void> {
    if (!(await this.flags.isEnabled(FeatureFlagKeys.CLOUD_PRINTING, subjectForActor(actor)))) {
      throw forbidden('Cloud printing is not enabled for this vendor yet.');
    }
  }
}
