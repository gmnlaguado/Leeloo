import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { HouseholdModule } from './household/household.module';
import { ContactsModule } from './contacts/contacts.module';
import { SmsModule } from './sms/sms.module';
import { CartModule } from './cart/cart.module';
import { MediaModule } from './media/media.module';
import { GoalsModule } from './goals/goals.module';
import { VerseModule } from './verse/verse.module';
import { RemindersModule } from './reminders/reminders.module';
import { CryptoModule } from './common/crypto/crypto.module';

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
    CryptoModule,
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
    SmsModule,
    CartModule,
    MediaModule,
    GoalsModule,
    VerseModule,
    RemindersModule,
    DiagnosticsModule,
    HouseholdModule,
    ContactsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
