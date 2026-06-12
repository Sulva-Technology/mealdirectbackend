import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';

import { RequireRoles } from '../../src/modules/auth/roles.decorator.js';
import { RolesGuard } from '../../src/modules/auth/roles.guard.js';

class ProtectedHandlers {
  @RequireRoles('super_admin')
  superAdminOnly(): void {
    return undefined;
  }

  publicRoute(): void {
    return undefined;
  }
}

function contextFor(handlerName: keyof ProtectedHandlers, actor: unknown): ExecutionContext {
  return {
    getHandler: () => ProtectedHandlers.prototype[handlerName],
    getClass: () => ProtectedHandlers,
    switchToHttp: () => ({
      getRequest: () => ({ actor })
    })
  } as unknown as ExecutionContext;
}

describe('RBAC guard', () => {
  it('allows routes without role metadata', () => {
    const guard = new RolesGuard(new Reflector());

    expect(guard.canActivate(contextFor('publicRoute', undefined))).toBe(true);
  });

  it('allows actors with a required role', () => {
    const guard = new RolesGuard(new Reflector());

    expect(
      guard.canActivate(
        contextFor('superAdminOnly', {
          userId: 'user-1',
          role: 'super_admin'
        })
      )
    ).toBe(true);
  });

  it('rejects actors without a required role', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(
        contextFor('superAdminOnly', {
          userId: 'user-1',
          role: 'customer'
        })
      )
    ).toThrow('Insufficient permissions');
  });
});
