import { SetMetadata } from '@nestjs/common';

import type { AdminPermission } from '../../domain/admin-permissions.js';

export const requiredPermissionMetadataKey = 'mealDirect:requiredPermission';

/**
 * Require a granular admin permission on a handler. Enforced by PermissionsGuard, which
 * resolves the actor's permissions from public.admin_memberships. Apply AFTER RolesGuard
 * so only admin JWTs reach the permission check.
 */
export function RequirePermission(permission: AdminPermission): ReturnType<typeof SetMetadata> {
  return SetMetadata(requiredPermissionMetadataKey, permission);
}
