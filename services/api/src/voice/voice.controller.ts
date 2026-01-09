import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import * as multer from 'multer';
import { Express } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { VoiceService } from './voice.service';
import { ProcessVoiceDto } from './dto/process-voice.dto';

@ApiTags('voice')
@Controller('voice')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Post('process')
  @ApiOperation({ summary: 'Process voice input (audio or text)' })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async processVoice(
    @UploadedFile() audio: Express.Multer.File,
    @Body() dto: ProcessVoiceDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;

    const language =
      (dto?.user_context?.language || dto?.language || 'en').toLowerCase();

    const userContext = {
      ...(dto.user_context || {}),
      language,
    };

    // If audio file is provided, transcribe it first
    if (audio) {
      const transcription = await this.voiceService.transcribeAudio(
        audio.buffer,
        userContext,
      );
      return this.voiceService.processIntent(userId, transcription, userContext);
    }

    // Otherwise process text directly
    return this.voiceService.processIntent(userId, dto.text, userContext);
  }

  @Post('wake-event')
  @ApiOperation({ summary: 'Log wake word detection event' })
  async logWakeEvent(@Request() req: any) {
    const userId = req.user.id;
    return this.voiceService.logWakeEvent(userId);
  }
}
