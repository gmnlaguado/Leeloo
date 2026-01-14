import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { TasksModule } from '../tasks/tasks.module';
import { MemoriesModule } from '../memories/memories.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { R2Module } from '../r2/r2.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [TasksModule, MemoriesModule, ProfilesModule, R2Module, EmailModule],
  controllers: [VoiceController],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
