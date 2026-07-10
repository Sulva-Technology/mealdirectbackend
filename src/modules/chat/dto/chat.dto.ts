import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { IsDatabaseUuid } from '../../../common/validation.js';

export class ChatBatchIdParamDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsDatabaseUuid()
  batchId!: string;
}

export class SendChatMessageDto {
  @ApiProperty({ maxLength: 2000, minLength: 1, type: String })
  @IsString()
  @Length(1, 2000)
  body!: string;
}

export class ChatMessageListQueryDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ChatMessageDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  batchId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  senderUserId!: string;

  @ApiProperty({ type: String })
  senderLabel!: string;

  @ApiProperty({ enum: ['rider', 'customer', 'vendor'], type: String })
  senderRole!: string;

  @ApiProperty({ type: String })
  body!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: Boolean })
  mine!: boolean;
}

export class ChatParticipantDto {
  @ApiProperty({ format: 'uuid', type: String })
  userId!: string;

  @ApiProperty({ enum: ['rider', 'customer', 'vendor'], type: String })
  role!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: String })
  joinedAt!: string;
}

export class ChatMessageEnvelopeDto {
  @ApiProperty({ type: () => ChatMessageDto })
  data!: ChatMessageDto;
}

export class ChatMessageListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => ChatMessageDto })
  data!: ChatMessageDto[];
}

export class ChatParticipantListEnvelopeDto {
  @ApiProperty({ isArray: true, type: () => ChatParticipantDto })
  data!: ChatParticipantDto[];
}
