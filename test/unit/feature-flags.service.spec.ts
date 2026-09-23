import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/common/audit/audit.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';
import {
  FeatureFlagsService,
  subjectForActor
} from '../../src/modules/feature-flags/feature-flags.service.js';
import type {
  FeatureFlag,
  FeatureFlagsRepositoryContract
} from '../../src/modules/feature-flags/feature-flags.types.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const vendorId = '22222222-2222-4222-8222-222222222222';
const admin: AuthenticatedActor = { userId: adminId, role: 'super_admin' };

function flag(mode: FeatureFlag['mode'], key = 'cloud_printing'): FeatureFlag {
  return { key, mode, description: null, updatedAt: '2026-09-23T00:00:00Z' };
}

function makeRepository(): {
  [K in keyof FeatureFlagsRepositoryContract]: ReturnType<typeof vi.fn>;
} {
  return {
    listFlags: vi.fn(),
    findFlag: vi.fn(),
    updateFlagMode: vi.fn(),
    isTester: vi.fn(),
    listTesters: vi.fn(),
    addTester: vi.fn(),
    removeTester: vi.fn(),
    subjectExists: vi.fn()
  };
}

describe('FeatureFlagsService', () => {
  let repository: ReturnType<typeof makeRepository>;
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: FeatureFlagsService;

  beforeEach(() => {
    repository = makeRepository();
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new FeatureFlagsService(
      repository as unknown as FeatureFlagsRepositoryContract,
      audit as unknown as AuditService
    );
  });

  describe('isEnabled', () => {
    it('on → enabled for everyone without a tester lookup', async () => {
      repository.findFlag.mockResolvedValue(flag('on'));
      await expect(service.isEnabled('cloud_printing', { vendorId })).resolves.toBe(true);
      expect(repository.isTester).not.toHaveBeenCalled();
    });

    it('off → disabled even for testers', async () => {
      repository.findFlag.mockResolvedValue(flag('off'));
      repository.isTester.mockResolvedValue(true);
      await expect(service.isEnabled('cloud_printing', { vendorId })).resolves.toBe(false);
    });

    it('test → enabled only for testers', async () => {
      repository.findFlag.mockResolvedValue(flag('test'));
      repository.isTester.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await expect(service.isEnabled('cloud_printing', { vendorId })).resolves.toBe(true);
      await expect(service.isEnabled('cloud_printing', { vendorId })).resolves.toBe(false);
      expect(repository.isTester).toHaveBeenCalledWith({ vendorId });
    });

    it('test with no subject → disabled', async () => {
      repository.findFlag.mockResolvedValue(flag('test'));
      await expect(service.isEnabled('cloud_printing', {})).resolves.toBe(false);
      expect(repository.isTester).not.toHaveBeenCalled();
    });

    it('unknown key reads as off', async () => {
      repository.findFlag.mockResolvedValue(undefined);
      await expect(service.isEnabled('nope', { vendorId })).resolves.toBe(false);
    });

    it('fails closed on database errors', async () => {
      repository.findFlag.mockRejectedValue(new Error('db down'));
      await expect(service.isEnabled('cloud_printing', { vendorId })).resolves.toBe(false);
    });
  });

  it('resolves all flags for a subject with a single tester lookup', async () => {
    repository.listFlags.mockResolvedValue([flag('on', 'a'), flag('test', 'b'), flag('off', 'c')]);
    repository.isTester.mockResolvedValue(true);
    await expect(service.enabledFlagsFor({ userId: adminId })).resolves.toEqual({
      a: true,
      b: true,
      c: false
    });
    expect(repository.isTester).toHaveBeenCalledTimes(1);
  });

  it('builds the subject from the actor, including the vendor', () => {
    expect(subjectForActor({ userId: adminId, role: 'vendor', vendorId })).toEqual({
      userId: adminId,
      vendorId
    });
    expect(subjectForActor(admin)).toEqual({ userId: adminId });
  });

  it('setMode updates and audits before/after', async () => {
    repository.findFlag.mockResolvedValue(flag('test'));
    repository.updateFlagMode.mockResolvedValue(flag('on'));
    await expect(service.setMode(admin, 'cloud_printing', 'on')).resolves.toMatchObject({
      mode: 'on'
    });
    expect(repository.updateFlagMode).toHaveBeenCalledWith('cloud_printing', 'on', adminId);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feature_flag.update',
        before: { mode: 'test' },
        after: { mode: 'on' }
      })
    );
  });

  it('setMode 404s on an unknown key', async () => {
    repository.findFlag.mockResolvedValue(undefined);
    await expect(service.setMode(admin, 'nope', 'on')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateFlagMode).not.toHaveBeenCalled();
  });

  it('addTester rejects a subject that does not exist', async () => {
    repository.subjectExists.mockResolvedValue(false);
    await expect(service.addTester(admin, 'vendor', vendorId, undefined)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(repository.addTester).not.toHaveBeenCalled();
  });

  it('addTester inserts and audits', async () => {
    repository.subjectExists.mockResolvedValue(true);
    repository.addTester.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      subjectType: 'vendor',
      subjectId: vendorId,
      note: 'pilot',
      createdAt: '2026-09-23T00:00:00Z'
    });
    await service.addTester(admin, 'vendor', vendorId, 'pilot');
    expect(repository.addTester).toHaveBeenCalledWith('vendor', vendorId, 'pilot', adminId);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feature_tester.add' })
    );
  });

  it('removeTester 404s when missing', async () => {
    repository.removeTester.mockResolvedValue(undefined);
    await expect(
      service.removeTester(admin, '33333333-3333-4333-8333-333333333333')
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
