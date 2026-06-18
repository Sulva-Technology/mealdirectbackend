import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import type { AuthenticatedActor } from './actor-context.js';
import { CurrentActor } from './current-actor.decorator.js';
import { AuthTokensResponseDto, LoginDto, RefreshDto, SignUpDto } from './dto/auth.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { SupabaseAuthService } from './supabase-auth.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly authService: SupabaseAuthService
  ) {}

  @Post('customer/signup')
  @ApiCreatedResponse({ type: AuthTokensResponseDto, description: 'Customer registered successfully.' })
  @ApiBadRequestResponse({ description: 'Registration failed due to invalid input or duplicate email.' })
  async customerSignUp(@Body() dto: SignUpDto): Promise<AuthTokensResponseDto> {
    return this.authService.signUp(dto.email, dto.password, 'customer', dto.fullName, dto.redirectTo);
  }

  @Post('customer/login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Customer logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async customerLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['customer']);
  }

  @Post('vendor/signup')
  @ApiCreatedResponse({ type: AuthTokensResponseDto, description: 'Vendor registered successfully.' })
  @ApiBadRequestResponse({ description: 'Registration failed.' })
  async vendorSignUp(@Body() dto: SignUpDto): Promise<AuthTokensResponseDto> {
    return this.authService.signUp(dto.email, dto.password, 'vendor', dto.fullName, dto.redirectTo);
  }

  @Post('vendor/login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Vendor logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async vendorLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['vendor']);
  }

  @Post('rider/signup')
  @ApiCreatedResponse({ type: AuthTokensResponseDto, description: 'Rider registered successfully.' })
  @ApiBadRequestResponse({ description: 'Registration failed.' })
  async riderSignUp(@Body() dto: SignUpDto): Promise<AuthTokensResponseDto> {
    return this.authService.signUp(dto.email, dto.password, 'rider', dto.fullName, dto.redirectTo);
  }

  @Post('rider/login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Rider logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async riderLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['rider']);
  }

  @Post('admin/login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Admin logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async adminLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['campus_admin', 'super_admin']);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Session refreshed successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token.' })
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokensResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiBearerAuth('supabaseAuth')
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOkResponse({ description: 'Logged out successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing bearer token.' })
  async logout(@Headers('authorization') authHeader: string): Promise<{ success: boolean }> {
    const token = authHeader.replace('Bearer ', '').trim();
    await this.authService.signOut(token);
    return { success: true };
  }

  @ApiBearerAuth('supabaseAuth')
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'The authenticated Meal Direct actor context.' })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired Supabase JWT.' })
  me(@CurrentActor() actor: AuthenticatedActor): { actor: AuthenticatedActor } {
    return { actor };
  }
}
