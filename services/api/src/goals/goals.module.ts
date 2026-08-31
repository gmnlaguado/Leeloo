import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { DatabaseModule } from '../database/database.module';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [DatabaseModule, ProfilesModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
