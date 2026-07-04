import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAdminPermissions } from '../../src/domain/admin-permissions.js';
import type { AdminPermissionsRepository } from '../../src/modules/auth/admin-permissions.repository.js';
import { PermissionsGuard } from '../../src/modules/auth/permissions.guard.js';

describe('resolveAdminPermissions', () => {
  it('grants everything to super admins regardless of memberships', () => {
    const perms = resolveAdminPermissions([], 'super_admin');
    expect(perms.has('admin:manage')).toBe(true);
    expect(perms.has('refunds:manage')).toBe(true);
  });

  it('limits finance admins to finance permissions', () => {
    const perms = resolveAdminPermissions(['finance_admin'], 'campus_admin');
    expect(perms.has('refunds:manage')).toBe(true);
    expect(perms.has('payments:verify')).toBe(true);
    expect(perms.has('settlements:manage')).toBe(true);
    expect(perms.has('vendors:manage')).toBe(false);
    expect(perms.has('admin:manage')).toBe(false);
  });

  it('limits readonly/support admins to read', () => {
    const readonly = resolveAdminPermissions(['readonly_admin'], 'campus_admin');
    expect([...readonly]).toEqual(['read']);

    const support = resolveAdminPermissions(['support_admin'], 'campus_admin');
    expect([...support]).toEqual(['read']);
  });

  it('unions permissions across multiple membership roles', () => {
    const perms = resolveAdminPermissions(['finance_admin', 'operations_admin'], 'campus_admin');
    expect(perms.has('refunds:manage')).toBe(true);
    expect(perms.has('riders:manage')).toBe(true);
  });

  it('falls back to the coarse campus_admin role when no memberships exist', () => {
    const perms = resolveAdminPermissions([], 'campus_admin');
    expect(perms.has('refunds:manage')).toBe(true);
    expect(perms.has('admin:manage')).toBe(false);
  });
});

function contextFor(actor: unknown, permission?: string): ExecutionContext {
  void permission; // permission requirement is driven via the mocked reflector, not the context
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    switchToHttp: () => ({ getRequest: () => ({ actor }) })
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let repository: AdminPermissionsRepository;
  let reflector: Reflector;
  let requiredPermission: string | undefined;

  function guardFor(): PermissionsGuard {
    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(requiredPermission)
    } as unknown as Reflector;
    return new PermissionsGuard(reflector, repository);
  }

  beforeEach(() => {
    repository = {
      listActiveRoles: vi.fn().mockResolvedValue(['finance_admin'])
    } as unknown as AdminPermissionsRepository;
    requiredPermission = undefined;
  });

  it('allows handlers with no permission requirement', async () => {
    await expect(
      guardFor().canActivate(contextFor({ role: 'campus_admin', userId: 'u1' }, undefined))
    ).resolves.toBe(true);
  });

  it('short-circuits super admins without a membership lookup', async () => {
    requiredPermission = 'admin:manage';
    await expect(
      guardFor().canActivate(contextFor({ role: 'super_admin', userId: 'u1' }, 'admin:manage'))
    ).resolves.toBe(true);
    expect(repository.listActiveRoles).not.toHaveBeenCalled();
  });

  it('allows a finance admin the refunds permission', async () => {
    requiredPermission = 'refunds:manage';
    await expect(
      guardFor().canActivate(contextFor({ role: 'campus_admin', userId: 'u1' }, 'refunds:manage'))
    ).resolves.toBe(true);
  });

  it('forbids a finance admin from an admin:manage action', async () => {
    requiredPermission = 'admin:manage';
    await expect(
      guardFor().canActivate(contextFor({ role: 'campus_admin', userId: 'u1' }, 'admin:manage'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids non-admin actors', async () => {
    requiredPermission = 'refunds:manage';
    await expect(
      guardFor().canActivate(contextFor({ role: 'customer', userId: 'u1' }, 'refunds:manage'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back to coarse-role permissions when the membership lookup fails', async () => {
    requiredPermission = 'refunds:manage';
    repository = {
      listActiveRoles: vi.fn().mockRejectedValue(new Error('db down'))
    } as unknown as AdminPermissionsRepository;
    // campus_admin fallback still includes refunds:manage, so availability is preserved.
    await expect(
      guardFor().canActivate(contextFor({ role: 'campus_admin', userId: 'u1' }, 'refunds:manage'))
    ).resolves.toBe(true);
  });

  it('does not escalate to admin:manage on a membership lookup failure', async () => {
    requiredPermission = 'admin:manage';
    repository = {
      listActiveRoles: vi.fn().mockRejectedValue(new Error('db down'))
    } as unknown as AdminPermissionsRepository;
    await expect(
      guardFor().canActivate(contextFor({ role: 'campus_admin', userId: 'u1' }, 'admin:manage'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
