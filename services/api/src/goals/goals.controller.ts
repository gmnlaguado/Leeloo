import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { GoalsService } from './goals.service';

type AuthedRequest = { user?: { id: string } };

@ApiTags('goals')
@Controller('goals')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a goal' })
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { title: string; target_date?: string; category?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    const goal = await this.goalsService.createGoal(userId, body);
    return { ok: true, goal };
  }

  @Get()
  @ApiOperation({ summary: 'List active goals' })
  async list(@Req() req: AuthedRequest) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, goals: [] };
    const goals = await this.goalsService.listGoals(userId);
    return { ok: true, goals };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update goal progress or status' })
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { progress?: number; status?: string; notes?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    const goal = await this.goalsService.updateGoal(userId, id, body);
    return { ok: true, goal };
  }
}
