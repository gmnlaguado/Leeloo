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
import { ProfilesService } from '../profiles/profiles.service';

@ApiTags('voice')
@Controller('voice')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly profilesService: ProfilesService,
  ) {}

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
    const claims = req.user?.claims || {};

    // Prefer persisted language from profile/conversation state.
    // dto.language is treated as a UI hint, not authoritative.
    const profile = await this.profilesService.ensureProfileByClerkUserId(userId, {
      language: ((dto?.user_context?.language || dto?.language || 'en').toLowerCase() as any) || 'en',
    });

    // Best-effort identity capture from auth provider (Clerk/Google).
    // We store it as preferences.user_identity so mobile Settings can show/edit defaults.
    try {
      const displayName =
        typeof claims?.name === 'string'
          ? claims.name
          : typeof claims?.full_name === 'string'
            ? claims.full_name
            : typeof claims?.given_name === 'string'
              ? claims.given_name
              : undefined;

      const email =
        typeof claims?.email === 'string'
          ? claims.email
          : typeof claims?.primary_email_address === 'string'
            ? claims.primary_email_address
            : undefined;

      if (displayName || email) {
        await this.profilesService.upsertUserIdentity(userId, {
          ...(displayName ? { display_name: displayName } : {}),
          ...(email ? { reply_to_email: email } : {}),
        });
      }
    } catch {
      // best effort only
    }
    const preferredLanguage = this.profilesService.getPreferredLanguage(profile) || 'en';

    const userContext = {
      ...(dto.user_context || {}),
      ...(dto.role ? { role: dto.role } : {}),
      ...(dto.conversation_only === 'true' ? { conversation_only: true } : {}),
      language: preferredLanguage,
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
