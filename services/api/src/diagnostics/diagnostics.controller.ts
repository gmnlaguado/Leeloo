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
export class DiagnosticsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly profilesService: ProfilesService,
  ) {}

  private async probeChatCompletion(opts: {
    label: string;
    endpoint: string | undefined;
    model: string | undefined;
    apiKey: string | undefined;
  }) {
    const { label, endpoint, model, apiKey } = opts;

    if (!endpoint || !model) {
      return {
        label,
        has_endpoint: Boolean(endpoint),
        has_model: Boolean(model),
        reachable: false,
        error: 'missing endpoint and/or model',
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
        {
          timeout: 8000,
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
        },
      );

      return {
        label,
        has_endpoint: true,
        has_model: true,
        reachable: true,
        ms: Date.now() - t0,
        status: res.status,
        endpoint,
        model,
      };
    } catch (err) {
      const status = (err as any)?.response?.status;
      const message = (err as any)?.message || String(err);
      return {
        label,
        has_endpoint: true,
        has_model: true,
        reachable: false,
        ms: Date.now() - t0,
        status: status || null,
        error: message,
        endpoint,
        model,
      };
    }
  }

  @Get('email-public')
  @ApiOperation({ summary: 'Public diagnostics: email provider config presence (no secrets)' })
  async emailConfigPublic() {
    const apiKey =
      this.configService.get<string>('RESEND_API_KEY') ||
      this.configService.get<string>('RESEND_KEY') ||
      this.configService.get<string>('RESEND_APIKEY') ||
      this.configService.get<string>('RESEND_TOKEN');
    const from =
      this.configService.get<string>('EMAIL_FROM') ||
      this.configService.get<string>('RESEND_FROM') ||
      this.configService.get<string>('MAIL_FROM');

    return {
      provider: 'resend',
      has_resend_api_key: Boolean(apiKey),
      has_email_from: Boolean(from),
      env_checked: {
        api_key: ['RESEND_API_KEY', 'RESEND_KEY', 'RESEND_APIKEY', 'RESEND_TOKEN'],
        from: ['EMAIL_FROM', 'RESEND_FROM', 'MAIL_FROM'],
      },
    };
  }

  @Get('email')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Diagnostics: email provider config presence' })
  async emailConfig() {
    const apiKey =
      this.configService.get<string>('RESEND_API_KEY') ||
      this.configService.get<string>('RESEND_KEY') ||
      this.configService.get<string>('RESEND_APIKEY') ||
      this.configService.get<string>('RESEND_TOKEN');
    const from =
      this.configService.get<string>('EMAIL_FROM') ||
      this.configService.get<string>('RESEND_FROM') ||
      this.configService.get<string>('MAIL_FROM');

    return {
      provider: 'resend',
      has_resend_api_key: Boolean(apiKey),
      resend_api_key_len: apiKey ? apiKey.length : 0,
      has_email_from: Boolean(from),
      email_from: from || null,
      env_checked: {
        api_key: ['RESEND_API_KEY', 'RESEND_KEY', 'RESEND_APIKEY', 'RESEND_TOKEN'],
        from: ['EMAIL_FROM', 'RESEND_FROM', 'MAIL_FROM'],
      },
    };
  }

  @Get('whoami')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
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
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
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

  @Get('llm-intent')
  @ApiOperation({ summary: 'Diagnostics: LLM intent engine reachability (Qwen split)' })
  async llmIntent() {
    const intentModelLabel =
      this.configService.get<string>('LLM_INTENT_MODEL') ||
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const qwenBaseUrl = this.configService.get<string>('QWEN_BASE_URL');
    const endpoint = qwenBaseUrl
      ? `${qwenBaseUrl.replace(/\/$/, '')}/chat/completions`
      : this.configService.get<string>('LLM_ENDPOINT') || this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const qwenModel = this.configService.get<string>('QWEN_MODEL');
    const fallbackModel =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const model = intentModelLabel === 'qwen' ? qwenModel || fallbackModel : intentModelLabel || fallbackModel;

    return this.probeChatCompletion({
      label: 'intent',
      endpoint,
      model,
      apiKey,
    });
  }

  @Get('llm-chat')
  @ApiOperation({ summary: 'Diagnostics: LLM chat engine reachability (Llama split)' })
  async llmChat() {
    const chatModelLabel =
      this.configService.get<string>('LLM_CHAT_MODEL') ||
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const llamaBaseUrl = this.configService.get<string>('LLAMA_BASE_URL');
    const endpoint = llamaBaseUrl
      ? `${llamaBaseUrl.replace(/\/$/, '')}/chat/completions`
      : this.configService.get<string>('LLM_ENDPOINT') || this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const llamaModel = this.configService.get<string>('LLAMA_MODEL');
    const fallbackModel =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const model = chatModelLabel === 'llama' ? llamaModel || fallbackModel : chatModelLabel || fallbackModel;

    return this.probeChatCompletion({
      label: 'chat',
      endpoint,
      model,
      apiKey,
    });
  }
}
