import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'FCM device/registration token issued by the mobile or web client.',
    example: 'fcm-registration-token',
    minLength: 1,
    type: String
  })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({
    description: 'Client platform that issued the token.',
    enum: ['ios', 'android', 'web'],
    example: 'web',
    type: String
  })
  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';
}
