import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { RemindersScheduler } from './reminders.scheduler';

@Module({
  imports: [ProfilesModule],
  controllers: [CalendarController],
  providers: [CalendarService, RemindersScheduler],
  exports: [CalendarService],
})
export class CalendarModule {}
