import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { WorkerDbService } from './worker-db.service';
import { NotificationsJob } from './notifications.job';

export interface MorningBriefingJobData {
  userId: string;
  timezone?: string;
  triggeredAt: string;
}

const QUEUE_NAME = 'morning-briefing';
const BRIEFING_HOUR = 7; // 7:00am local time

@Injectable()
export class MorningBriefingJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MorningBriefingJob');
  private connection: IORedis | null = null;
  private worker: Worker | null = null;
  private queue: Queue | null = null;
  private cronTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: WorkerDbService,
    private readonly notifications: NotificationsJob,
  ) {}

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

    // Run once on startup to catch any missed window
    setTimeout(() => void this.dispatchPerTimezone().catch(() => {}), 10_000);
  }

  async dispatchPerTimezone() {
    if (!this.db.isReady() || !this.queue) return;

    // Find users whose current local hour = BRIEFING_HOUR and haven't been briefed today
    const res = await this.db.query<{
      id: string;
      timezone: string | null;
      display_name: string | null;
    }>(
      `SELECT p.id, p.timezone, p.preferences->'user_identity'->>'display_name' AS display_name
       FROM profiles p
       WHERE p.expo_push_token IS NOT NULL
         AND (
           p.preferences->>'morning_briefing_enabled' IS NULL
           OR p.preferences->>'morning_briefing_enabled' = 'true'
         )
         AND (
           p.preferences->>'morning_briefing_last_sent' IS NULL
           OR (p.preferences->>'morning_briefing_last_sent')::date < CURRENT_DATE
         )`,
    );

    const now = new Date();
    let dispatched = 0;

    for (const user of res.rows) {
      try {
        const tz = user.timezone || 'America/Bogota';
        const localHour = new Date(
          now.toLocaleString('en-US', { timeZone: tz }),
        ).getHours();

        if (localHour !== BRIEFING_HOUR) continue;

        await this.enqueue({
          userId: user.id,
          timezone: tz,
          triggeredAt: now.toISOString(),
        });

        // Mark as sent for today so we don't double-send
        await this.db.query(
          `UPDATE profiles SET preferences = preferences || $1::jsonb WHERE id = $2`,
          [JSON.stringify({ morning_briefing_last_sent: now.toISOString() }), user.id],
        );

        dispatched++;
      } catch (err) {
        this.logger.warn(`[morning-briefing] dispatch error user=${user.id}: ${String(err)}`);
      }
    }

    if (dispatched > 0) {
      this.logger.log(`[morning-briefing] dispatched ${dispatched} briefings`);
    }
  }

  async execute(data: MorningBriefingJobData) {
    this.logger.log(`morningBriefing.execute user=${data.userId}`);

    // Get today's agenda from calendar_events
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const events = await this.db.query<{ title: string; starts_at: string | null }>(
      `SELECT title, starts_at FROM calendar_events
       WHERE user_id = $1
         AND starts_at >= $2 AND starts_at <= $3
         AND deleted_at IS NULL
       ORDER BY starts_at ASC
       LIMIT 5`,
      [data.userId, startOfDay.toISOString(), endOfDay.toISOString()],
    );

    const pendingTasks = await this.db.query<{ title: string }>(
      `SELECT title FROM tasks
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 3`,
      [data.userId],
    );

    // Build greeting message
    const greetingLines: string[] = ['Good morning! ☀️ Here is your day at a glance:'];

    if (events.rows.length > 0) {
      greetingLines.push('📅 Today:');
      for (const ev of events.rows) {
        const time = ev.starts_at
          ? new Date(ev.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : '';
        greetingLines.push(`  • ${time ? `${time} — ` : ''}${ev.title}`);
      }
    } else {
      greetingLines.push('📅 No events scheduled today.');
    }

    if (pendingTasks.rows.length > 0) {
      greetingLines.push(`✅ Pending tasks: ${pendingTasks.rows.map((t) => t.title).join(', ')}`);
    }

    greetingLines.push("I'm here whenever you need me. Have an amazing day! 💪");

    await this.notifications.enqueue({
      userId: data.userId,
      title: 'Good morning! Leeloo here 👋',
      body: greetingLines.join('\n'),
      data: { type: 'morning_briefing', triggeredAt: data.triggeredAt },
      sound: 'default',
      priority: 'high',
    });

    return { ok: true, userId: data.userId, events: events.rows.length, tasks: pendingTasks.rows.length };
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
