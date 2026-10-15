import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
  AdminRiderMapQueryDto,
  CoordinatesDto,
  MapCampusIdParamDto,
  MapLocationIdParamDto,
  MapPartnerIdParamDto,
  MapVendorIdParamDto,
  RiderLocationFixDto,
  TrackingAssignmentIdParamDto,
  TrackingOrderIdParamDto
} from './dto/tracking.dto.js';
import { TrackingService } from './tracking.service.js';
import type { AssignmentRoute, MapPoint, OrderTracking, RiderMapEntry } from './tracking.types.js';

function listOf<T>(items: T[]): ListEnvelope<T> {
  return createListEnvelope(items, { hasMore: false, limit: items.length });
}

/** Riders report where they are and get their route with ETAs. */
@ApiTags('rider')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Rider role is required.' })
@Controller('rider')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('rider')
export class RiderTrackingController {
  constructor(@Inject(TrackingService) private readonly tracking: TrackingService) {}

  @Put('location')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Latest position stored. accepted=false means a newer or too-old fix was ignored; send fixes every 10-20 seconds while on shift.'
  })
  @ApiConflictResponse({ description: 'Rider is off shift with no open delivery: stop sending.' })
  async recordLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: RiderLocationFixDto
  ): Promise<SuccessEnvelope<{ accepted: boolean; recordedAt: string }>> {
    return createSuccessEnvelope(await this.tracking.recordRiderLocation(actor, input));
  }

  @Delete('location')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Stored position deleted; the rider disappears from maps.' })
  async stopSharing(
    @CurrentActor() actor: AuthenticatedActor
  ): Promise<SuccessEnvelope<{ stopped: true }>> {
    return createSuccessEnvelope(await this.tracking.stopSharingLocation(actor));
  }

  @Get('assignments/:assignmentId/route')
  @ApiOkResponse({
    description:
      'Pickup and drop-off stops in visiting order with distance and ETA per stop, from the rider position.'
  })
  @ApiNotFoundResponse({ description: 'Assignment was not found for this rider.' })
  async getRoute(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: TrackingAssignmentIdParamDto
  ): Promise<SuccessEnvelope<AssignmentRoute>> {
    return createSuccessEnvelope(
      await this.tracking.getRiderAssignmentRoute(actor, params.assignmentId)
    );
  }
}

/** Customers follow their order to the door. */
@ApiTags('orders')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('customer')
export class OrderTrackingController {
  constructor(@Inject(TrackingService) private readonly tracking: TrackingService) {}

  @Get(':orderId/tracking')
  @ApiOkResponse({
    description:
      'Delivery phase, destination pin, ETA, and (only while on the way) the rider first name and position. Poll every 15-30 seconds.'
  })
  @ApiNotFoundResponse({ description: 'Order was not found for this customer.' })
  async getTracking(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: TrackingOrderIdParamDto
  ): Promise<SuccessEnvelope<OrderTracking>> {
    return createSuccessEnvelope(await this.tracking.getOrderTracking(actor, params.orderId));
  }
}

/** Admin live map and the map pins ETAs are computed from. */
@ApiTags('admin')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiForbiddenResponse({ description: 'Admin role is required.' })
@Controller('admin/map')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('campus_admin', 'super_admin')
export class AdminMapController {
  constructor(@Inject(TrackingService) private readonly tracking: TrackingService) {}

  @Get('riders')
  @ApiOkResponse({
    description: 'Riders sharing a position (on shift or mid-delivery), with a stale flag.'
  })
  async riders(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: AdminRiderMapQueryDto
  ): Promise<ListEnvelope<RiderMapEntry>> {
    return listOf(await this.tracking.listRidersForAdmin(actor, query.campusId));
  }

  @Get('campuses/:campusId/points')
  @ApiOkResponse({
    description: 'Campus locations and vendors with their map pins (null if unset).'
  })
  async points(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MapCampusIdParamDto
  ): Promise<ListEnvelope<MapPoint>> {
    return listOf(await this.tracking.listMapPoints(actor, params.campusId));
  }

  @Put('locations/:locationId/coordinates')
  @ApiOkResponse({ description: 'Drop-off pin set for a campus location.' })
  async setLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MapLocationIdParamDto,
    @Body() input: CoordinatesDto
  ): Promise<SuccessEnvelope<MapPoint>> {
    return createSuccessEnvelope(
      await this.tracking.setPointCoordinates(actor, 'location', params.locationId, input)
    );
  }

  @Delete('locations/:locationId/coordinates')
  @ApiOkResponse({ description: 'Drop-off pin cleared.' })
  async clearLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MapLocationIdParamDto
  ): Promise<SuccessEnvelope<MapPoint>> {
    return createSuccessEnvelope(
      await this.tracking.setPointCoordinates(actor, 'location', params.locationId, null)
    );
  }

  @Put('vendors/:vendorId/coordinates')
  @RequirePermission('vendors:manage')
  @ApiOkResponse({ description: 'Pickup pin set for a vendor.' })
  async setVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MapVendorIdParamDto,
    @Body() input: CoordinatesDto
  ): Promise<SuccessEnvelope<MapPoint>> {
    return createSuccessEnvelope(
      await this.tracking.setPointCoordinates(actor, 'vendor', params.vendorId, input)
    );
  }

  @Delete('vendors/:vendorId/coordinates')
  @RequirePermission('vendors:manage')
  @ApiOkResponse({ description: 'Pickup pin cleared.' })
  async clearVendor(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MapVendorIdParamDto
  ): Promise<SuccessEnvelope<MapPoint>> {
    return createSuccessEnvelope(
      await this.tracking.setPointCoordinates(actor, 'vendor', params.vendorId, null)
    );
  }
}

/** Fleet managers see their own riders on a map. */
@ApiTags('fleet')
@ApiBearerAuth('supabaseAuth')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
@ApiNotFoundResponse({ description: 'Fleet was not found or the caller does not manage it.' })
@Controller('fleet')
@UseGuards(JwtAuthGuard)
export class FleetMapController {
  constructor(@Inject(TrackingService) private readonly tracking: TrackingService) {}

  @Get('partners/:partnerId/map/riders')
  @ApiOkResponse({ description: 'The fleet riders currently sharing a position.' })
  async riders(
    @CurrentActor() actor: AuthenticatedActor,
    @Param() params: MapPartnerIdParamDto
  ): Promise<ListEnvelope<RiderMapEntry>> {
    return listOf(await this.tracking.listRidersForFleet(actor, params.partnerId));
  }
}
