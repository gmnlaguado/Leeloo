import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
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

  @Get('state')
  @ApiOperation({ summary: 'Diagnostics: profile language + conversation state' })
  async state(@Req() req: AuthedRequest) {
    const userId = req.user.id;
    const profile = await this.profilesService.ensureProfileByClerkUserId(userId);
    const preferred = this.profilesService.getPreferredLanguage(profile);
    const state = this.profilesService.getConversationState(profile);

    return {
      user_id: userId,
      profile_locale: profile?.locale || null,
      preferred_language: preferred || null,
      conversation_state: state,
    };
  }

  @Get('llm')
  @ApiOperation({ summary: 'Diagnostics: LLM endpoint reachability' })
  async llm() {
    const endpoint =
      this.configService.get<string>('LLM_ENDPOINT') ||
      this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const model =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');

    if (!endpoint || !model) {
      return {
        has_endpoint: Boolean(endpoint),
        has_model: Boolean(model),
        reachable: false,
        error: 'missing LLM_ENDPOINT and/or LLM_MODEL',
      };
    }

    const t0 = Date.now();
    try {
      const res = await axios.post(
        endpoint,
        {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        },
        { timeout: 8000 },
      );

      return {
        has_endpoint: true,
        has_model: true,
        reachable: true,
        ms: Date.now() - t0,
        status: res.status,
      };
    } catch (err) {
      const status = (err as any)?.response?.status;
      const message = (err as any)?.message || String(err);
      return {
        has_endpoint: true,
        has_model: true,
        reachable: false,
        ms: Date.now() - t0,
        status: status || null,
        error: message,
      };
    }
  }
}
