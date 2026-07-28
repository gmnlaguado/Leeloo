import {
  Body,
  Controller,
  Post,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as multer from 'multer';
import type { Express } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { DatabaseService } from '../../database/database.service';
import { ProfilesService } from '../../profiles/profiles.service';
import { VoiceAuthService } from './voice-auth.service';

@ApiTags('voice-auth')
@Controller('voice/enroll')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class VoiceAuthController {
  constructor(
    private readonly voiceAuthService: VoiceAuthService,
    private readonly databaseService: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Enroll voice biometric profile (3+ audio clips of >=8s)' })
  @UseInterceptors(
    FilesInterceptor('audio', 6, {
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async enroll(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { profile_name?: string; is_owner?: string | boolean },
    @Request() req: any,
  ) {
    const userId = req.user.id;
    const profile = await this.profilesService.ensureProfileByClerkUserId(userId, {});
    const profileName = (body?.profile_name || 'owner').toString().trim() || 'owner';
    const isOwner = body?.is_owner === true || body?.is_owner === 'true' || profileName === 'owner';

    if (!files || files.length < 3) {
      return {
        ok: false,
        error: 'AT_LEAST_3_AUDIO_CLIPS_REQUIRED',
      };
    }

    const chunks = files.map((f) => f.buffer);
    const { azureProfileId, status } = await this.voiceAuthService.enrollVoice(userId, chunks);

    try {
      await this.databaseService.query(
        `INSERT INTO voice_profiles (user_id, profile_name, azure_profile_id, is_owner, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (user_id, profile_name)
         DO UPDATE SET azure_profile_id = EXCLUDED.azure_profile_id,
                       is_owner = EXCLUDED.is_owner,
                       is_active = TRUE,
                       updated_at = NOW()`,
        [profile.id, profileName, azureProfileId, isOwner],
      );
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        azureProfileId,
        status,
      };
    }

    return {
      ok: true,
      profile_name: profileName,
      is_owner: isOwner,
      status,
      azure_profile_id: azureProfileId,
    };
  }
}
