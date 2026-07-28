import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsObject, IsString } from 'class-validator';

export class UpdateReminderSettingsDto {
  @ApiProperty({
    required: false,
    description: 'Default reminder offset in minutes (e.g. 180 = 3 hours).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  default_reminder_offset_minutes?: number;

  @ApiProperty({
    required: false,
    description:
      'Quiet hours object, e.g. { start: "22:00", end: "07:00", tz: "America/Santo_Domingo" }',
  })
  @IsOptional()
  @IsObject()
  quiet_hours?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ required: false, description: 'Tone: neutral/coach/formal' })
  @IsOptional()
  @IsString()
  tone?: string;

  @ApiProperty({ required: false, description: 'Expo push token, ExponentPushToken[....]' })
  @IsOptional()
  @IsString()
  expo_push_token?: string;
}
