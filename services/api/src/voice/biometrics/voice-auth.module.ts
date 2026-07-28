import { Module } from '@nestjs/common';
import { VoiceAuthService } from './voice-auth.service';
import { VoiceAuthController } from './voice-auth.controller';
import { VoicePipelineController } from '../pipeline/voice-pipeline.controller';
import { DatabaseModule } from '../../database/database.module';
import { ProfilesModule } from '../../profiles/profiles.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [DatabaseModule, ProfilesModule, AuthModule],
  controllers: [VoiceAuthController, VoicePipelineController],
  providers: [VoiceAuthService],
  exports: [VoiceAuthService],
})
export class VoiceAuthModule {}
