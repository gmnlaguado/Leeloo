import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('goals')
@Controller('goals')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class GoalsController {
  @Post()
  @ApiOperation({ summary: 'Create goal (stub)' })
  async create(@Body() body: { title: string; target_date?: string; category?: string }) {
    return {
      ok: true,
      mock: true,
      goal: body,
    };
  }
}
