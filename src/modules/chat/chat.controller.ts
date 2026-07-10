import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
  ChatBatchIdParamDto,
  ChatMessageEnvelopeDto,
  ChatMessageListEnvelopeDto,
  ChatMessageListQueryDto,
  ChatParticipantListEnvelopeDto,
  SendChatMessageDto
} from './dto/chat.dto.js';
import { ChatService } from './chat.service.js';
import type { ChatMessage, ChatParticipant } from './chat.types.js';

@ApiTags('batch-chat')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Caller is not a participant of this batch chat.' })
@Controller('batches/:batchId/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Get('messages')
  @ApiParam({ format: 'uuid', name: 'batchId', type: String })
  @ApiOkResponse({
    description: 'Cursor-paginated chat history for the batch (newest first).',
    type: ChatMessageListEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid cursor or limit.' })
  async listMessages(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ChatBatchIdParamDto,
    @Query() query: ChatMessageListQueryDto
  ): Promise<ListEnvelope<ChatMessage>> {
    const page = await this.chat.listMessages(actor, params.batchId, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit })
    });
    return createListEnvelope(page.items, page.pagination);
  }

  @Post('messages')
  @HttpCode(201)
  @ApiParam({ format: 'uuid', name: 'batchId', type: String })
  @ApiCreatedResponse({
    description: 'Message posted to the batch chat.',
    type: ChatMessageEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid message body.' })
  @ApiConflictResponse({ description: 'The batch chat is closed.' })
  @ApiBody({ type: SendChatMessageDto })
  async postMessage(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ChatBatchIdParamDto,
    @Body() input: SendChatMessageDto
  ): Promise<SuccessEnvelope<ChatMessage>> {
    return createSuccessEnvelope(await this.chat.postMessage(actor, params.batchId, input.body));
  }

  @Get('participants')
  @ApiParam({ format: 'uuid', name: 'batchId', type: String })
  @ApiOkResponse({
    description: 'Visible participants of the batch chat (pseudonymised labels).',
    type: ChatParticipantListEnvelopeDto
  })
  async listParticipants(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: ChatBatchIdParamDto
  ): Promise<ListEnvelope<ChatParticipant>> {
    const participants = await this.chat.listParticipants(actor, params.batchId);
    return createListEnvelope(participants, { hasMore: false, limit: participants.length });
  }
}
