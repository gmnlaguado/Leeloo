import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/auth.guard';
import { ProfilesService } from '../profiles/profiles.service';

type AuthedRequest = {
  user: { id: string; claims?: any };
};

@ApiTags('diagnostics')
@Controller('diagnostics')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class DiagnosticsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly profilesService: ProfilesService,
  ) {}

  @Get('email')
  @ApiOperation({ summary: 'Diagnostics: email provider config presence' })
  async emailConfig() {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('EMAIL_FROM');

    return {
      provider: 'resend',
      has_resend_api_key: Boolean(apiKey),
      resend_api_key_len: apiKey ? apiKey.length : 0,
      has_email_from: Boolean(from),
      email_from: from || null,
    };
  }

  @Get('whoami')
  @ApiOperation({ summary: 'Diagnostics: who am I (auth claims + profile)' })
  async whoami(@Req() req: AuthedRequest) {
    const userId = req.user.id;
    const claims = req.user?.claims || {};
    const profile = await this.profilesService.ensureProfileByClerkUserId(userId);

    return {
      user_id: userId,
      claims,
      profile,
    };
  }
}
