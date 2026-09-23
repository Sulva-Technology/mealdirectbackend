import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { FeatureFlagKeys } from '../feature-flags/feature-flags.types.js';
import { hashPrinterKey, isWellFormedPrinterKey, normalizeMacAddress } from './printer-key.js';
import { PrintingRepository } from './printing.repository.js';
import type { AuthenticatedPrinter, PrintingRepositoryContract } from './printing.types.js';
import { renderReceipt, renderTestReceipt } from './receipt.renderer.js';

// Star CloudPRNT server side. The printer POSTs status (poll), GETs the job, then DELETEs to
// report the result. See docs/superpowers/specs/2026-09-23-cloud-printing-and-test-mode-design.md.

/** A leased job not acknowledged within this window is handed out again. */
export const PRINT_LEASE_SECONDS = 120;
/** Jobs whose print time is older than this never auto-print (vendor uses Reprint). */
export const PRINT_WINDOW_HOURS = 12;
/** Non-2xx printer results before a job is marked failed. */
export const PRINT_MAX_ATTEMPTS = 5;

export const CLOUDPRNT_MEDIA_TYPE = 'text/plain';

export type CloudPrntPollResponse = {
  jobReady: boolean;
  mediaTypes?: string[];
  jobToken?: string;
};

export type CloudPrntJob = {
  contentType: string;
  body: string;
};

function printerNotFound(): NotFoundException {
  return new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Printer not found.' });
}

function jobNotFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'No print job for this token.'
  });
}

/** CloudPRNT sends statusCode URL-encoded ("200%20OK"); decode defensively. */
export function decodeStatusCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // keep the raw value
  }
  return decoded.slice(0, 100);
}

export function isSuccessCode(code: string | null): boolean {
  return code !== null && /^2\d\d\b/.test(code.trim());
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class CloudPrntService {
  private readonly logger = new Logger(CloudPrntService.name);

  constructor(
    @Inject(PrintingRepository) private readonly repository: PrintingRepositoryContract,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {}

  async poll(key: string, body: Record<string, unknown>): Promise<CloudPrntPollResponse> {
    const printer = await this.authenticate(key, stringField(body, 'printerMAC'));
    await this.repository.recordPrinterSeen(printer.id, decodeStatusCode(body.statusCode));

    if (body.printingInProgress === true) {
      return { jobReady: false };
    }
    if (
      !(await this.flags.isEnabled(FeatureFlagKeys.CLOUD_PRINTING, { vendorId: printer.vendorId }))
    ) {
      return { jobReady: false };
    }

    const jobId = await this.repository.claimJob(
      printer.id,
      PRINT_LEASE_SECONDS,
      PRINT_WINDOW_HOURS
    );
    if (jobId === null) {
      return { jobReady: false };
    }
    return { jobReady: true, mediaTypes: [CLOUDPRNT_MEDIA_TYPE], jobToken: jobId };
  }

  async fetchJob(key: string, query: Record<string, unknown>): Promise<CloudPrntJob> {
    const printer = await this.authenticate(key, stringField(query, 'mac'));
    const job = await this.leasedJob(printer, stringField(query, 'token'));

    if (job.kind === 'test') {
      const vendorName =
        (await this.repository.findVendorDisplayName(printer.vendorId)) ?? 'Vendor';
      return {
        contentType: CLOUDPRNT_MEDIA_TYPE,
        body: renderTestReceipt(vendorName, printer.paperWidthChars, new Date())
      };
    }

    const receipt =
      job.orderId === null
        ? undefined
        : await this.repository.findReceipt(printer.vendorId, job.orderId);
    if (receipt === undefined) {
      // The order vanished from the vendor's view; fail the job instead of printing nothing.
      await this.repository.completeJob(job.id, printer.id, false, 'Order not found', 1);
      throw jobNotFound();
    }
    return {
      contentType: CLOUDPRNT_MEDIA_TYPE,
      body: renderReceipt(receipt, printer.paperWidthChars)
    };
  }

  async acknowledge(key: string, query: Record<string, unknown>): Promise<void> {
    const printer = await this.authenticate(key, stringField(query, 'mac'));
    const job = await this.leasedJob(printer, stringField(query, 'token'));
    const code = decodeStatusCode(query.code);
    const success = isSuccessCode(code);

    const status = await this.repository.completeJob(
      job.id,
      printer.id,
      success,
      success ? null : (code ?? 'Printer reported no status code'),
      PRINT_MAX_ATTEMPTS
    );
    if (!success) {
      this.logger.warn(
        `Print job ${job.id} failed on printer ${printer.id}: ${code ?? 'no code'} → ${status ?? 'lost lease'}`
      );
    }
  }

  private async authenticate(
    key: string,
    reportedMac: string | undefined
  ): Promise<AuthenticatedPrinter> {
    if (!isWellFormedPrinterKey(key)) {
      throw printerNotFound();
    }
    const printer = await this.repository.findLivePrinterByKeyHash(hashPrinterKey(key));
    if (printer === undefined) {
      throw printerNotFound();
    }
    // The key is the credential; the MAC binds it to one physical device. A missing MAC is
    // tolerated (some clients omit it on GET/DELETE), a mismatching one is not.
    if (reportedMac !== undefined && reportedMac.length > 0) {
      const mac = normalizeMacAddress(reportedMac);
      if (mac !== printer.macAddress) {
        throw printerNotFound();
      }
    }
    return printer;
  }

  private async leasedJob(printer: AuthenticatedPrinter, token: string | undefined) {
    // Older CloudPRNT firmware ignores jobToken and GETs/DELETEs without it; fall back to the
    // printer's own live lease (the job its last poll announced). Never claims a new job.
    const jobId =
      token === undefined || token.length === 0
        ? await this.repository.findCurrentLease(printer.id, PRINT_LEASE_SECONDS)
        : token;
    if (
      jobId === null ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)
    ) {
      throw jobNotFound();
    }
    const job = await this.repository.findLeasedJob(printer.id, jobId);
    if (job === undefined) {
      throw jobNotFound();
    }
    return job;
  }
}
