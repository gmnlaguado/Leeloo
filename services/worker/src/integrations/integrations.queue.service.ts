import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export type IntegrationJobName = 'google_calendar_sync' | 'gmail_sync';

export type GoogleCalendarSyncJob = {
  userId: string;
};

export type GmailSyncJob = {
  userId: string;
};

@Injectable()
export class IntegrationsQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor() {
    const redisUrl = String(process.env.REDIS_URL || '').trim();
    if (!redisUrl) {
      throw new Error('REDIS_URL is required');
    }

    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.queue = new Queue('integrations', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }

  async enqueueGoogleCalendarSync(payload: GoogleCalendarSyncJob) {
    return this.queue.add('google_calendar_sync', payload, {
      jobId: `google_calendar_sync:${payload.userId}`,
    });
  }

  async enqueueGmailSync(payload: GmailSyncJob) {
    return this.queue.add('gmail_sync', payload, {
      jobId: `gmail_sync:${payload.userId}`,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
