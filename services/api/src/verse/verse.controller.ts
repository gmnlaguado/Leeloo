import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { VerseService } from './verse.service';

@ApiTags('verse')
@Controller('verse')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class VerseController {
  constructor(private readonly verseService: VerseService) {}

  @Get('daily')
  @ApiOperation({ summary: 'Get daily verse from bible-api.com (rotates daily)' })
  async daily() {
    const verse = await this.verseService.getDailyVerse();
    return { ok: true, verse };
  }
}
