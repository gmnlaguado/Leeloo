import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleGmailService } from './google-gmail.service';
import { MicrosoftCalendarService } from './microsoft-calendar.service';

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
    private readonly googleGmailService: GoogleGmailService,
    private readonly microsoftCalendarService: MicrosoftCalendarService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List connected integrations for current user' })
  async getIntegrations(@Req() req: AuthedRequest) {
    return this.integrationsService.getIntegrations(req.user.id);
  }

  @Post('auth-url')
  @ApiOperation({ summary: 'Get OAuth authorization URL for provider (google|microsoft)' })
  async getAuthUrl(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      provider: 'google' | 'microsoft';
      redirect_uri: string;
    },
  ) {
    return this.integrationsService.buildAuthUrl({
      userId: req.user.id,
      provider: body.provider,
      redirectUri: body.redirect_uri,
    });
  }

  @Delete(':provider')
  @ApiOperation({ summary: 'Disconnect integration (google|microsoft)' })
  async disconnect(@Req() req: AuthedRequest, @Param('provider') provider: 'google' | 'microsoft') {
    return this.integrationsService.disconnectIntegration(req.user.id, provider);
  }

  @Post('connect')
  @ApiOperation({ summary: 'Connect an integration via OAuth auth code (google|microsoft)' })
  async connectIntegration(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      provider: 'google' | 'microsoft';
      auth_code: string;
      state: string;
      redirect_uri?: string;
    },
  ) {
    return this.integrationsService.connectIntegration(
      req.user.id,
      body.provider,
      body.auth_code,
      body.state,
      body.redirect_uri,
    );
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
    const { token, profileId } = await this.integrationsService.getValidAccessToken(
      req.user.id,
      'google',
    );
    if (!token) return { ok: false, provider: 'google', message: 'No valid access token' };

    const metaRes = await this.integrationsService.getIntegrationMetadata(req.user.id, 'google');
    const meta = (metaRes.metadata || {}) as Record<string, unknown>;
    const googleMeta = (meta.google || {}) as Record<string, unknown>;
    const currentToken =
      typeof googleMeta.sync_token === 'string' && googleMeta.sync_token.trim()
        ? googleMeta.sync_token.trim()
        : null;

    const result = await this.googleCalendarService.syncPrimaryCalendarIncremental({
      profileId,
      accessToken: token,
      syncToken:
        typeof currentToken === 'string' && currentToken.trim() ? currentToken.trim() : null,
    });

    const nextToken =
      typeof (result as Record<string, unknown>)?.next_sync_token === 'string'
        ? String((result as Record<string, unknown>).next_sync_token)
        : null;
    if (nextToken) {
      await this.integrationsService.patchIntegrationMetadata(profileId, 'google', {
        google: { sync_token: nextToken },
      });
    }

    await this.integrationsService.markSynced(profileId, 'google', {
      google: { last_result: result },
    });
    return { ok: true, provider: 'google', ...result };
  }

  @Post('google/gmail/sync')
  @ApiOperation({ summary: 'Stub: List recent Gmail messages (google)' })
  async syncGoogleGmail(@Req() req: AuthedRequest) {
    const { token } = await this.integrationsService.getValidAccessToken(req.user.id, 'google');
    if (!token) return { ok: false, provider: 'google', message: 'No valid access token' };

    const out = await this.googleGmailService.listRecentMessages(token, 10);
    return { provider: 'google', ...out };
  }

  @Post('microsoft/calendar/sync')
  @ApiOperation({ summary: 'Stub: List recent Microsoft calendar events (microsoft)' })
  async syncMicrosoftCalendar(@Req() req: AuthedRequest) {
    const { token } = await this.integrationsService.getValidAccessToken(req.user.id, 'microsoft');
    if (!token) return { ok: false, provider: 'microsoft', message: 'No valid access token' };

    const out = await this.microsoftCalendarService.listRecentEvents(token, 10);
    return { provider: 'microsoft', ...out };
  }
}
