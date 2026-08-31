import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { ProfilesModule } from '../profiles/profiles.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [ProfilesModule, IntegrationsModule, TasksModule],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
