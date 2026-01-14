import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { VoiceModule } from './voice/voice.module';
import { TasksModule } from './tasks/tasks.module';
import { CalendarModule } from './calendar/calendar.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { MemoriesModule } from './memories/memories.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { ProfilesModule } from './profiles/profiles.module';
import { R2Module } from './r2/r2.module';
import { HealthModule } from './health/health.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    DatabaseModule,
    ProfilesModule,
    R2Module,
    HealthModule,
    AuthModule,
    VoiceModule,
    TasksModule,
    CalendarModule,
    IntegrationsModule,
    MemoriesModule,
    EmailModule,
  ],
})
export class AppModule {}
