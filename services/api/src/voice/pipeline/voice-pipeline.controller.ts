import {
  Body,
  Controller,
  Logger,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as multer from 'multer';
import type { Express } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { DatabaseService } from '../../database/database.service';
import { VoiceAuthService } from '../biometrics/voice-auth.service';

const ORCHESTRATOR_URL =
  String(process.env.AI_ORCHESTRATOR_URL || '').trim() || 'http://localhost:3002';

@ApiTags('voice-pipeline')
@Controller('voice/pipeline')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class VoicePipelineController {
  private readonly logger = new Logger('VoicePipelineController');

  constructor(
    private readonly voiceAuth: VoiceAuthService,
    private readonly db: DatabaseService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Unified voice pipeline shim: VoiceAuth (best-effort) → ai-orchestrator → TTS (factory).',
  })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async run(
    @UploadedFile() audio: Express.Multer.File,
    @Body() body: Record<string, any>,
    @Request() req: any,
  ) {
    const userId: string = req.user.id;
    const authHeader: string | undefined = req.headers?.authorization;

    let voiceVerification: {
      attempted: boolean;
      verified: boolean;
      confidence?: number;
      speaker_id?: string;
      reason?: string;
    } = { attempted: false, verified: false };

    try {
      const profileRow = await this.db.query<{
        speaker_id: string;
        azure_profile_id: string;
        is_owner: boolean;
        owner_name: string | null;
      }>(
        `SELECT vp.id AS speaker_id, vp.azure_profile_id, vp.is_owner,
                COALESCE(p.preferences->'user_identity'->>'display_name', p.leeloo_name) AS owner_name
         FROM voice_profiles vp
         JOIN profiles p ON p.id = vp.user_id
         WHERE p.clerk_user_id = $1 AND vp.is_active = TRUE
         ORDER BY vp.is_owner DESC, vp.created_at ASC`,
        [userId],
      );
      const candidates = (profileRow.rows as any[]).map((r) => ({
        azureProfileId: r.azure_profile_id,
        speakerId: r.speaker_id,
        isOwner: !!r.is_owner,
      }));
      const ownerName =
        (profileRow.rows as any[]).find((r) => r.is_owner)?.owner_name || 'la dueña';

      if (audio && candidates.length > 0 && this.voiceAuth.isEnabled()) {
        voiceVerification.attempted = true;
        const result = await this.voiceAuth.verifyVoice(userId, audio.buffer, candidates);
        voiceVerification = {
          attempted: true,
          verified: !!result.isOwner,
          confidence: result.confidence,
          speaker_id: result.speakerId,
          reason: result.isOwner ? undefined : this.voiceAuth.getRejectMessage(ownerName),
        };
      }
    } catch (err) {
      this.logger.warn(`[voice-pipeline] biometrics check failed: ${(err as Error).message}`);
    }

    const form = new FormData();
    if (audio) {
      const blob = new Blob([audio.buffer as any], {
        type: audio.mimetype || 'audio/m4a',
      });
      form.append('audio', blob, audio.originalname || 'audio.m4a');
    }
    for (const [k, v] of Object.entries(body || {})) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    if (!form.has('user_id')) form.append('user_id', userId);

    const url = `${ORCHESTRATOR_URL.replace(/\/+$/, '')}/v1/voice/process`;
    let orchestratorJson: any = null;
    let orchestratorStatus = 0;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          Accept: 'application/json',
        },
        body: form as any,
      });
      orchestratorStatus = res.status;
      const ct = res.headers.get('content-type') || '';
      orchestratorJson = ct.includes('application/json') ? await res.json() : await res.text();
    } catch (err) {
      this.logger.warn(`[voice-pipeline] orchestrator call failed: ${(err as Error).message}`);
      return {
        ok: false,
        error: 'ORCHESTRATOR_UNREACHABLE',
        voice_verification: voiceVerification,
      };
    }

    return {
      ok: orchestratorStatus >= 200 && orchestratorStatus < 300,
      status: orchestratorStatus,
      voice_verification: voiceVerification,
      orchestrator: orchestratorJson,
    };
  }
}
