import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';

export interface MorningBriefingJobData {
  userId: string;
  timezone?: string;
  triggeredAt: string;
}

const QUEUE_NAME = 'morning-briefing';

@Injectable()
export class MorningBriefingJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MorningBriefingJob');
  private connection: IORedis | null = null;
  private worker: Worker | null = null;
  private queue: Queue | null = null;
  private cronTimer: NodeJS.Timeout | null = null;

  async onModuleInit() {
    const redisUrl = String(process.env.REDIS_URL || '').trim();
    if (!redisUrl) {
      this.logger.warn('REDIS_URL missing — MorningBriefingJob disabled');
      return;
    }
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => this.execute(job.data as MorningBriefingJobData),
      {
        connection: this.connection,
        concurrency: Number(process.env.MORNING_BRIEFING_CONCURRENCY || 4),
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(`[morning-briefing] failed id=${job?.id} err=${String(err)}`);
    });

    const checkMs = Number(process.env.MORNING_BRIEFING_CHECK_MS || 5 * 60 * 1000);
    this.cronTimer = setInterval(() => {
      void this.dispatchPerTimezone().catch((e) =>
        this.logger.warn(`dispatchPerTimezone error: ${String(e)}`),
      );
    }, checkMs);
  }

  async dispatchPerTimezone() {
    this.logger.log('dispatchPerTimezone: scanning users whose local time is 7:00am');
  }

  async execute(data: MorningBriefingJobData) {
    this.logger.log(`morningBriefing.execute user=${data.userId}`);
    return { ok: true, userId: data.userId };
  }

  async enqueue(data: MorningBriefingJobData) {
    if (!this.queue) return null;
    return this.queue.add('execute', data, { removeOnComplete: 100, removeOnFail: 100 });
  }

  async onModuleDestroy() {
    if (this.cronTimer) {
      clearInterval(this.cronTimer);
      this.cronTimer = null;
    }
    await this.worker?.close();
    this.worker = null;
    await this.queue?.close();
    this.queue = null;
    await this.connection?.quit();
    this.connection = null;
  }
}
