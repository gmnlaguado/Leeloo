import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), VoiceModule],
  controllers: [HealthController],
})
export class AppModule {}
