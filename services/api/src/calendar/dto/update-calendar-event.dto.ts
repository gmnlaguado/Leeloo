import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsISO8601, IsIn, IsArray, IsInt } from 'class-validator';

export class UpdateCalendarEventDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  start_at?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  end_at?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false, enum: ['P1', 'P2', 'P3'] })
  @IsOptional()
  @IsIn(['P1', 'P2', 'P3'])
  priority?: 'P1' | 'P2' | 'P3';

  @ApiProperty({ required: false, enum: ['trabajo', 'salud', 'familia', 'finanzas', 'otros'] })
  @IsOptional()
  @IsIn(['trabajo', 'salud', 'familia', 'finanzas', 'otros'])
  category?: 'trabajo' | 'salud' | 'familia' | 'finanzas' | 'otros';

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  remind_offsets_minutes?: number[];
}
