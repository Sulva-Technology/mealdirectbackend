import { Body, Controller, Get, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
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
import {
  AuthMessageResponseDto,
  AuthTokensResponseDto,
  AcceptVendorInviteDto,
  EmailRequestDto,
  LoginDto,
  RefreshDto,
  SignUpDto,
  UpdatePasswordDto
} from './dto/auth.dto.js';
import { AuthThrottleGuard } from '../../common/http/auth-throttle.guard.js';
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
  @UseGuards(AuthThrottleGuard)
  @ApiCreatedResponse({
    type: AuthTokensResponseDto,
    description: 'Customer registered successfully.'
  })
  @ApiBadRequestResponse({
    description: 'Registration failed due to invalid input or duplicate email.'
  })
  async customerSignUp(@Body() dto: SignUpDto): Promise<AuthTokensResponseDto> {
    return this.authService.signUp(
      dto.email,
      dto.password,
      'customer',
      dto.fullName,
      dto.redirectTo ?? dto.emailRedirectTo
    );
  }

  @Post('customer/login')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Customer logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async customerLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['customer']);
  }

  @Post('vendor/signup')
  @UseGuards(AuthThrottleGuard)
  @ApiCreatedResponse({
    type: AuthTokensResponseDto,
    description: 'Vendor registered successfully.'
  })
  @ApiBadRequestResponse({ description: 'Registration failed.' })
  async vendorSignUp(@Body() dto: SignUpDto): Promise<AuthTokensResponseDto> {
    return this.authService.signUp(
      dto.email,
      dto.password,
      'vendor',
      dto.fullName,
      dto.redirectTo ?? dto.emailRedirectTo
    );
  }

  @Post('vendor/accept-invite')
  @UseGuards(AuthThrottleGuard)
  @ApiCreatedResponse({
    type: AuthTokensResponseDto,
    description: 'Vendor account created from an admin-issued invite link.'
  })
  @ApiBadRequestResponse({ description: 'Invitation is invalid, expired, or already used.' })
  async acceptVendorInvite(@Body() dto: AcceptVendorInviteDto): Promise<AuthTokensResponseDto> {
    const redirectTo = dto.redirectTo ?? dto.emailRedirectTo;
    return this.authService.acceptVendorInvite({
      email: dto.email,
      password: dto.password,
      ...(dto.fullName === undefined ? {} : { fullName: dto.fullName }),
      ...(redirectTo === undefined ? {} : { redirectTo }),
      token: dto.token
    });
  }

  @Post('vendor/login')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Vendor logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async vendorLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['vendor']);
  }

  @Post('rider/signup')
  @UseGuards(AuthThrottleGuard)
  @ApiCreatedResponse({
    type: AuthTokensResponseDto,
    description: 'Rider registered successfully.'
  })
  @ApiBadRequestResponse({ description: 'Registration failed.' })
  async riderSignUp(@Body() dto: SignUpDto): Promise<AuthTokensResponseDto> {
    return this.authService.signUp(
      dto.email,
      dto.password,
      'rider',
      dto.fullName,
      dto.redirectTo ?? dto.emailRedirectTo
    );
  }

  @Post('rider/login')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Rider logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async riderLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['rider']);
  }

  @Post('admin/login')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Admin logged in successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Incorrect role.' })
  async adminLogin(@Body() dto: LoginDto): Promise<AuthTokensResponseDto> {
    return this.authService.signIn(dto.email, dto.password, ['campus_admin', 'super_admin']);
  }

  @Post('refresh')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponseDto, description: 'Session refreshed successfully.' })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token.' })
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokensResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('password-reset')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({
    type: AuthMessageResponseDto,
    description: 'A password reset email is sent if the account exists (non-enumerating).'
  })
  async requestPasswordReset(@Body() dto: EmailRequestDto): Promise<AuthMessageResponseDto> {
    await this.authService.requestPasswordReset(dto.email, dto.portal);
    return { message: 'If an account exists for that email, a password reset link has been sent.' };
  }

  @Post('resend-confirmation')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({
    type: AuthMessageResponseDto,
    description: 'A confirmation email is resent if the account is unconfirmed (non-enumerating).'
  })
  async resendConfirmation(@Body() dto: EmailRequestDto): Promise<AuthMessageResponseDto> {
    await this.authService.resendConfirmation(dto.email, dto.portal);
    return { message: 'If an account exists for that email, a confirmation link has been sent.' };
  }

  @Post('update-password')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({
    type: AuthMessageResponseDto,
    description: 'Sets a new password using the recovery token from the reset email.'
  })
  @ApiUnauthorizedResponse({ description: 'The recovery token is invalid or expired.' })
  async updatePassword(@Body() dto: UpdatePasswordDto): Promise<AuthMessageResponseDto> {
    await this.authService.updatePassword(dto.accessToken, dto.password);
    return { message: 'Your password has been updated. You can now sign in.' };
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
