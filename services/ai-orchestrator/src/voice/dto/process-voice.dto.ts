import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ProcessVoiceDto {
  @ApiProperty({ required: false, description: 'Text input (if not using audio)' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiProperty({ required: false, description: 'UI language for this request (es|en|pt|fr|ja)' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ required: false, description: 'Wake-word only mode: only STT, no GPT or actions' })
  @IsOptional()
  @IsString()
  wake_word_only?: string;

  @ApiProperty({ required: false, description: 'Leeloo personality (default|christian|coach|mentor|business|counselor|faith)' })
  @IsOptional()
  @IsString()
  personality?: string;

  @ApiProperty({ required: false, description: 'Display name of the user for personalized responses' })
  @IsOptional()
  @IsString()
  user_name?: string;

  @ApiProperty({
    required: false,
    deprecated: true,
    description: 'Deprecated and ignored for authorization.',
  })
  @IsOptional()
  @IsString()
  user_id?: string;
}
