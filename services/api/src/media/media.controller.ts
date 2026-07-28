import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('media')
@Controller('media')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class MediaController {
  @Post('play')
  @ApiOperation({ summary: 'Play media on platform (stub)' })
  async play(@Body() body: { platform: string; query: string }) {
    return {
      ok: true,
      mock: true,
      platform: body.platform,
      query: body.query,
    };
  }
}
