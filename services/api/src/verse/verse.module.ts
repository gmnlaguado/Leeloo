import { Module } from '@nestjs/common';
import { VerseController } from './verse.controller';
import { VerseService } from './verse.service';

@Module({
  controllers: [VerseController],
  providers: [VerseService],
  exports: [VerseService],
})
export class VerseModule {}
