import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { NotificationsService, SendPushArgs } from './notifications.service';

const QUEUE_NAME = 'notifications';

@Injectable()
export class NotificationsJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NotificationsJob');
  private connection: IORedis | null = null;
  private worker: Worker | null = null;
  private queue: Queue | null = null;

  constructor(private readonly notifications: NotificationsService) {}

  async onModuleInit() {
    const redisUrl = String(process.env.REDIS_URL || '').trim();
    if (!redisUrl) {
      this.logger.warn('REDIS_URL missing — NotificationsJob disabled');
      return;
    }
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => this.notifications.sendPush(job.data as SendPushArgs),
      {
        connection: this.connection,
        concurrency: Number(process.env.NOTIFICATIONS_CONCURRENCY || 4),
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(`[notifications] failed id=${job?.id} err=${String(err)}`);
    });
  }

  async enqueue(args: SendPushArgs) {
    if (!this.queue) {
      this.logger.warn('[notifications] queue unavailable — sending inline');
      return this.notifications.sendPush(args);
    }
    return this.queue.add('send', args, { removeOnComplete: 200, removeOnFail: 200 });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.worker = null;
    await this.queue?.close();
    this.queue = null;
    await this.connection?.quit();
    this.connection = null;
  }
}
