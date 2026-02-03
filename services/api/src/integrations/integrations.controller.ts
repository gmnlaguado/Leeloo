import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarService } from './google-calendar.service';

type AuthedRequest = {
  user: { id: string };
};

@ApiTags('integrations')
@Controller('integrations')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List connected integrations for current user' })
  async getIntegrations(@Req() req: AuthedRequest) {
    return this.integrationsService.getIntegrations(req.user.id);
  }

  @Post('connect')
  @ApiOperation({ summary: 'Connect an integration via OAuth auth code (google|microsoft)' })
  async connectIntegration(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      provider: 'google' | 'microsoft';
      auth_code: string;
      redirect_uri?: string;
    },
  ) {
    return this.integrationsService.connectIntegration(req.user.id, body.provider, body.auth_code, body.redirect_uri);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Force refresh token for provider (google|microsoft)' })
  async refreshIntegration(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      provider: 'google' | 'microsoft';
    },
  ) {
    return this.integrationsService.refreshIntegration(req.user.id, body.provider);
  }

  @Post('health')
  @ApiOperation({ summary: 'Validate provider token by calling provider API (google|microsoft)' })
  async health(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      provider: 'google' | 'microsoft';
    },
  ) {
    return this.integrationsService.healthCheck(req.user.id, body.provider);
  }

  @Post('google/sync')
  @ApiOperation({ summary: 'Sync Google Calendar primary events into Leeloo calendar_events' })
  async syncGoogle(@Req() req: AuthedRequest) {
    const { token, profileId } = await this.integrationsService.getValidAccessToken(req.user.id, 'google');
    if (!token) return { ok: false, provider: 'google', message: 'No valid access token' };

    const result = await this.googleCalendarService.syncPrimaryCalendar(profileId, token);
    await this.integrationsService.markSynced(profileId, 'google', { ...result });
    return { ok: true, provider: 'google', ...result };
  }
}
