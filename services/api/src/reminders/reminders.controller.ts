import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('reminders')
@Controller('reminders')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class RemindersController {
  @Post()
  @ApiOperation({ summary: 'Create reminder (stub)' })
  async create(@Body() body: { title: string; datetime: string; recurrence?: string }) {
    return {
      ok: true,
      mock: true,
      reminder: body,
    };
  }
}
