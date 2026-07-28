import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

type AuthedRequest = Request & { user: { id: string } };

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tasks for user' })
  async getTasks(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
  ) {
    return this.tasksService.getTasks(req.user.id, { status, limit });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  async createTask(@Req() req: AuthedRequest, @Body() dto: CreateTaskDto) {
    return this.tasksService.createTask({
      ...dto,
      user_id: req.user.id,
    });
  }

  @Post('complete')
  @ApiOperation({ summary: 'Complete a task by id or title (stub)' })
  async completeTask(@Body() body: { task_id?: string; task_title?: string }) {
    return {
      ok: true,
      mock: true,
      completed: true,
      task_id: body.task_id,
      task_title: body.task_title,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  async updateTask(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.updateTask(req.user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  async deleteTask(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tasksService.deleteTask(req.user.id, id);
  }
}
