import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
  AddFleetManagerDto,
  AdminFleetPartnerListQueryDto,
  AttachFleetRiderDto,
  CreateFleetPartnerDto,
  FleetAssignBatchDto,
  FleetBatchListQueryDto,
  FleetEarningsQueryDto,
  FleetPartnerBatchParamDto,
  FleetPartnerIdParamDto,
  FleetPartnerManagerParamDto,
  FleetPartnerRiderParamDto,
  FleetRiderListQueryDto,
  JoinFleetDto,
  UpdateFleetPartnerDto
} from './dto/fleet.dto.js';
import { FleetService } from './fleet.service.js';
import type {
  FleetBatch,
  FleetEarningsSummary,
  FleetMember,
  FleetMemberRole,
  FleetMembership,
  FleetPartner,
  FleetRider,
  RiderFleet
} from './fleet.types.js';

function listOf<T>(items: T[]): ListEnvelope<T> {
  return createListEnvelope(items, { hasMore: false, limit: items.length });
}

/** Platform admins onboard fleet partners, set their terms, and keep override control. */
@ApiTags('admin')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/fleet-partners')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminFleetPartnersController {
  constructor(@Inject(FleetService) private readonly fleet: FleetService) {}

  @Get()
  @ApiOkResponse({ description: 'Fleet partners, scoped to the campus admin campus.' })
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminFleetPartnerListQueryDto
  ): Promise<ListEnvelope<FleetPartner>> {
    return listOf(await this.fleet.listPartners(actor, query));
  }

  @Post()
  @RequirePermission('riders:manage')
  @ApiCreatedResponse({ description: 'Fleet partner created with a fresh rider join code.' })
  @ApiConflictResponse({ description: 'A fleet partner with this name already exists here.' })
  async create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: CreateFleetPartnerDto
  ): Promise<SuccessEnvelope<FleetPartner>> {
    return createSuccessEnvelope(await this.fleet.createPartner(actor, input));
  }

  @Get(':partnerId')
  @ApiOkResponse({ description: 'Fleet partner with its managers and riders.' })
  @ApiNotFoundResponse({ description: 'Fleet partner was not found in scope.' })
  async get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto
  ): Promise<SuccessEnvelope<FleetPartner & { managers: FleetMember[]; riders: FleetRider[] }>> {
    return createSuccessEnvelope(await this.fleet.getPartnerForAdmin(actor, params.partnerId));
  }

  @Patch(':partnerId')
  @RequirePermission('riders:manage')
  @ApiOkResponse({ description: 'Updated fleet partner terms or status.' })
  async update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto,
    @Body() input: UpdateFleetPartnerDto
  ): Promise<SuccessEnvelope<FleetPartner>> {
    return createSuccessEnvelope(await this.fleet.updatePartner(actor, params.partnerId, input));
  }

  @Post(':partnerId/join-code/rotate')
  @RequirePermission('riders:manage')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Fleet partner with a new join code; the old code stops working.' })
  async rotateJoinCode(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto
  ): Promise<SuccessEnvelope<FleetPartner>> {
    return createSuccessEnvelope(await this.fleet.rotateJoinCodeAsAdmin(actor, params.partnerId));
  }

  @Post(':partnerId/managers')
  @RequirePermission('riders:manage')
  @ApiCreatedResponse({
    description: 'Manager granted. Unknown emails are invited to set a password first.'
  })
  @ApiConflictResponse({ description: 'This user already manages this fleet.' })
  async addManager(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto,
    @Body() input: AddFleetManagerDto
  ): Promise<SuccessEnvelope<FleetMember & { invited: boolean }>> {
    return createSuccessEnvelope(await this.fleet.addManager(actor, params.partnerId, input));
  }

  @Post(':partnerId/managers/:userId/remove')
  @RequirePermission('riders:manage')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Manager access revoked.' })
  async removeManager(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerManagerParamDto
  ): Promise<SuccessEnvelope<{ removed: true }>> {
    return createSuccessEnvelope(
      await this.fleet.removeManager(actor, params.partnerId, params.userId)
    );
  }

  @Post(':partnerId/riders')
  @RequirePermission('riders:manage')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Rider moved into the fleet without a join code.' })
  @ApiConflictResponse({ description: 'Rider already belongs to another fleet.' })
  async attachRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto,
    @Body() input: AttachFleetRiderDto
  ): Promise<SuccessEnvelope<FleetRider>> {
    return createSuccessEnvelope(
      await this.fleet.attachRiderAsAdmin(actor, params.partnerId, input.riderId)
    );
  }

  @Post(':partnerId/riders/:riderId/remove')
  @RequirePermission('riders:manage')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Rider released from the fleet and taken off shift.' })
  async detachRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerRiderParamDto
  ): Promise<SuccessEnvelope<{ removed: true }>> {
    return createSuccessEnvelope(
      await this.fleet.detachRiderAsAdmin(actor, params.partnerId, params.riderId)
    );
  }

  @Get(':partnerId/earnings')
  @ApiOkResponse({ description: 'Fleet delivery earnings by rider and the partner commission.' })
  async earnings(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto,
    @Query() query: FleetEarningsQueryDto
  ): Promise<SuccessEnvelope<FleetEarningsSummary>> {
    return createSuccessEnvelope(
      await this.fleet.getEarningsForAdmin(actor, params.partnerId, query)
    );
  }
}

/**
 * The fleet partner dashboard. Any signed-in account may call it; access to a fleet is
 * resolved per request from fleet_partner_members, and non-members get 404.
 */
@ApiTags('fleet')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiNotFoundResponse({ description: 'Fleet was not found or the caller does not manage it.' })
@Controller('fleet')
@UseGuards(JwtAuthGuard)
export class FleetController {
  constructor(@Inject(FleetService) private readonly fleet: FleetService) {}

  @Get('partners')
  @ApiOkResponse({ description: 'Fleets the caller manages.' })
  async listMine(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<ListEnvelope<FleetMembership>> {
    return listOf(await this.fleet.listMyFleets(actor));
  }

  @Get('partners/:partnerId')
  @ApiOkResponse({ description: 'Fleet profile, terms, and join code.' })
  async get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto
  ): Promise<SuccessEnvelope<FleetPartner & { role: FleetMemberRole }>> {
    return createSuccessEnvelope(await this.fleet.getMyFleet(actor, params.partnerId));
  }

  @Post('partners/:partnerId/join-code/rotate')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Fleet with a new join code; the old code stops working.' })
  @ApiForbiddenResponse({ description: 'Fleet is suspended.' })
  async rotateJoinCode(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto
  ): Promise<SuccessEnvelope<FleetPartner>> {
    return createSuccessEnvelope(await this.fleet.rotateJoinCodeAsManager(actor, params.partnerId));
  }

  @Get('partners/:partnerId/riders')
  @ApiOkResponse({ description: 'Riders in the fleet with their shift and workload.' })
  async listRiders(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto,
    @Query() query: FleetRiderListQueryDto
  ): Promise<ListEnvelope<FleetRider>> {
    return listOf(await this.fleet.listFleetRiders(actor, params.partnerId, query));
  }

  @Post('partners/:partnerId/riders/:riderId/remove')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Rider released from the fleet and taken off shift.' })
  async removeRider(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerRiderParamDto
  ): Promise<SuccessEnvelope<{ removed: true }>> {
    return createSuccessEnvelope(
      await this.fleet.removeRiderAsManager(actor, params.partnerId, params.riderId)
    );
  }

  @Get('partners/:partnerId/batches')
  @ApiOkResponse({
    description:
      'Rider-delivered batches on the fleet campus for a date that are open to the fleet or held by its riders.'
  })
  async listBatches(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto,
    @Query() query: FleetBatchListQueryDto
  ): Promise<ListEnvelope<FleetBatch>> {
    return listOf(await this.fleet.listFleetBatches(actor, params.partnerId, query.date));
  }

  @Post('partners/:partnerId/batches/:batchId/assign')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Batch assigned to a fleet rider.' })
  @ApiForbiddenResponse({ description: 'Fleet is suspended or dispatch is disabled for it.' })
  @ApiConflictResponse({ description: 'Batch is in progress or held outside the fleet.' })
  async assignBatch(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerBatchParamDto,
    @Body() input: FleetAssignBatchDto
  ): Promise<SuccessEnvelope<FleetBatch>> {
    return createSuccessEnvelope(
      await this.fleet.assignBatch(actor, params.partnerId, params.batchId, input.riderId)
    );
  }

  @Get('partners/:partnerId/earnings')
  @ApiOkResponse({ description: 'Fleet delivery earnings by rider and the partner commission.' })
  async earnings(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: FleetPartnerIdParamDto,
    @Query() query: FleetEarningsQueryDto
  ): Promise<SuccessEnvelope<FleetEarningsSummary>> {
    return createSuccessEnvelope(await this.fleet.getEarnings(actor, params.partnerId, query));
  }
}

/** A rider joins or leaves a fleet with the partner's join code. */
@ApiTags('rider')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Rider role is required.' })
@Controller('rider/fleet')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('rider')
export class RiderFleetController {
  constructor(@Inject(FleetService) private readonly fleet: FleetService) {}

  @Get()
  @ApiOkResponse({ description: 'The fleet the rider delivers for, or null for a platform rider.' })
  async get(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<RiderFleet | null>> {
    return createSuccessEnvelope(await this.fleet.getRiderFleet(actor));
  }

  @Post('join')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Rider joined the fleet and was taken off shift.' })
  @ApiNotFoundResponse({ description: 'Join code was not recognised for the rider campus.' })
  @ApiConflictResponse({ description: 'Rider already belongs to another fleet.' })
  async join(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: JoinFleetDto
  ): Promise<SuccessEnvelope<RiderFleet>> {
    return createSuccessEnvelope(await this.fleet.joinFleet(actor, input.joinCode));
  }

  @Post('leave')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Rider left its fleet and was taken off shift.' })
  async leave(@CurrentActor() actor: AuthenticatedActor): Promise<SuccessEnvelope<{ left: true }>> {
    return createSuccessEnvelope(await this.fleet.leaveFleet(actor));
  }
}
