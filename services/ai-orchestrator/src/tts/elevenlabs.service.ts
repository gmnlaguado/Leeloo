import { Injectable, Logger } from '@nestjs/common';

export type LeelooEmotion = 'neutral' | 'excited' | 'warm' | 'firm';

export interface ElevenLabsSynthesizeOptions {
  emotion?: LeelooEmotion;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger('ElevenLabsService');
  private readonly apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
  private readonly voiceId = String(process.env.ELEVENLABS_VOICE_ID || '').trim();
  private readonly endpoint = 'https://api.elevenlabs.io/v1/text-to-speech';

  isEnabled(): boolean {
    return Boolean(this.apiKey && this.voiceId);
  }

  private emotionPrefix(emotion: LeelooEmotion | undefined): string {
    switch (emotion) {
      case 'excited':
        return '<break time="0.2s"/> ';
      case 'warm':
      case 'firm':
      case 'neutral':
      default:
        return '';
    }
  }

  async synthesize(text: string, options: ElevenLabsSynthesizeOptions = {}): Promise<Buffer> {
    if (!this.isEnabled()) {
      throw new Error(
        'ElevenLabs is not configured: set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID',
      );
    }

    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('synthesize: text is required');
    }

    const url = `${this.endpoint}/${encodeURIComponent(this.voiceId)}`;
    const body = {
      text: this.emotionPrefix(options.emotion) + cleanText,
      model_id: options.modelId || 'eleven_multilingual_v2',
      voice_settings: {
        stability: options.stability ?? 0.45,
        similarity_boost: options.similarityBoost ?? 0.8,
        style: options.style ?? 0.35,
        use_speaker_boost: options.useSpeakerBoost ?? true,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.warn(
        `ElevenLabs synthesize failed status=${res.status} body=${errText.slice(0, 200)}`,
      );
      throw new Error(`ElevenLabs synthesize failed: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
