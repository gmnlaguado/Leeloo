import { Injectable, Logger } from '@nestjs/common';
import { ElevenLabsService } from './elevenlabs.service';
import { OpenAiTtsService, type TtsService, type TtsSynthesizeOptions } from './openai-tts.service';

export type TtsProvider = 'elevenlabs' | 'openai';

/**
 * Selects the active TTS provider at runtime based on TTS_PROVIDER env var.
 * Falls back to OpenAI if ElevenLabs is selected but not properly configured,
 * so a missing ELEVENLABS_VOICE_ID never breaks production voice output.
 */
@Injectable()
export class TtsFactory {
  private readonly logger = new Logger('TtsFactory');

  constructor(
    private readonly elevenLabs: ElevenLabsService,
    private readonly openAi: OpenAiTtsService,
  ) {}

  getActive(): TtsService {
    const provider = String(process.env.TTS_PROVIDER || 'openai').toLowerCase() as TtsProvider;
    if (provider === 'elevenlabs') {
      if (this.elevenLabs.isEnabled()) {
        return this.elevenLabs as unknown as TtsService;
      }
      this.logger.warn(
        'TTS_PROVIDER=elevenlabs but ElevenLabs is not configured — falling back to openai',
      );
    }
    return this.openAi;
  }

  async synthesize(
    text: string,
    options: TtsSynthesizeOptions = {},
  ): Promise<{
    audio: Buffer;
    provider: string;
  }> {
    const svc = this.getActive();
    const audio = await svc.synthesize(text, options);
    return { audio, provider: svc.providerName?.() ?? 'unknown' };
  }
}
