import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { RequirePermission } from '../auth/permission.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  AddFeatureTesterDto,
  FeatureFlagEnvelopeDto,
  FeatureFlagKeyParamDto,
  FeatureFlagListEnvelopeDto,
  FeatureTesterEnvelopeDto,
  FeatureTesterIdParamDto,
  FeatureTesterListEnvelopeDto,
  MyFeatureFlagsEnvelopeDto,
  UpdateFeatureFlagDto
} from './dto/feature-flags.dto.js';
import { FeatureFlagsService, subjectForActor } from './feature-flags.service.js';
import type { FeatureFlag, FeatureTester } from './feature-flags.types.js';

@ApiTags('admin-feature-flags')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role and the admin:manage permission are required.' })
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminFeatureFlagsController {
  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  @Get('feature-flags')
  @RequirePermission('admin:manage')
  @ApiOkResponse({
    description: 'All feature flags and their mode.',
    type: FeatureFlagListEnvelopeDto
  })
  async listFlags(): Promise<ListEnvelope<FeatureFlag>> {
    const flags = await this.flags.listFlags();
    return createListEnvelope(flags, { hasMore: false, limit: flags.length });
  }

  @Patch('feature-flags/:key')
  @RequirePermission('admin:manage')
  @ApiParam({ name: 'key', type: String })
  @ApiBody({ type: UpdateFeatureFlagDto })
  @ApiOkResponse({ description: 'Flag mode updated. Audited.', type: FeatureFlagEnvelopeDto })
  @ApiNotFoundResponse({ description: 'Unknown flag key.' })
  async updateFlag(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FeatureFlagKeyParamDto,
    @Body() body: UpdateFeatureFlagDto
  ): Promise<SuccessEnvelope<FeatureFlag>> {
    return createSuccessEnvelope(await this.flags.setMode(actor, params.key, body.mode));
  }

  @Get('feature-testers')
  @RequirePermission('admin:manage')
  @ApiOkResponse({
    description: 'Users and vendors in the test-mode cohort.',
    type: FeatureTesterListEnvelopeDto
  })
  async listTesters(): Promise<ListEnvelope<FeatureTester>> {
    const testers = await this.flags.listTesters();
    return createListEnvelope(testers, { hasMore: false, limit: testers.length });
  }

  @Post('feature-testers')
  @HttpCode(201)
  @RequirePermission('admin:manage')
  @ApiBody({ type: AddFeatureTesterDto })
  @ApiCreatedResponse({
    description: 'Subject added to the tester cohort (idempotent). Audited.',
    type: FeatureTesterEnvelopeDto
  })
  @ApiBadRequestResponse({ description: 'Subject does not exist.' })
  async addTester(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: AddFeatureTesterDto
  ): Promise<SuccessEnvelope<FeatureTester>> {
    return createSuccessEnvelope(
      await this.flags.addTester(actor, body.subjectType, body.subjectId, body.note)
    );
  }

  @Delete('feature-testers/:testerId')
  @RequirePermission('admin:manage')
  @ApiParam({ format: 'uuid', name: 'testerId', type: String })
  @ApiOkResponse({
    description: 'Subject removed from the cohort. Audited.',
    type: FeatureTesterEnvelopeDto
  })
  @ApiNotFoundResponse({ description: 'Tester not found.' })
  async removeTester(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FeatureTesterIdParamDto
  ): Promise<SuccessEnvelope<FeatureTester>> {
    return createSuccessEnvelope(await this.flags.removeTester(actor, params.testerId));
  }
}

@ApiTags('feature-flags')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('me/feature-flags')
@UseGuards(JwtAuthGuard)
export class MyFeatureFlagsController {
  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Every feature flag resolved for the caller (test-mode cohort applied).',
    type: MyFeatureFlagsEnvelopeDto
  })
  async myFlags(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<Record<string, boolean>>> {
    return createSuccessEnvelope(await this.flags.enabledFlagsFor(subjectForActor(actor)));
  }
}
