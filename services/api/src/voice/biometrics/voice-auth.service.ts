import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Voice biometrics — Azure Speaker Recognition.
 *
 * Architecture:
 *  - Primary engine: Azure Cognitive Services Speaker Recognition (text-independent).
 *  - Threshold configurable via VOICE_AUTH_CONFIDENCE_THRESHOLD (default 0.75).
 *  - When Azure credentials are missing, the service degrades gracefully and ALWAYS
 *    returns isOwner=true (dev/staging) so we never hard-block the voice pipeline.
 */
@Injectable()
export class VoiceAuthService {
  private readonly logger = new Logger(VoiceAuthService.name);
  private readonly threshold: number;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('VOICE_AUTH_CONFIDENCE_THRESHOLD');
    const parsed = raw ? Number(raw) : NaN;
    this.threshold = Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.75;

    this.enabled = Boolean(
      this.configService.get<string>('AZURE_SPEAKER_RECOGNITION_KEY') &&
      this.configService.get<string>('AZURE_SPEAKER_RECOGNITION_ENDPOINT'),
    );
  }

  private azureEndpoint(): string {
    return String(
      this.configService.get<string>('AZURE_SPEAKER_RECOGNITION_ENDPOINT') || '',
    ).replace(/\/+$/, '');
  }

  private azureKey(): string {
    return String(this.configService.get<string>('AZURE_SPEAKER_RECOGNITION_KEY') || '');
  }

  async enrollVoice(
    userId: string,
    audioChunks: Buffer[],
  ): Promise<{ azureProfileId: string; status: string }> {
    if (!this.enabled) {
      this.logger.warn(`[voice-auth] Azure not configured — dev profile for user=${userId}`);
      return { azureProfileId: `dev-${userId}`, status: 'Enrolling' };
    }

    if (!audioChunks || audioChunks.length < 3) {
      throw new Error('voice-auth: at least 3 audio chunks required for enrollment');
    }

    const create = await axios.post(
      `${this.azureEndpoint()}/speaker/verification/v2.0/text-independent/profiles`,
      { locale: 'en-us' },
      {
        headers: {
          'Ocp-Apim-Subscription-Key': this.azureKey(),
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    const azureProfileId: string = create.data?.profileId;
    if (!azureProfileId) {
      throw new Error('voice-auth: Azure did not return a profileId on create');
    }

    let status = 'Enrolling';
    for (const chunk of audioChunks) {
      const res = await axios.post(
        `${this.azureEndpoint()}/speaker/verification/v2.0/text-independent/profiles/${azureProfileId}/enrollments`,
        chunk,
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.azureKey(),
            'Content-Type': 'audio/wav',
          },
          timeout: 30000,
          maxBodyLength: Infinity,
        },
      );
      status = String(res.data?.enrollmentStatus || status);
      if (status === 'Enrolled') break;
    }

    this.logger.log(
      `[voice-auth] enrolled user=${userId} azureProfileId=${azureProfileId} status=${status}`,
    );
    return { azureProfileId, status };
  }

  async verifyVoice(
    userId: string,
    audioBuffer: Buffer,
    candidateProfiles: Array<{ azureProfileId: string; speakerId: string; isOwner: boolean }>,
  ): Promise<{ isOwner: boolean; confidence: number; speakerId?: string }> {
    if (!this.enabled || !candidateProfiles?.length) {
      return { isOwner: true, confidence: 1, speakerId: undefined };
    }

    let best: { confidence: number; speakerId: string; isOwner: boolean } | null = null;

    for (const candidate of candidateProfiles) {
      try {
        const res = await axios.post(
          `${this.azureEndpoint()}/speaker/verification/v2.0/text-independent/profiles/${candidate.azureProfileId}/verify`,
          audioBuffer,
          {
            headers: {
              'Ocp-Apim-Subscription-Key': this.azureKey(),
              'Content-Type': 'audio/wav',
            },
            timeout: 15000,
            maxBodyLength: Infinity,
          },
        );

        const score = Number(res.data?.score ?? 0);
        const accepted = String(res.data?.recognitionResult || '').toLowerCase() === 'accept';
        const confidence = accepted ? Math.max(score, this.threshold) : score;

        if (!best || confidence > best.confidence) {
          best = {
            confidence,
            speakerId: candidate.speakerId,
            isOwner: candidate.isOwner,
          };
        }
      } catch (err) {
        this.logger.warn(
          `[voice-auth] verify failed user=${userId} profile=${candidate.azureProfileId}: ${(err as Error).message}`,
        );
      }
    }

    if (!best || best.confidence < this.threshold) {
      return { isOwner: false, confidence: best?.confidence ?? 0 };
    }

    return { isOwner: best.isOwner, confidence: best.confidence, speakerId: best.speakerId };
  }

  getRejectMessage(ownerName: string): string {
    const safeName = (ownerName || '').trim() || 'la dueña';
    const messages = [
      `Hmm, tú no eres ${safeName}. Solo ella puede darme instrucciones.`,
      `Reconozco cuando no es ${safeName} quien me habla. ¿Hay algo en lo que pueda ayudarte diferente?`,
      `Mi lealtad es con ${safeName}. ¿Quieres que le avise que alguien intentó hablar conmigo?`,
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  getThreshold(): number {
    return this.threshold;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
