import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service.js';
import { CloudPrntService } from '../../src/modules/printing/cloudprnt.service.js';
import { PrintingService } from '../../src/modules/printing/printing.service.js';
import type { VendorPrinter } from '../../src/modules/printing/printing.types.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const vendorId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const printerKey = 'A'.repeat(43);

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: {
      meal_direct_role: role,
      ...(role === 'vendor' ? { vendor_id: vendorId } : {})
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

const printer: VendorPrinter = {
  id: '55555555-5555-4555-8555-555555555555',
  vendorId,
  name: 'Kitchen',
  macAddress: '00:11:62:aa:bb:cc',
  paperWidthChars: 48,
  lastSeenAt: null,
  lastStatusCode: null,
  online: false,
  createdAt: '2026-09-23T00:00:00Z'
};

describe('printing API', () => {
  let app: NestFastifyApplication;
  let cloudPrnt: CloudPrntService;
  let printing: PrintingService;
  let flags: FeatureFlagsService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    cloudPrnt = app.get(CloudPrntService);
    printing = app.get(PrintingService);
    flags = app.get(FeatureFlagsService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('CloudPRNT device endpoint (no JWT)', () => {
    it('accepts the printer poll with arbitrary firmware fields and returns raw JSON', async () => {
      const poll = vi
        .spyOn(cloudPrnt, 'poll')
        .mockResolvedValue({ jobReady: true, mediaTypes: ['text/plain'], jobToken: 'abc' });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/printers/cloudprnt/${printerKey}`,
        payload: {
          status: '23 86 00 00 00 00 00 00 00',
          printerMAC: '00:11:62:aa:bb:cc',
          statusCode: '200%20OK',
          printingInProgress: false,
          clientAction: null,
          someFutureField: 1
        }
      });

      expect(response.statusCode).toBe(200);
      // Not wrapped in the {data} envelope: CloudPRNT reads jobReady at the top level.
      expect(response.json()).toEqual({
        jobReady: true,
        mediaTypes: ['text/plain'],
        jobToken: 'abc'
      });
      expect(poll).toHaveBeenCalledWith(
        printerKey,
        expect.objectContaining({ printerMAC: '00:11:62:aa:bb:cc', someFutureField: 1 })
      );
    });

    it('serves the job as text/plain', async () => {
      vi.spyOn(cloudPrnt, 'fetchJob').mockResolvedValue({
        contentType: 'text/plain',
        body: 'ORDER #MD-1\n'
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/printers/cloudprnt/${printerKey}?mac=00%3A11%3A62%3Aaa%3Abb%3Acc&type=text%2Fplain&token=abc`
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toBe('ORDER #MD-1\n');
    });

    it('passes the DELETE result code through', async () => {
      const ack = vi.spyOn(cloudPrnt, 'acknowledge').mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/printers/cloudprnt/${printerKey}?mac=00%3A11%3A62%3Aaa%3Abb%3Acc&code=200%20OK&token=abc`
      });

      expect(response.statusCode).toBe(200);
      expect(ack).toHaveBeenCalledWith(
        printerKey,
        expect.objectContaining({ code: '200 OK', token: 'abc' })
      );
    });

    it('404s an unknown key end-to-end without a JWT', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/printers/cloudprnt/not-a-real-key',
        payload: {}
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('vendor printer management', () => {
    it('requires a vendor JWT', async () => {
      const anonymous = await app.inject({ method: 'GET', url: '/v1/vendor/printers' });
      expect(anonymous.statusCode).toBe(401);

      const customer = await app.inject({
        method: 'GET',
        url: '/v1/vendor/printers',
        headers: { authorization: `Bearer ${await signToken('customer')}` }
      });
      expect(customer.statusCode).toBe(403);
    });

    it('validates the register body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vendor/printers',
        headers: { authorization: `Bearer ${await signToken('vendor')}` },
        payload: { name: '', macAddress: 'x', unexpected: true }
      });
      expect(response.statusCode).toBe(400);
    });

    it('registers a printer and returns the one-time server URL', async () => {
      const register = vi.spyOn(printing, 'registerPrinter').mockResolvedValue({
        printer,
        serverUrl: 'http://localhost:80/v1/printers/cloudprnt/KEY'
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vendor/printers',
        headers: { authorization: `Bearer ${await signToken('vendor')}` },
        payload: { name: 'Kitchen', macAddress: '00:11:62:AA:BB:CC', paperWidthChars: 32 }
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ data: { printer: { id: printer.id } } });
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({ vendorId, userId }),
        { name: 'Kitchen', macAddress: '00:11:62:AA:BB:CC', paperWidthChars: 32 },
        expect.objectContaining({ apiPrefix: 'v1' })
      );
    });

    it('rejects an invalid print-job status filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/vendor/print-jobs?status=bogus',
        headers: { authorization: `Bearer ${await signToken('vendor')}` }
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('feature flags', () => {
    it('returns the caller’s resolved flags', async () => {
      vi.spyOn(flags, 'enabledFlagsFor').mockResolvedValue({ cloud_printing: true });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/me/feature-flags',
        headers: { authorization: `Bearer ${await signToken('vendor')}` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: { cloud_printing: true } });
    });

    it('keeps admin flag endpoints away from non-admins', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/feature-flags/cloud_printing',
        headers: { authorization: `Bearer ${await signToken('vendor')}` },
        payload: { mode: 'on' }
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
