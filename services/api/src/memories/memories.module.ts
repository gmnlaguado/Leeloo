import { Module } from '@nestjs/common';
import { MemoriesService } from './memories.service';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [ProfilesModule],
  providers: [MemoriesService],
  exports: [MemoriesService],
})
export class MemoriesModule {}
