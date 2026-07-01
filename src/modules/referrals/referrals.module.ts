import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ReferralsAdminController } from './referrals.admin.controller.js';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsRepository } from './referrals.repository.js';
import { ReferralsService } from './referrals.service.js';

@Module({
  imports: [AuthModule, ProfilesModule],
  controllers: [ReferralsController, ReferralsAdminController],
  providers: [ReferralsRepository, ReferralsService]
})
export class ReferralsModule {}
