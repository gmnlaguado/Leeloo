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
    @Body() body: { display_name?: string; reply_to_email?: string },
  ) {
    const userId = req.user.id;
    const patch: Record<string, any> = {};

    if (body.display_name !== undefined) {
      patch.user_identity = {
        ...(patch.user_identity || {}),
        display_name: body.display_name,
      };
    }

    if (body.reply_to_email !== undefined) {
      patch.user_identity = {
        ...(patch.user_identity || {}),
        reply_to_email: body.reply_to_email,
      };
    }

    if (Object.keys(patch).length === 0) {
      return this.profilesService.ensureProfileByClerkUserId(userId);
    }

    return this.profilesService.updatePreferences(userId, patch);
  }
}
