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

  @ApiProperty({
    required: false,
    deprecated: true,
    description:
      'Deprecated and ignored for authorization. The user is identified solely by the verified ' +
      'Clerk JWT (Authorization: Bearer <token>) via AuthGuard; this field is not trusted.',
  })
  @IsOptional()
  @IsString()
  user_id?: string;
}
