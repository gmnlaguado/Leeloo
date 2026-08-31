import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Create a reminder (persisted as task with due_at + scheduler push)' })
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { title: string; datetime: string; recurrence?: string; alarm?: boolean },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    const task = await this.tasksService.createTask({
      user_id: userId,
      title: body.title,
      due_at: body.datetime,
      description: body.recurrence ? `recurrence:${body.recurrence}` : null,
      metadata: {
        source: body.alarm ? 'alarm' : 'reminder',
        recurrence: body.recurrence ?? null,
        alarm: body.alarm ?? false,
      },
    });
    return { ok: true, reminder: task };
  }

  @Get()
  @ApiOperation({ summary: 'List upcoming reminders and alarms' })
  async list(@Req() req: AuthedRequest, @Query('limit') limit?: string) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, reminders: [] };
    const tasks = await this.tasksService.getTasks(userId, {
      status: 'pending',
      limit: limit ? Number(limit) : 20,
    });
    const reminders = (tasks as any[]).filter(
      (t: any) => t.metadata?.source === 'reminder' || t.metadata?.source === 'alarm',
    );
    return { ok: true, reminders };
  }

  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Move a reminder to a new datetime' })
  async reschedule(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { new_datetime: string },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    const task = await this.tasksService.updateTask(userId, id, { due_at: body.new_datetime });
    return { ok: true, reminder: task };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a reminder or alarm' })
  async delete(@Req() req: AuthedRequest, @Param('id') id: string) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    await this.tasksService.deleteTask(userId, id);
    return { ok: true };
  }

  @Get('search')
  @ApiOperation({ summary: 'Find a reminder by title (for voice reschedule/delete)' })
  async search(@Req() req: AuthedRequest, @Query('q') q: string) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, reminders: [] };
    const tasks = await this.tasksService.getTasks(userId, { status: 'pending', limit: 50 });
    const lower = (q ?? '').toLowerCase();
    const matches = (tasks as any[]).filter(
      (t: any) =>
        (t.metadata?.source === 'reminder' || t.metadata?.source === 'alarm') &&
        t.title.toLowerCase().includes(lower),
    );
    return { ok: true, reminders: matches };
  }
}
