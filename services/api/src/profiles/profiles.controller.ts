import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
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
      personality?: string[];
      preferences?: Record<string, any>;
      profile_basics?: Record<string, any>;
    },
  ) {
    const userId = req.user.id;
    const patch: Record<string, any> = {};

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

    if (Array.isArray(body.personality)) {
      patch.personality = body.personality;
    }

    if (body.preferences && typeof body.preferences === 'object') {
      patch.preferences = body.preferences;
    }

    if (body.profile_basics && typeof body.profile_basics === 'object') {
      patch.profile_basics = body.profile_basics;
    }

    if (Object.keys(patch).length === 0) {
      return this.profilesService.ensureProfileByClerkUserId(userId);
    }

    return this.profilesService.updatePreferences(userId, patch);
  }
}
