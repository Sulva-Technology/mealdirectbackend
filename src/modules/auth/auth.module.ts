import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { SupabaseJwtService } from './supabase-jwt.service.js';

@Module({
  controllers: [AuthController],
  providers: [JwtAuthGuard, RolesGuard, SupabaseJwtService],
  exports: [JwtAuthGuard, RolesGuard, SupabaseJwtService]
})
export class AuthModule {}
