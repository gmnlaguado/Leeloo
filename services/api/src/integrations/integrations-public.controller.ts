import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IntegrationsService } from './integrations.service';

/**
 * Public OAuth callback routes — no JWT auth required.
 * Google/Microsoft redirect here after user consent.
 * The state parameter identifies the user via the oauth_states table.
 */
@ApiTags('integrations-public')
@Controller('integrations')
export class IntegrationsPublicController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('callback/:provider')
  @ApiOperation({ summary: 'Public OAuth callback — receives code from Google/Microsoft, exchanges it, redirects to mobile app' })
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const p = provider === 'google' || provider === 'microsoft' ? provider : 'google';

    if (error) {
      return res.redirect(`leeloo://integrations/callback?error=${encodeURIComponent(error)}&provider=${p}`);
    }

    const redirectUrl = await this.integrationsService.handleOAuthCallback(p, code, state);
    return res.redirect(redirectUrl);
  }
}
