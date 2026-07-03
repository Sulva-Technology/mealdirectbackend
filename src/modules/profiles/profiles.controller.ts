import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Put,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { createListEnvelope, createSuccessEnvelope } from '../../common/api/response.js';
import type { ListEnvelope, SuccessEnvelope } from '../../common/api/response.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedActor } from '../auth/actor-context.js';
import {
  CampusMembershipListEnvelopeDto,
  CompleteOnboardingDto,
  DefaultLocationDto,
  MeSessionEnvelopeDto,
  ProfileEnvelopeDto,
  UpdateProfileDto
} from './dto/profile.dto.js';
import {
  ConfirmUploadDto,
  UploadUrlEnvelopeDto,
  UploadUrlRequestDto
} from '../storage/dto/media.dto.js';
import type { SignedUploadTarget } from '../storage/storage.service.js';
import { ProfilesService } from './profiles.service.js';
import type { CampusMembership, MeSession, ProfileResponse } from './profiles.types.js';

@ApiTags('me')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller()
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get('me')
  @ApiOkResponse({
    description: 'Current role-aware Meal Direct session.',
    type: MeSessionEnvelopeDto
  })
  async me(@CurrentActor() actor: AuthenticatedActor): Promise<SuccessEnvelope<MeSession>> {
    return createSuccessEnvelope(await this.profiles.getCurrentUser(actor));
  }

  @Get('me/campuses')
  @ApiOkResponse({
    description: 'Active campus memberships for the current user.',
    type: CampusMembershipListEnvelopeDto
  })
  async campuses(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<CampusMembership>> {
    const campuses = await this.profiles.listCampuses(actor);
    return createListEnvelope(campuses, {
      hasMore: false,
      limit: campuses.length
    });
  }

  @Patch('me')
  @ApiOkResponse({ description: 'Updated safe profile fields.', type: ProfileEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Invalid profile input.' })
  async updateProfile(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: UpdateProfileDto
  ): Promise<SuccessEnvelope<ProfileResponse>> {
    return createSuccessEnvelope(await this.profiles.updateProfile(actor, input));
  }

  @Post('me/avatar/upload-url')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Signed upload URL for the user avatar. Confirm with the returned key.',
    type: UploadUrlEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Unsupported content type or size.' })
  async createAvatarUploadUrl(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: UploadUrlRequestDto
  ): Promise<SuccessEnvelope<SignedUploadTarget>> {
    return createSuccessEnvelope(await this.profiles.issueAvatarUpload(actor, input));
  }

  @Post('me/avatar/confirm')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Persists the uploaded avatar key and returns the updated profile.',
    type: ProfileEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Invalid or unverifiable upload key.' })
  async confirmAvatar(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: ConfirmUploadDto
  ): Promise<SuccessEnvelope<ProfileResponse>> {
    return createSuccessEnvelope(await this.profiles.confirmAvatar(actor, input.key));
  }

  @Post('me/complete-onboarding')
  @ApiOkResponse({ description: 'Profile after onboarding completion.', type: ProfileEnvelopeDto })
  @ApiBadRequestResponse({
    description: 'Invalid onboarding input, or location not in the selected active campus.'
  })
  async completeOnboarding(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: CompleteOnboardingDto
  ): Promise<SuccessEnvelope<ProfileResponse>> {
    return createSuccessEnvelope(await this.profiles.completeOnboarding(actor, input));
  }

  @Put('me/default-location')
  @ApiOkResponse({
    description: 'Profile after default location update.',
    type: ProfileEnvelopeDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid default location input, or location not in the selected active campus.'
  })
  async setDefaultLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: DefaultLocationDto
  ): Promise<SuccessEnvelope<ProfileResponse>> {
    return createSuccessEnvelope(await this.profiles.setDefaultLocation(actor, input));
  }
}
