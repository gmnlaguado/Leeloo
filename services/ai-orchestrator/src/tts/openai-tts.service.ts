import { Injectable, Logger } from '@nestjs/common';
import type { LeelooEmotion } from './elevenlabs.service';

export interface TtsSynthesizeOptions {
  emotion?: LeelooEmotion;
  language?: string;
}

export interface TtsService {
  isEnabled(): boolean;
  synthesize(text: string, options?: TtsSynthesizeOptions): Promise<Buffer>;
  providerName(): string;
}

/**
 * OpenAI TTS fallback. Uses /v1/audio/speech with the configured voice
 * (defaults to nova) and model (tts-1-hd). Always available when OPENAI_API_KEY
 * is set, hence safe as the default provider.
 */
@Injectable()
export class OpenAiTtsService implements TtsService {
  private readonly logger = new Logger('OpenAiTtsService');
  private readonly apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  private readonly model = String(process.env.OPENAI_TTS_MODEL || 'tts-1-hd').trim();
  private readonly voice = String(process.env.OPENAI_TTS_VOICE || 'nova').trim();

  providerName() {
    return 'openai';
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  async synthesize(text: string, _options: TtsSynthesizeOptions = {}): Promise<Buffer> {
    if (!this.isEnabled()) {
      throw new Error('OpenAI TTS is not configured: set OPENAI_API_KEY');
    }
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('synthesize: text is required');
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        model: this.model,
        voice: this.voice,
        input: cleanText,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.warn(`OpenAI TTS failed status=${res.status} body=${errText.slice(0, 200)}`);
      throw new Error(`OpenAI TTS failed: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
