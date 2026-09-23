import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/common/audit/audit.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import type { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service.js';
import { hashPrinterKey } from '../../src/modules/printing/printer-key.js';
import { PrintingService } from '../../src/modules/printing/printing.service.js';
import type {
  PrintJob,
  PrintingRepositoryContract,
  Receipt,
  VendorPrinter
} from '../../src/modules/printing/printing.types.js';

const vendorId = '11111111-1111-4111-8111-111111111111';
const userId = '33333333-3333-4333-8333-333333333333';
const printerId = '55555555-5555-4555-8555-555555555555';
const orderId = '44444444-4444-4444-8444-444444444444';
const actor: AuthenticatedActor = { userId, role: 'vendor', vendorId };
const server = { baseUrl: 'https://api.example.com', apiPrefix: 'v1' };

const printer: VendorPrinter = {
  id: printerId,
  vendorId,
  name: 'Kitchen',
  macAddress: '00:11:62:aa:bb:cc',
  paperWidthChars: 48,
  lastSeenAt: null,
  lastStatusCode: null,
  online: false,
  createdAt: '2026-09-23T00:00:00Z'
};

const job: PrintJob = {
  id: '66666666-6666-4666-8666-666666666666',
  vendorId,
  orderId,
  orderNumber: 'MD-1',
  kind: 'order',
  status: 'pending',
  printAfter: '2026-09-23T11:30:00Z',
  attempts: 0,
  printedAt: null,
  lastError: null,
  createdAt: '2026-09-23T10:00:00Z'
};

const receipt: Receipt = {
  orderId,
  orderNumber: 'MD-1',
  vendorDisplayName: 'Mama Put',
  serviceDate: '2026-09-23',
  deliveryTime: '13:00',
  deliverySlotName: 'Lunch',
  campusTimezone: 'Africa/Lagos',
  customerName: 'Ada',
  customerPhone: '0803',
  locationName: 'Moremi',
  roomNumber: null,
  deliveryMode: 'meal_direct_rider',
  specialInstructions: null,
  foodSubtotalKobo: 100000,
  paidAt: null,
  items: []
};

type Mocked = { [K in keyof PrintingRepositoryContract]: ReturnType<typeof vi.fn> };

function makeRepository(): Mocked {
  return {
    listPrinters: vi.fn().mockResolvedValue([printer]),
    findPrinter: vi.fn().mockResolvedValue(printer),
    insertPrinter: vi.fn().mockResolvedValue(printer),
    revokePrinter: vi.fn().mockResolvedValue(printer),
    rotatePrinterKey: vi.fn().mockResolvedValue(printer),
    findLivePrinterByKeyHash: vi.fn(),
    recordPrinterSeen: vi.fn(),
    listJobs: vi.fn().mockResolvedValue([job]),
    insertTestJob: vi.fn().mockResolvedValue({ ...job, kind: 'test', orderId: null }),
    requeueOrderJob: vi.fn().mockResolvedValue(job),
    claimJob: vi.fn(),
    findCurrentLease: vi.fn(),
    findLeasedJob: vi.fn(),
    completeJob: vi.fn(),
    findReceipt: vi.fn().mockResolvedValue(receipt),
    findVendorDisplayName: vi.fn(),
    hasVendorAccess: vi.fn().mockResolvedValue(true)
  };
}

describe('PrintingService', () => {
  let repository: Mocked;
  let flags: { isEnabled: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: PrintingService;

  beforeEach(() => {
    repository = makeRepository();
    flags = { isEnabled: vi.fn().mockResolvedValue(true) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new PrintingService(
      repository as unknown as PrintingRepositoryContract,
      flags as unknown as FeatureFlagsService,
      audit as unknown as AuditService
    );
  });

  it('rejects non-vendor actors and vendors without membership', async () => {
    await expect(service.listPrinters({ userId, role: 'customer' })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    repository.hasVendorAccess.mockResolvedValue(false);
    await expect(service.listPrinters(actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('registerPrinter', () => {
    it('stores only the key hash and returns the server URL once', async () => {
      const result = await service.registerPrinter(
        actor,
        { name: ' Kitchen ', macAddress: '00-11-62-AA-BB-CC' },
        server
      );

      const key = result.serverUrl.split('/').pop() ?? '';
      expect(result.serverUrl).toBe(`https://api.example.com/v1/printers/cloudprnt/${key}`);
      expect(repository.insertPrinter).toHaveBeenCalledWith({
        vendorId,
        name: 'Kitchen',
        macAddress: '00:11:62:aa:bb:cc',
        paperWidthChars: 48,
        keyHash: hashPrinterKey(key),
        createdBy: userId
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vendor_printer.register' })
      );
    });

    it('is blocked when cloud_printing is not enabled for the vendor (test mode)', async () => {
      flags.isEnabled.mockResolvedValue(false);
      await expect(
        service.registerPrinter(actor, { name: 'K', macAddress: '001162aabbcc' }, server)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(flags.isEnabled).toHaveBeenCalledWith('cloud_printing', { userId, vendorId });
      expect(repository.insertPrinter).not.toHaveBeenCalled();
    });

    it('rejects a malformed MAC', async () => {
      await expect(
        service.registerPrinter(actor, { name: 'K', macAddress: 'not-a-mac' }, server)
      ).rejects.toMatchObject({ status: 400 });
    });

    it('maps a duplicate MAC to 409', async () => {
      const duplicate = new DatabaseError('duplicate key', 0, 'error');
      duplicate.code = '23505';
      repository.insertPrinter.mockRejectedValue(duplicate);
      await expect(
        service.registerPrinter(actor, { name: 'K', macAddress: '001162aabbcc' }, server)
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('rotatePrinterKey returns a new URL and 404s for unknown printers', async () => {
    const result = await service.rotatePrinterKey(actor, printerId, server);
    expect(result.serverUrl).toContain('/v1/printers/cloudprnt/');
    repository.rotatePrinterKey.mockResolvedValue(undefined);
    await expect(service.rotatePrinterKey(actor, printerId, server)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('testPrint queues a sample job for an owned printer', async () => {
    await expect(service.testPrint(actor, printerId)).resolves.toMatchObject({ kind: 'test' });
    repository.findPrinter.mockResolvedValue(undefined);
    await expect(service.testPrint(actor, printerId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getReceipt returns data plus rendered text', async () => {
    const view = await service.getReceipt(actor, orderId);
    expect(view.receipt).toBe(receipt);
    expect(view.text).toContain('ORDER #MD-1');
    repository.findReceipt.mockResolvedValue(undefined);
    await expect(service.getReceipt(actor, orderId)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('reprint', () => {
    it('re-queues and audits', async () => {
      await expect(service.reprint(actor, orderId)).resolves.toBe(job);
      expect(repository.requeueOrderJob).toHaveBeenCalledWith(vendorId, orderId);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'print_job.reprint' })
      );
    });

    it('409s when the vendor has no printer', async () => {
      repository.listPrinters.mockResolvedValue([]);
      await expect(service.reprint(actor, orderId)).rejects.toBeInstanceOf(ConflictException);
      expect(repository.requeueOrderJob).not.toHaveBeenCalled();
    });

    it('404s for an order that is not the vendor’s', async () => {
      repository.findReceipt.mockResolvedValue(undefined);
      await expect(service.reprint(actor, orderId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('listJobs defaults the limit', async () => {
    await service.listJobs(actor, { status: 'failed' });
    expect(repository.listJobs).toHaveBeenCalledWith(vendorId, { status: 'failed', limit: 50 });
  });
});
