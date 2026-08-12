import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [TasksModule],
  controllers: [RemindersController],
})
export class RemindersModule {}
