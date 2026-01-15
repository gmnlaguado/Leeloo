import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiagnosticsController } from './diagnostics.controller';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [ConfigModule, ProfilesModule],
  controllers: [DiagnosticsController],
})
export class DiagnosticsModule {}
