import { Body, Controller, Delete, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PushChannel } from '../../notifications/channels/push.channel.js';
import { DeviceTokensRepository } from './device-tokens.repository.js';
import { RegisterDeviceTokenDto } from './dto/device-token.dto.js';

@ApiTags('notifications')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('me/device-tokens')
@UseGuards(JwtAuthGuard)
export class DeviceTokensController {
  constructor(
    @Inject(DeviceTokensRepository) private readonly repository: DeviceTokensRepository,
    @Inject(PushChannel) private readonly push: PushChannel
  ) {}

  @Post()
  @HttpCode(204)
  @ApiBody({ type: RegisterDeviceTokenDto })
  @ApiNoContentResponse({
    description: 'Registers (or refreshes) a push device token for the current user.'
  })
  async register(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() dto: RegisterDeviceTokenDto
  ): Promise<void> {
    await this.repository.register(actor.userId, dto.token, dto.platform);
  }

  @Post('test')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'Sends a test push notification to all active tokens for the current user.'
  })
  async test(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await this.push.deliverToUser(actor.userId, {
      to: actor.userId,
      title: 'Meal Direct test notification',
      body: 'Push notifications are connected.',
      linkPath: '/notifications'
    });
  }

  @Delete(':token')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Unregisters a push device token for the current user.' })
  async remove(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('token') token: string
  ): Promise<void> {
    await this.repository.remove(actor.userId, token);
  }
}
