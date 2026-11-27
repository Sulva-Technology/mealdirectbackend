import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  Matches,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions
} from 'class-validator';

export const authPortals = ['customer', 'vendor', 'rider', 'admin', 'fleet'] as const;
export type AuthPortal = (typeof authPortals)[number];

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function MatchesPassword(property: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'matchesPassword',
      target: target.constructor,
      propertyName: String(propertyName),
      ...(options === undefined ? {} : { options }),
      constraints: [property],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          return value === (args.object as Record<string, unknown>)[args.constraints[0]];
        }
      }
    });
}

export class SignUpDto {
  @ApiProperty({
    type: String,
    example: 'user@example.com',
    description: 'The email address of the user.'
  })
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  email!: string;

  @ApiProperty({
    type: String,
    example: 'Password123!',
    description: 'The password (minimum 6 characters).'
  })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({
    type: String,
    example: 'Jane Doe',
    description: "The user's full name, stored in profile metadata."
  })
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    type: String,
    example: 'https://user.mealdirectly.com/auth/callback',
    description:
      'URL the confirmation email links back to. Must be allow-listed in Supabase auth settings; otherwise Supabase falls back to its configured site URL. When omitted the server uses the role default.'
  })
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsUrl({ require_tld: false })
  redirectTo?: string;

  @ApiPropertyOptional({
    deprecated: true,
    type: String,
    example: 'https://user.mealdirectly.com/auth/callback',
    description: 'Deprecated alias for redirectTo (Supabase SDK naming). Use redirectTo instead.'
  })
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsUrl({ require_tld: false })
  emailRedirectTo?: string;
}

export class LoginDto {
  @ApiProperty({
    type: String,
    example: 'user@example.com',
    description: 'The email address of the user.'
  })
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: 'Password123!', description: 'The password.' })
  @IsString()
  @MinLength(1)
  password!: string;
}

export class RiderSignUpDto {
  @ApiProperty({ type: String, example: 'Jane' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ type: String, example: 'Doe' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ type: String, example: '+2348012345678' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ enum: ['Male', 'Female'] })
  @Transform(({ value }) => trimString(value))
  @IsIn(['Male', 'Female'])
  gender!: 'Male' | 'Female';

  @ApiProperty({ type: String, example: 'user@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: 'Password123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ type: String, example: 'https://rider.mealdirectly.com/auth/callback' })
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsUrl({ require_tld: false })
  redirectTo?: string;
}

/** Customer Create Account form. Confirmation is validated but never sent to Auth metadata. */
export class CustomerRegistrationDto {
  @ApiProperty({ type: String, example: 'Jane' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ type: String, example: 'Doe' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ type: String, example: 'jane@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: '+2348012345678' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(32)
  @Matches(/^[+0-9][0-9 ()-]{5,30}$/)
  @Matches(/(?:\D*\d){7,}/, { message: 'phone must contain at least 7 digits' })
  phone!: string;

  @ApiProperty({ enum: ['Male', 'Female'] })
  @Transform(({ value }) => trimString(value))
  @IsIn(['Male', 'Female'])
  gender!: 'Male' | 'Female';

  @ApiProperty({ type: String, minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ type: String, minLength: 8 })
  @IsString()
  @MinLength(8)
  @MatchesPassword('password', { message: 'confirmPassword must match password' })
  confirmPassword!: string;

  @ApiProperty({ type: Boolean, description: 'Must be true to confirm the accuracy declaration.' })
  @IsBoolean()
  @IsIn([true], { message: 'declarationConfirmed must be true' })
  declarationConfirmed!: boolean;
}

export class RefreshDto {
  @ApiProperty({ type: String, description: 'The Supabase refresh token.' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class EmailRequestDto {
  @ApiProperty({
    type: String,
    example: 'user@example.com',
    description: 'The email address of the user.'
  })
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    enum: authPortals,
    example: 'vendor',
    description:
      'Which portal the email link should redirect to. Determines the redirect base URL (customer/vendor/rider/admin/fleet). Defaults to customer.'
  })
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsIn(authPortals)
  portal?: AuthPortal;

  @ApiPropertyOptional({ type: String, example: 'https://rider.mealdirectly.com/auth/callback' })
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsUrl({ require_tld: false })
  redirectTo?: string;
}

export class AcceptVendorInviteDto extends SignUpDto {
  @ApiProperty({
    type: String,
    description: 'One-time vendor invitation token from the admin-generated link.'
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(16)
  token!: string;
}

export class UpdatePasswordDto {
  @ApiProperty({
    type: String,
    description:
      'The short-lived recovery access token Supabase returned to the front-end /auth/callback page after the user opened the reset email link.'
  })
  @IsString()
  @MinLength(1)
  accessToken!: string;

  @ApiProperty({
    type: String,
    example: 'NewPassword123!',
    description: 'The new password (minimum 6 characters).'
  })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class AuthMessageResponseDto {
  @ApiProperty({ type: String, description: 'A non-enumerating confirmation message.' })
  message!: string;
}

export class AuthUserDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'The unique identifier of the user.' })
  id!: string;

  @ApiProperty({
    type: String,
    example: 'user@example.com',
    description: 'The email address of the user.'
  })
  email!: string;

  @ApiProperty({ type: String, description: 'The role assigned to the user.' })
  role!: string;
}

export class AuthTokensResponseDto {
  @ApiPropertyOptional({ type: String, description: 'The access token JWT.' })
  accessToken?: string;

  @ApiPropertyOptional({ type: String, description: 'The refresh token.' })
  refreshToken?: string;

  @ApiPropertyOptional({ type: Number, description: 'Token expiration duration in seconds.' })
  expiresIn?: number;

  @ApiProperty({ type: () => AuthUserDto, description: 'The user details.' })
  user!: AuthUserDto;

  @ApiPropertyOptional({
    type: String,
    example: 'Verification email sent.',
    description: 'Optional message detailing signup status.'
  })
  message?: string;
}
