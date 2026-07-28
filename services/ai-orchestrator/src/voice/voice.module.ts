import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { OpenAiQueue } from './workers/openai.queue';

@Module({
  imports: [AuthModule],
  controllers: [VoiceController],
  providers: [VoiceService, OpenAiQueue],
})
export class VoiceModule {}
