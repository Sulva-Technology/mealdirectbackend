import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
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
