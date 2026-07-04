import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AdminPermissionsRepository } from './admin-permissions.repository.js';
import { AuthController } from './auth.controller.js';
import { AuthRoleGrantsRepository } from './auth-role-grants.repository.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RolesGuard } from './roles.guard.js';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { SupabaseJwtService } from './supabase-jwt.service.js';
import { VendorInvitationsRepository } from './vendor-invitations.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    AdminPermissionsRepository,
    AuthRoleGrantsRepository,
    SupabaseJwtService,
    SupabaseAuthService,
    VendorInvitationsRepository
  ],
  exports: [
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    AdminPermissionsRepository,
    AuthRoleGrantsRepository,
    SupabaseJwtService,
    SupabaseAuthService,
    VendorInvitationsRepository
  ]
})
export class AuthModule {}
