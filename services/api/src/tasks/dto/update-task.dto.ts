import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsISO8601, IsIn } from 'class-validator';

export class UpdateTaskDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  due_at?: string;

  @ApiProperty({ required: false, enum: ['pending', 'done', 'cancelled'] })
  @IsOptional()
  @IsIn(['pending', 'done', 'cancelled'])
  status?: string;
}
