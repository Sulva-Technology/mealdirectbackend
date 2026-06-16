import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  MarkAllNotificationsReadEnvelopeDto,
  NotificationEnvelopeDto,
  NotificationIdParamDto,
  NotificationListEnvelopeDto,
  NotificationListQueryDto,
  NotificationPreferencesEnvelopeDto,
  UpdateNotificationPreferencesDto
} from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';
import type {
  MarkAllReadResult,
  NotificationPreferences,
  NotificationRecord
} from './notifications.types.js';

@ApiTags('notifications')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Current user notification feed.',
    type: NotificationListEnvelopeDto
  })
  async listNotifications(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: NotificationListQueryDto
  ): Promise<ListEnvelope<NotificationRecord>> {
    const page = await this.notifications.listNotifications(actor, query);
    return createListEnvelope(page.items, page.pagination);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Marks all current user notifications as read.',
    type: MarkAllNotificationsReadEnvelopeDto
  })
  async markAllRead(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<MarkAllReadResult>> {
    return createSuccessEnvelope(await this.notifications.markAllRead(actor));
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  @ApiParam({ format: 'uuid', name: 'notificationId', type: String })
  @ApiOkResponse({
    description: 'Marks one current user notification as read.',
    type: NotificationEnvelopeDto
  })
  async markRead(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: NotificationIdParamDto
  ): Promise<SuccessEnvelope<NotificationRecord>> {
    return createSuccessEnvelope(await this.notifications.markRead(actor, params.notificationId));
  }

  @Get('preferences')
  @ApiOkResponse({
    description: 'Current user notification preferences.',
    type: NotificationPreferencesEnvelopeDto
  })
  async getPreferences(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<NotificationPreferences>> {
    return createSuccessEnvelope(await this.notifications.getPreferences(actor));
  }

  @Put('preferences')
  @ApiOkResponse({
    description: 'Updated current user notification preferences.',
    type: NotificationPreferencesEnvelopeDto
  })
  async updatePreferences(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: UpdateNotificationPreferencesDto
  ): Promise<SuccessEnvelope<NotificationPreferences>> {
    return createSuccessEnvelope(await this.notifications.updatePreferences(actor, input));
  }
}
