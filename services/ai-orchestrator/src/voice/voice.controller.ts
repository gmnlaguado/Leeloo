import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import type { Express, Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { VoiceService } from './voice.service';

type AuthenticatedRequest = Request & { user?: { id: string; claims: unknown } };

@Controller('voice')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Post('process')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async process(
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() body: any,
    @Req() request: AuthenticatedRequest,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = this.requireUserId(request);

    const text = typeof body?.text === 'string' ? body.text : undefined;
    const language = typeof body?.language === 'string' ? body.language : undefined;
    const confirmation =
      body?.confirmation === 'confirmed' || body?.confirmation === 'cancel'
        ? body.confirmation
        : undefined;
    const wakeWordOnly =
      String(body?.wake_word_only || '')
        .trim()
        .toLowerCase() === 'true';
    const personality = typeof body?.personality === 'string' ? body.personality : undefined;
    const userName = typeof body?.user_name === 'string' ? body.user_name : undefined;
    const timezone = typeof body?.timezone === 'string' ? body.timezone : undefined;
    const latitude = body?.latitude != null ? Number(body.latitude) : undefined;
    const longitude = body?.longitude != null ? Number(body.longitude) : undefined;
    const city = typeof body?.city === 'string' ? body.city : undefined;
    const country = typeof body?.country === 'string' ? body.country : undefined;
    const pendingEventId = typeof body?.pending_event_id === 'string' ? body.pending_event_id : undefined;
    const pendingAttendeeName =
      typeof body?.pending_attendee_name === 'string' ? body.pending_attendee_name : undefined;
    const conversationHistory = typeof body?.conversation_history === 'string' ? body.conversation_history : undefined;

    if (!audio && !text)
      throw new BadRequestException('Either audio file or text must be provided');

    return this.voiceService.processVoice({
      userId,
      language,
      wakeWordOnly,
      text,
      audio,
      authorization,
      confirmation,
      personality,
      userName,
      timezone,
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
      city,
      country,
      pending_event_id: pendingEventId,
      pending_attendee_name: pendingAttendeeName,
      conversation_history: conversationHistory,
    });
  }

  @Post('wake-detect')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async wakeDetect(
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() body: any,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = this.requireUserId(request);
    if (!audio) throw new BadRequestException('audio is required');
    const language = typeof body?.language === 'string' ? body.language : undefined;
    const detected = await this.voiceService.detectWakeWord({ userId, audio, language });
    return { detected };
  }

  @Post('test')
  async test(
    @Body() body: any,
    @Req() request: AuthenticatedRequest,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = this.requireUserId(request);

    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) throw new BadRequestException('text is required');

    const language = typeof body?.language === 'string' ? body.language : undefined;
    const confirmation =
      body?.confirmation === 'confirmed' || body?.confirmation === 'cancel'
        ? body.confirmation
        : undefined;
    const personality = typeof body?.personality === 'string' ? body.personality : undefined;
    const userName = typeof body?.user_name === 'string' ? body.user_name : undefined;
    const timezone = typeof body?.timezone === 'string' ? body.timezone : undefined;
    const latitude2 = body?.latitude != null ? Number(body.latitude) : undefined;
    const longitude2 = body?.longitude != null ? Number(body.longitude) : undefined;
    const city2 = typeof body?.city === 'string' ? body.city : undefined;
    const country2 = typeof body?.country === 'string' ? body.country : undefined;
    const conversationHistory =
      typeof body?.conversation_history === 'string' ? body.conversation_history : undefined;

    return this.voiceService.processVoice({
      userId,
      language,
      wakeWordOnly: false,
      text,
      authorization,
      confirmation,
      personality,
      userName,
      timezone,
      latitude: Number.isFinite(latitude2) ? latitude2 : undefined,
      longitude: Number.isFinite(longitude2) ? longitude2 : undefined,
      city: city2,
      country: country2,
      conversation_history: conversationHistory,
    });
  }

  /**
   * The verified Clerk `sub` claim (attached by AuthGuard as `request.user.id`)
   * is the only source of truth for identity. Any `user_id`/`userId` field in
   * the request body is ignored for authorization purposes — trusting it was
   * the original IDOR bug (any caller could impersonate any Clerk user and read
   * their memories or trigger billed OpenAI/TTS calls under their rate-limit
   * bucket).
   */
  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException('Missing authenticated user');
    return userId;
  }
}
