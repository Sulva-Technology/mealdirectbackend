import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CursorPaginationQueryDto } from '../../../common/dto/api-contract.dto.js';
import { IsDatabaseUuid } from '../../../common/validation.js';

export class NotificationIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  notificationId!: string;
}

export class NotificationListQueryDto extends CursorPaginationQueryDto {}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  orderUpdates?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  paymentUpdates?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  deliveryUpdates?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  escalationUpdates?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  settlementUpdates?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  batchChatEnabled?: boolean;
}

export class NotificationRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  recipientUserId!: string;

  @ApiProperty({ type: String })
  eventType!: string;

  @ApiProperty({ type: String })
  aggregateType!: string;

  @ApiProperty({ format: 'uuid', type: String })
  aggregateId!: string;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String })
  body!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  linkPath!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  readAt!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class NotificationListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => NotificationRecordDto })
  data!: NotificationRecordDto[];
}

export class NotificationEnvelopeDto {
  @ApiProperty({ type: () => NotificationRecordDto })
  data!: NotificationRecordDto;
}

export class MarkAllNotificationsReadDto {
  @ApiProperty({ type: Number })
  updatedCount!: number;
}

export class MarkAllNotificationsReadEnvelopeDto {
  @ApiProperty({ type: () => MarkAllNotificationsReadDto })
  data!: MarkAllNotificationsReadDto;
}

export class NotificationPreferencesDto {
  @ApiProperty({ format: 'uuid', type: String })
  userId!: string;

  @ApiProperty({ type: Boolean })
  inAppEnabled!: boolean;

  @ApiProperty({ type: Boolean })
  pushEnabled!: boolean;

  @ApiProperty({ type: Boolean })
  emailEnabled!: boolean;

  @ApiProperty({ type: Boolean })
  orderUpdates!: boolean;

  @ApiProperty({ type: Boolean })
  paymentUpdates!: boolean;

  @ApiProperty({ type: Boolean })
  deliveryUpdates!: boolean;

  @ApiProperty({ type: Boolean })
  escalationUpdates!: boolean;

  @ApiProperty({ type: Boolean })
  settlementUpdates!: boolean;

  @ApiProperty({ type: Boolean })
  batchChatEnabled!: boolean;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class NotificationPreferencesEnvelopeDto {
  @ApiProperty({ type: () => NotificationPreferencesDto })
  data!: NotificationPreferencesDto;
}
