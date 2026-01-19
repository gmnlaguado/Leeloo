import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class ProcessVoiceDto {
  @ApiProperty({ required: false, description: 'Text input (if not using audio)' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiProperty({
    required: false,
    description: 'UI language for this request (es|en|pt|fr|ja)',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({
    required: false,
    description:
      'Optional user context for personalization (language, faith_mode, role, etc.)',
  })
  @IsOptional()
  user_context?: {
    language?: string;
    faith_mode?: boolean;
    role?: string;
    conversation_only?: boolean;
  };

  @ApiProperty({ required: false, description: 'Force conversation-only mode (no actions/tools) (multipart field)' })
  @IsOptional()
  conversation_only?: string;

  @ApiProperty({ required: false, description: 'Role/persona hint for conversation (multipart field)' })
  @IsOptional()
  @IsString()
  role?: string;
}
