import { Module } from '@nestjs/common';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { DatabaseModule } from '../database/database.module';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [DatabaseModule, ProfilesModule],
  controllers: [FamilyController],
  providers: [FamilyService],
  exports: [FamilyService],
})
export class FamilyModule {}
