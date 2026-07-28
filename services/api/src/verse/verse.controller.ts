import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('verse')
@Controller('verse')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class VerseController {
  @Get('daily')
  @ApiOperation({ summary: 'Get daily verse (stub)' })
  async daily() {
    return {
      ok: true,
      mock: true,
      verse: {
        reference: 'Psalm 23:1',
        text: 'The Lord is my shepherd; I shall not want.',
      },
    };
  }
}
