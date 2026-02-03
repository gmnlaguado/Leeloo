import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { RemindersScheduler } from './reminders.scheduler';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TasksModule } from '../tasks/tasks.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [ProfilesModule, IntegrationsModule, TasksModule, EmailModule],
  controllers: [CalendarController],
  providers: [CalendarService, RemindersScheduler],
  exports: [CalendarService],
})
export class CalendarModule {}
