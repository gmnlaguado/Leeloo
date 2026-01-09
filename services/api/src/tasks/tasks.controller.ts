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
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tasks for user' })
  async getTasks(@Request() req, @Query('status') status?: string, @Query('limit') limit?: number) {
    return this.tasksService.getTasks(req.user.id, { status, limit });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  async createTask(@Request() req, @Body() dto: CreateTaskDto) {
    return this.tasksService.createTask({
      ...dto,
      user_id: req.user.id,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  async updateTask(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.updateTask(req.user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  async deleteTask(@Request() req: any, @Param('id') id: string) {
    return this.tasksService.deleteTask(req.user.id, id);
  }
}
