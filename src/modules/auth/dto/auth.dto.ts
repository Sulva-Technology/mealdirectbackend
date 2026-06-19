import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class SignUpDto {
  @ApiProperty({ type: String, example: 'user@example.com', description: 'The email address of the user.' })
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: 'Password123!', description: 'The password (minimum 6 characters).' })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ type: String, example: 'user@example.com', description: 'The email address of the user.' })
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
  @ApiProperty({ type: String, example: 'user@example.com', description: 'The email address of the user.' })
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  email!: string;
}

export class AuthMessageResponseDto {
  @ApiProperty({ type: String, description: 'A non-enumerating confirmation message.' })
  message!: string;
}

export class AuthUserDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'The unique identifier of the user.' })
  id!: string;

  @ApiProperty({ type: String, example: 'user@example.com', description: 'The email address of the user.' })
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

  @ApiPropertyOptional({ type: String, example: 'Verification email sent.', description: 'Optional message detailing signup status.' })
  message?: string;
}
