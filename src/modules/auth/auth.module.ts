import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { SupabaseJwtService } from './supabase-jwt.service.js';

@Module({
  controllers: [AuthController],
  providers: [JwtAuthGuard, RolesGuard, SupabaseJwtService, SupabaseAuthService],
  exports: [JwtAuthGuard, RolesGuard, SupabaseJwtService, SupabaseAuthService]
})
export class AuthModule {}
