import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { ProfilesService } from './profiles.service';

type AuthedRequest = {
  user: { id: string; claims?: any };
};

@ApiTags('profiles')
@Controller('profiles')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile + preferences' })
  async me(@Req() req: AuthedRequest) {
    const userId = req.user.id;
    const profile = await this.profilesService.ensureProfileByClerkUserId(userId);
    return profile;
  }

  @Patch('me')
  @ApiOperation({ summary: 'Patch current user preferences (display_name, reply_to_email)' })
  async patchMe(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      display_name?: string;
      nickname?: string;
      reply_to_email?: string;
      timezone?: string;
      personality?: string[];
      preferences?: Record<string, any>;
      profile_basics?: Record<string, any>;
      leeloo_personality?: string;
      leeloo_name?: string;
      christian_mode?: boolean;
      preferred_language?: string;
      expo_push_token?: string | null;
    },
  ) {
    const userId = req.user.id;
    const patch: Record<string, any> = {};
    const directColumns: Record<string, any> = {};

    if (body.display_name !== undefined) {
      patch.user_identity = {
        ...(patch.user_identity || {}),
        display_name: body.display_name,
      };
    }

    if (body.nickname !== undefined) {
      patch.user_identity = {
        ...(patch.user_identity || {}),
        nickname: body.nickname,
      };
    }

    if (body.reply_to_email !== undefined) {
      patch.user_identity = {
        ...(patch.user_identity || {}),
        reply_to_email: body.reply_to_email,
      };
    }

    if (typeof body.timezone === 'string') {
      const tz = String(body.timezone || '').trim();
      if (tz) {
        patch.timezone = tz;
      }
    }

    if (Array.isArray(body.personality)) {
      patch.personality = body.personality;
    }

    if (body.preferences && typeof body.preferences === 'object') {
      patch.preferences = body.preferences;
    }

    if (body.profile_basics && typeof body.profile_basics === 'object') {
      patch.profile_basics = body.profile_basics;
    }

    const ALLOWED_PERSONALITIES = [
      'default',
      'christian',
      'coach',
      'mentor',
      'business',
      'counselor',
      'faith',
    ];
    if (
      typeof body.leeloo_personality === 'string' &&
      ALLOWED_PERSONALITIES.includes(body.leeloo_personality)
    ) {
      directColumns.leeloo_personality = body.leeloo_personality;
    }
    if (typeof body.leeloo_name === 'string' && body.leeloo_name.trim()) {
      directColumns.leeloo_name = body.leeloo_name.trim().slice(0, 64);
    }
    if (typeof body.christian_mode === 'boolean') {
      directColumns.christian_mode = body.christian_mode;
    }
    if (
      typeof body.preferred_language === 'string' &&
      ['es', 'en', 'pt', 'fr', 'ja'].includes(body.preferred_language)
    ) {
      directColumns.preferred_language = body.preferred_language;
    }
    if (typeof body.expo_push_token === 'string' || body.expo_push_token === null) {
      const tok = typeof body.expo_push_token === 'string' ? body.expo_push_token.trim() : null;
      directColumns.expo_push_token = tok || null;
    }

    let updated: any = null;
    if (Object.keys(directColumns).length > 0) {
      updated = await this.profilesService.updateDirectColumns(userId, directColumns);
    }

    if (Object.keys(patch).length > 0) {
      updated = await this.profilesService.updatePreferences(userId, patch);
    }

    if (!updated) {
      return this.profilesService.ensureProfileByClerkUserId(userId);
    }
    return updated;
  }

  @Post('me/device')
  @ApiOperation({ summary: 'Register device locale + timezone on first launch (Feature: auto language detection)' })
  async registerDevice(
    @Req() req: AuthedRequest,
    @Body() body: { locale?: string; timezone?: string; expo_push_token?: string },
  ) {
    const userId = req.user.id;
    const locale = String(body?.locale || '').trim();
    const timezone = String(body?.timezone || '').trim();
    const pushToken = String(body?.expo_push_token || '').trim();

    // Detect language from locale (e.g. "es-CO" → "es", "en-US" → "en")
    const langCode = locale.split(/[-_]/)[0].toLowerCase();
    const supported = ['es', 'en', 'pt', 'fr', 'ja'];
    const language = supported.includes(langCode) ? langCode : 'en';

    const cols: Record<string, any> = { preferred_language: language };
    if (timezone) cols['timezone'] = timezone;

    await this.profilesService.updateDirectColumns(userId, cols as any);

    if (pushToken) {
      await this.profilesService.updatePreferences(userId, { expo_push_token: pushToken });
    }

    return {
      ok: true,
      detected_language: language,
      locale,
      timezone: timezone || null,
    };
  }
}
