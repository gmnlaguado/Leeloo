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
  private readonly streamEndpoint = 'https://api.elevenlabs.io/v1/text-to-speech';

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
      model_id: options.modelId || 'eleven_turbo_v2_5',
      voice_settings: {
        stability: options.stability ?? 0.40,
        similarity_boost: options.similarityBoost ?? 0.85,
        style: options.style ?? 0.10,
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
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(
        `ElevenLabs synthesize FAILED status=${res.status} voiceId=${this.voiceId} body=${errText.slice(0, 400)}`,
      );
      throw new Error(`ElevenLabs synthesize failed: HTTP ${res.status} — ${errText.slice(0, 200)}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Streaming synthesis: ElevenLabs starts sending audio chunks immediately,
  // before the full generation is done. This saves ~300–800ms compared to
  // waiting for the complete MP3 — the first audio bytes arrive much sooner.
  async synthesizeStreaming(text: string, options: ElevenLabsSynthesizeOptions = {}): Promise<Buffer> {
    if (!this.isEnabled()) {
      throw new Error('ElevenLabs is not configured: set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID');
    }
    const cleanText = String(text || '').trim();
    if (!cleanText) throw new Error('synthesizeStreaming: text is required');

    const url = `${this.streamEndpoint}/${encodeURIComponent(this.voiceId)}/stream`;
    const body = {
      text: this.emotionPrefix(options.emotion) + cleanText,
      model_id: options.modelId || 'eleven_turbo_v2_5',
      // optimize_streaming_latency=4 = maximum latency reduction
      // (trades tiny quality for ~200ms faster first-chunk delivery)
      optimize_streaming_latency: 4,
      voice_settings: {
        stability: options.stability ?? 0.40,
        similarity_boost: options.similarityBoost ?? 0.85,
        style: options.style ?? 0.10,
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
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(`ElevenLabs stream FAILED status=${res.status} body=${errText.slice(0, 400)}`);
      throw new Error(`ElevenLabs stream failed: HTTP ${res.status} — ${errText.slice(0, 200)}`);
    }

    // Collect all chunks into a single Buffer — client receives complete audio
    // but the HTTP connection started delivering data sooner, reducing wall-clock time.
    const chunks: Uint8Array[] = [];
    const reader = res.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return Buffer.from(combined);
  }
}
