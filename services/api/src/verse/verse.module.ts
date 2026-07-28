import { Module } from '@nestjs/common';
import { VerseController } from './verse.controller';

@Module({
  controllers: [VerseController],
})
export class VerseModule {}
