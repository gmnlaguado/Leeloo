import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { TasksService } from '../tasks/tasks.service';

type AuthedRequest = { user?: { id: string } };

@ApiTags('reminders')
@Controller('reminders')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class RemindersController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a reminder — persisted as a task with due_at so the scheduler fires a push notification' })
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { title: string; datetime: string; recurrence?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };

    const task = await this.tasksService.createTask({
      user_id: userId,
      title: body.title,
      due_at: body.datetime,
      description: body.recurrence ? `recurrence:${body.recurrence}` : null,
      metadata: { source: 'reminder', recurrence: body.recurrence ?? null },
    });

    return { ok: true, reminder: task };
  }
}
