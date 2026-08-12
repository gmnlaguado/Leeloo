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
    });
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

    return this.voiceService.processVoice({
      userId,
      language,
      wakeWordOnly: false,
      text,
      authorization,
      confirmation,
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
