import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { HouseholdController } from './household.controller';
import { HouseholdService } from './household.service';

@Module({
  imports: [ProfilesModule],
  controllers: [HouseholdController],
  providers: [HouseholdService],
  exports: [HouseholdService],
})
export class HouseholdModule {}
