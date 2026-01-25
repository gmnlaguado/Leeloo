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

    const requestedLanguage = ((dto?.user_context?.language || dto?.language || '').toString().toLowerCase() as any) || null;
    const isSupported = (l: any) => l === 'es' || l === 'en' || l === 'pt' || l === 'fr' || l === 'ja';

    // Ensure profile exists first.
    let profile = await this.profilesService.ensureProfileByClerkUserId(userId, {
      language: (isSupported(requestedLanguage) ? requestedLanguage : 'en') as any,
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

      const derivedDisplayName = (() => {
        if (displayName) return displayName;
        if (!email) return undefined;
        const local = email.split('@')[0] || '';
        const cleaned = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
        return cleaned || undefined;
      })();

      if (derivedDisplayName || email) {
        await this.profilesService.upsertUserIdentity(userId, {
          ...(derivedDisplayName ? { display_name: derivedDisplayName } : {}),
          ...(email ? { reply_to_email: email } : {}),
        });
      }
    } catch {
      // best effort only
    }
    // Authoritative language selection:
    // - If client explicitly provided a supported language, honor it and persist.
    // - Otherwise fall back to persisted profile language.
    let preferredLanguage = this.profilesService.getPreferredLanguage(profile) || 'en';
    if (isSupported(requestedLanguage) && requestedLanguage !== preferredLanguage) {
      try {
        await this.profilesService.updateLanguage(userId, requestedLanguage);
        await this.profilesService.setConversationState(userId, {
          preferred_language: requestedLanguage,
        });
        profile = await this.profilesService.getProfileByClerkUserId(userId);
      } catch {
        // best effort only
      }
      preferredLanguage = requestedLanguage;
    }

    const inferredChannel = audio ? 'VOICE' : 'TEXT';
    const explicitChannel = (dto.user_context as any)?.channel;
    const channel = explicitChannel === 'VOICE' || explicitChannel === 'TEXT' ? explicitChannel : inferredChannel;

    const roleFromUserContext = (dto.user_context as any)?.role;
    const resolvedRole = dto.role || (typeof roleFromUserContext === 'string' ? roleFromUserContext : undefined);

    const userContext = {
      ...(dto.user_context || {}),
      ...(resolvedRole ? { role: resolvedRole } : {}),
      ...(dto.conversation_only === 'true' ? { conversation_only: true } : {}),
      language: preferredLanguage,
      channel,
    };

    const wakeWordOnly = String((dto as any)?.wake_word_only || '').toLowerCase() === 'true';
    (userContext as any).wake_word_only = wakeWordOnly;

    // If audio file is provided, transcribe it first
    if (audio) {
      const transcription = await this.voiceService.transcribeAudio(
        audio.buffer,
        userContext,
      );

      if (wakeWordOnly) {
        return { transcription };
      }

      return this.voiceService.processIntent(userId, transcription, userContext);
    }

    // Otherwise process text directly
    if (wakeWordOnly) {
      return { transcription: (dto.text || '').toString() };
    }

    return this.voiceService.processIntent(userId, dto.text, userContext);
  }

  @Post('wake-event')
  @ApiOperation({ summary: 'Log wake word detection event' })
  async logWakeEvent(@Request() req: any) {
    const userId = req.user.id;
    return this.voiceService.logWakeEvent(userId);
  }
}
