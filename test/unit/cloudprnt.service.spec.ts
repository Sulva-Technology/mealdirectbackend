import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service.js';
import {
  CloudPrntService,
  PRINT_LEASE_SECONDS,
  PRINT_MAX_ATTEMPTS,
  PRINT_WINDOW_HOURS,
  decodeStatusCode,
  isSuccessCode
} from '../../src/modules/printing/cloudprnt.service.js';
import { generatePrinterKey, hashPrinterKey } from '../../src/modules/printing/printer-key.js';
import type {
  AuthenticatedPrinter,
  PrintingRepositoryContract,
  Receipt
} from '../../src/modules/printing/printing.types.js';

const vendorId = '11111111-1111-4111-8111-111111111111';
const printerId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';
const orderId = '44444444-4444-4444-8444-444444444444';
const key = generatePrinterKey();

const printer: AuthenticatedPrinter = {
  id: printerId,
  vendorId,
  macAddress: '00:11:62:aa:bb:cc',
  paperWidthChars: 32
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
  roomNumber: 'B2',
  deliveryMode: 'meal_direct_rider',
  specialInstructions: null,
  foodSubtotalKobo: 100000,
  paidAt: null,
  items: []
};

type Mocked = Partial<Record<keyof PrintingRepositoryContract, ReturnType<typeof vi.fn>>>;

describe('CloudPRNT helpers', () => {
  it('decodes URL-encoded status codes', () => {
    expect(decodeStatusCode('200%20OK')).toBe('200 OK');
    expect(decodeStatusCode('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodeStatusCode(undefined)).toBeNull();
  });

  it('treats only 2xx as success', () => {
    expect(isSuccessCode('200 OK')).toBe(true);
    expect(isSuccessCode('211 Printed with warnings')).toBe(true);
    expect(isSuccessCode('520 Paper empty')).toBe(false);
    expect(isSuccessCode(null)).toBe(false);
  });
});

describe('CloudPrntService', () => {
  let repository: Mocked;
  let flags: { isEnabled: ReturnType<typeof vi.fn> };
  let service: CloudPrntService;

  beforeEach(() => {
    repository = {
      findLivePrinterByKeyHash: vi.fn().mockResolvedValue(printer),
      recordPrinterSeen: vi.fn().mockResolvedValue(undefined),
      claimJob: vi.fn().mockResolvedValue(jobId),
      findCurrentLease: vi.fn().mockResolvedValue(jobId),
      findLeasedJob: vi.fn().mockResolvedValue({ id: jobId, kind: 'order', orderId }),
      findReceipt: vi.fn().mockResolvedValue(receipt),
      findVendorDisplayName: vi.fn().mockResolvedValue('Mama Put'),
      completeJob: vi.fn().mockResolvedValue('printed')
    };
    flags = { isEnabled: vi.fn().mockResolvedValue(true) };
    service = new CloudPrntService(
      repository as unknown as PrintingRepositoryContract,
      flags as unknown as FeatureFlagsService
    );
  });

  describe('authentication', () => {
    it('looks printers up by key hash', async () => {
      await service.poll(key, { printerMAC: '00:11:62:AA:BB:CC' });
      expect(repository.findLivePrinterByKeyHash).toHaveBeenCalledWith(hashPrinterKey(key));
    });

    it('404s a malformed key without querying', async () => {
      await expect(service.poll('bad', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findLivePrinterByKeyHash).not.toHaveBeenCalled();
    });

    it('404s an unknown or revoked key', async () => {
      repository.findLivePrinterByKeyHash?.mockResolvedValue(undefined);
      await expect(service.poll(key, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a MAC mismatch (key copied to another device)', async () => {
      await expect(service.poll(key, { printerMAC: '00:11:62:00:00:01' })).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(repository.recordPrinterSeen).not.toHaveBeenCalled();
    });
  });

  describe('poll', () => {
    it('announces a claimed job and records the heartbeat', async () => {
      await expect(
        service.poll(key, { printerMAC: '00:11:62:aa:bb:cc', statusCode: '200%20OK' })
      ).resolves.toEqual({ jobReady: true, mediaTypes: ['text/plain'], jobToken: jobId });
      expect(repository.recordPrinterSeen).toHaveBeenCalledWith(printerId, '200 OK');
      expect(repository.claimJob).toHaveBeenCalledWith(
        printerId,
        PRINT_LEASE_SECONDS,
        PRINT_WINDOW_HOURS
      );
    });

    it('returns jobReady false when nothing is due', async () => {
      repository.claimJob?.mockResolvedValue(null);
      await expect(service.poll(key, {})).resolves.toEqual({ jobReady: false });
    });

    it('does not claim while the printer is busy', async () => {
      await expect(service.poll(key, { printingInProgress: true })).resolves.toEqual({
        jobReady: false
      });
      expect(repository.claimJob).not.toHaveBeenCalled();
    });

    it('does not claim when cloud_printing is off for the vendor (test mode)', async () => {
      flags.isEnabled.mockResolvedValue(false);
      await expect(service.poll(key, {})).resolves.toEqual({ jobReady: false });
      expect(flags.isEnabled).toHaveBeenCalledWith('cloud_printing', { vendorId });
      expect(repository.claimJob).not.toHaveBeenCalled();
      // Heartbeat still recorded so the vendor sees the printer online.
      expect(repository.recordPrinterSeen).toHaveBeenCalled();
    });
  });

  describe('fetchJob', () => {
    it('renders the leased order ticket at the printer width', async () => {
      const job = await service.fetchJob(key, { mac: '00:11:62:aa:bb:cc', token: jobId });
      expect(job.contentType).toBe('text/plain');
      expect(job.body).toContain('ORDER #MD-1');
      for (const line of job.body.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(32);
      }
      expect(repository.findLeasedJob).toHaveBeenCalledWith(printerId, jobId);
      expect(repository.findReceipt).toHaveBeenCalledWith(vendorId, orderId);
    });

    it('renders a test ticket', async () => {
      repository.findLeasedJob?.mockResolvedValue({ id: jobId, kind: 'test', orderId: null });
      const job = await service.fetchJob(key, { token: jobId });
      expect(job.body).toContain('TEST PRINT');
      expect(repository.findReceipt).not.toHaveBeenCalled();
    });

    it('falls back to the live lease when firmware omits the token', async () => {
      await service.fetchJob(key, {});
      expect(repository.findCurrentLease).toHaveBeenCalledWith(printerId, PRINT_LEASE_SECONDS);
      expect(repository.claimJob).not.toHaveBeenCalled();
    });

    it('404s a token the printer does not hold', async () => {
      repository.findLeasedJob?.mockResolvedValue(undefined);
      await expect(service.fetchJob(key, { token: jobId })).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('404s a malformed token without querying', async () => {
      await expect(service.fetchJob(key, { token: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findLeasedJob).not.toHaveBeenCalled();
    });

    it('fails the job when the order is gone', async () => {
      repository.findReceipt?.mockResolvedValue(undefined);
      await expect(service.fetchJob(key, { token: jobId })).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(repository.completeJob).toHaveBeenCalledWith(
        jobId,
        printerId,
        false,
        'Order not found',
        1
      );
    });
  });

  describe('acknowledge', () => {
    it('marks printed on a 2xx code', async () => {
      await service.acknowledge(key, { token: jobId, code: '200%20OK' });
      expect(repository.completeJob).toHaveBeenCalledWith(
        jobId,
        printerId,
        true,
        null,
        PRINT_MAX_ATTEMPTS
      );
    });

    it('re-queues with the printer error on a non-2xx code', async () => {
      repository.completeJob?.mockResolvedValue('pending');
      await service.acknowledge(key, { token: jobId, code: '520 Paper empty' });
      expect(repository.completeJob).toHaveBeenCalledWith(
        jobId,
        printerId,
        false,
        '520 Paper empty',
        PRINT_MAX_ATTEMPTS
      );
    });

    it('never claims a new job when the token is missing and no lease is live', async () => {
      repository.findCurrentLease?.mockResolvedValue(null);
      await expect(service.acknowledge(key, { code: '200 OK' })).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(repository.claimJob).not.toHaveBeenCalled();
      expect(repository.completeJob).not.toHaveBeenCalled();
    });
  });
});
