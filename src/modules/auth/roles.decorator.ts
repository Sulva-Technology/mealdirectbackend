import { SetMetadata } from '@nestjs/common';

import type { ActorRole } from '../../domain/authorization.js';

export const requiredRolesMetadataKey = 'mealDirect:requiredRoles';

export function RequireRoles(...roles: ActorRole[]): ReturnType<typeof SetMetadata> {
  return SetMetadata(requiredRolesMetadataKey, roles);
}
