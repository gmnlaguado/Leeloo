import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [DatabaseModule, ProfilesModule, AuthModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, GoogleCalendarService],
  exports: [IntegrationsService, GoogleCalendarService],
})
export class IntegrationsModule {}
