import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import type {
  GmailSyncJob,
  GoogleCalendarSyncJob,
  IntegrationJobName,
} from './integrations.queue.service';

@Injectable()
export class IntegrationsWorkerService implements OnModuleInit, OnModuleDestroy {
  private connection: IORedis | null = null;
  private worker: Worker | null = null;

  async onModuleInit() {
    const redisUrl = String(process.env.REDIS_URL || '').trim();
    if (!redisUrl) {
      throw new Error('REDIS_URL is required');
    }

    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.worker = new Worker(
      'integrations',
      async (job: Job) => {
        const name = job.name as IntegrationJobName;

        if (name === 'google_calendar_sync') {
          const data = job.data as GoogleCalendarSyncJob;
          return { ok: true, job: name, userId: data.userId };
        }

        if (name === 'gmail_sync') {
          const data = job.data as GmailSyncJob;
          return { ok: true, job: name, userId: data.userId };
        }

        return { ok: false, message: `Unknown job: ${job.name}` };
      },
      {
        connection: this.connection,
        concurrency: Number(process.env.INTEGRATIONS_WORKER_CONCURRENCY || 2),
      },
    );

    this.worker.on('failed', (job, err) => {
      console.warn('[worker][integrations] job failed', {
        jobId: job?.id,
        name: job?.name,
        error: String(err),
      });
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.worker = null;

    await this.connection?.quit();
    this.connection = null;
  }
}
