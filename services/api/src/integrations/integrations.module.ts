import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleGmailService } from './google-gmail.service';
import { MicrosoftCalendarService } from './microsoft-calendar.service';

@Module({
  imports: [DatabaseModule, ProfilesModule, AuthModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    GoogleCalendarService,
    GoogleGmailService,
    MicrosoftCalendarService,
  ],
  exports: [
    IntegrationsService,
    GoogleCalendarService,
    GoogleGmailService,
    MicrosoftCalendarService,
  ],
})
export class IntegrationsModule {}
