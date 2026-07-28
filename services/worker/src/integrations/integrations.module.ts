import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsQueueService } from './integrations.queue.service';
import { IntegrationsWorkerService } from './integrations.worker.service';

@Module({
  imports: [ConfigModule],
  providers: [IntegrationsQueueService, IntegrationsWorkerService],
  exports: [IntegrationsQueueService],
})
export class IntegrationsModule {}
