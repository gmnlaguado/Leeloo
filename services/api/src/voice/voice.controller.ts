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

    const normalizeLanguage = (raw: any) => {
      const s = String(raw || '').trim().toLowerCase();
      if (!s) return null;
      if (s === 'es' || s.startsWith('es-') || s.includes('spanish') || s.includes('espanol') || s.includes('español')) return 'es';
      if (s === 'en' || s.startsWith('en-') || s.includes('english') || s.includes('ingles') || s.includes('inglés')) return 'en';
      if (s === 'pt' || s.startsWith('pt-') || s.includes('portuguese') || s.includes('portugues') || s.includes('português')) return 'pt';
      if (s === 'fr' || s.startsWith('fr-') || s.includes('french') || s.includes('francais') || s.includes('français')) return 'fr';
      if (s === 'ja' || s.startsWith('ja-') || s.includes('japanese') || s.includes('japon') || s.includes('japonés')) return 'ja';
      return s;
    };

    const requestedLanguage = (normalizeLanguage(dto?.user_context?.language || dto?.language) as any) || null;
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
    const persistedLanguage = this.profilesService.getPreferredLanguage(profile);
    const preferredLanguage = (persistedLanguage || (isSupported(requestedLanguage) ? requestedLanguage : null) || 'en') as any;

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
