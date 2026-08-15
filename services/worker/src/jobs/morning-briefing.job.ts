import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { WorkerDbService } from './worker-db.service';
import { NotificationsJob } from './notifications.job';

export interface MorningBriefingJobData {
  userId: string;
  timezone?: string;
  triggeredAt: string;
}

const BRIEFING_HOUR = 7;

@Injectable()
export class MorningBriefingJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MorningBriefingJob');
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: WorkerDbService,
    private readonly notifications: NotificationsJob,
  ) {}

  async onModuleInit() {
    const checkMs = Number(process.env.MORNING_BRIEFING_CHECK_MS || 5 * 60 * 1000);

    // Initial check after 10 s to catch missed window at startup
    setTimeout(
      () => void this.dispatchPerTimezone().catch(() => {}),
      10_000,
    );

    this.checkTimer = setInterval(() => {
      void this.dispatchPerTimezone().catch((e) =>
        this.logger.warn(`dispatchPerTimezone error: ${String(e)}`),
      );
    }, checkMs);

    this.logger.log(`MorningBriefingJob started — check interval ${checkMs / 60_000} min`);
  }

  async dispatchPerTimezone() {
    if (!this.db.isReady()) return;

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

        await this.execute({
          userId: user.id,
          timezone: tz,
          triggeredAt: now.toISOString(),
        });

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

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const events = await this.db.query<{ title: string; start_at: string | null }>(
      `SELECT title, start_at FROM calendar_events
       WHERE user_id = $1
         AND start_at >= $2 AND start_at <= $3
       ORDER BY start_at ASC
       LIMIT 5`,
      [data.userId, startOfDay.toISOString(), endOfDay.toISOString()],
    );

    const pendingTasks = await this.db.query<{ title: string }>(
      `SELECT title FROM tasks
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 3`,
      [data.userId],
    );

    const greetingLines: string[] = ['¡Buenos días! ☀️ Aquí tu resumen del día:'];

    if (events.rows.length > 0) {
      greetingLines.push('📅 Hoy:');
      for (const ev of events.rows) {
        const time = ev.start_at
          ? new Date(ev.start_at).toLocaleTimeString('es-ES', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';
        greetingLines.push(`  • ${time ? `${time} — ` : ''}${ev.title}`);
      }
    } else {
      greetingLines.push('📅 No tienes eventos hoy.');
    }

    if (pendingTasks.rows.length > 0) {
      greetingLines.push(
        `✅ Pendientes: ${pendingTasks.rows.map((t) => t.title).join(', ')}`,
      );
    }

    greetingLines.push('Estoy aquí cuando me necesites. ¡Que tengas un día increíble! 💪');

    await this.notifications.enqueue({
      userId: data.userId,
      title: '¡Buenos días! Leeloo aquí 👋',
      body: greetingLines.join('\n'),
      data: { type: 'morning_briefing', triggeredAt: data.triggeredAt },
      sound: 'default',
      priority: 'high',
    });

    return {
      ok: true,
      userId: data.userId,
      events: events.rows.length,
      tasks: pendingTasks.rows.length,
    };
  }

  async onModuleDestroy() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}
