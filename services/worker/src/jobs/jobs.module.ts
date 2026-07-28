import { Module } from '@nestjs/common';
import { CalendarGuardianJob } from './calendar-guardian.job';
import { MorningBriefingJob } from './morning-briefing.job';
import { NotificationsService } from './notifications.service';
import { NotificationsJob } from './notifications.job';
import { WorkerDbService } from './worker-db.service';

@Module({
  providers: [
    WorkerDbService,
    CalendarGuardianJob,
    MorningBriefingJob,
    NotificationsService,
    NotificationsJob,
  ],
  exports: [
    WorkerDbService,
    CalendarGuardianJob,
    MorningBriefingJob,
    NotificationsService,
    NotificationsJob,
  ],
})
export class JobsModule {}
