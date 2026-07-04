import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { resolveAdminPermissions, type AdminPermission } from '../../domain/admin-permissions.js';
import { AdminPermissionsRepository } from './admin-permissions.repository.js';
import { requiredPermissionMetadataKey } from './permission.decorator.js';

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCodes.FORBIDDEN, message });
}

/**
 * Enforces @RequirePermission by resolving the actor's granular admin permissions from
 * public.admin_memberships. Runs after JwtAuthGuard + RolesGuard, so the actor is already a
 * super_admin/campus_admin JWT; this narrows WHICH sensitive actions they may perform.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminPermissionsRepository) private readonly repository: AdminPermissionsRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AdminPermission | undefined>(
      requiredPermissionMetadataKey,
      [context.getHandler(), context.getClass()]
    );
    if (required === undefined) {
      return true;
    }

    const actor = context.switchToHttp().getRequest<FastifyRequest>().actor;
    if (actor === undefined) {
      throw forbidden('Authentication is required.');
    }
    if (actor.role !== 'super_admin' && actor.role !== 'campus_admin') {
      throw forbidden('Admin access is required.');
    }

    // Super admins bypass the membership lookup entirely.
    if (actor.role === 'super_admin') {
      return true;
    }

    // If the membership lookup fails (e.g. DB blip), fall back to the coarse JWT role's
    // default permissions rather than 500ing every admin action. This never grants more
    // than the coarse role (campus_admin), so it cannot escalate privilege.
    let membershipRoles: Awaited<ReturnType<AdminPermissionsRepository['listActiveRoles']>>;
    try {
      membershipRoles = await this.repository.listActiveRoles(actor.userId);
    } catch (error) {
      this.logger.warn(
        `admin_memberships lookup failed for ${actor.userId}; falling back to coarse role: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
      membershipRoles = [];
    }
    const permissions = resolveAdminPermissions(membershipRoles, actor.role);
    if (permissions.has(required)) {
      return true;
    }

    throw forbidden(`Missing required admin permission: ${required}`);
  }
}
