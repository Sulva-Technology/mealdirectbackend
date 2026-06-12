import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import type { AuthenticatedActor } from './actor-context.js';
import { CurrentActor } from './current-actor.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@ApiTags('auth')
@ApiBearerAuth('supabaseAuth')
@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'The authenticated Meal Direct actor context.' })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
  me(@CurrentActor() actor: AuthenticatedActor): { actor: AuthenticatedActor } {
    return { actor };
  }
}
