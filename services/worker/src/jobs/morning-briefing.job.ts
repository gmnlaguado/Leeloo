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

    const users = await this.db.getUsersForMorningBriefing();
    const now = new Date();
    let dispatched = 0;

    for (const user of users) {
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

        await this.db.updateMorningBriefingLastSent(user.id, now.toISOString());
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

    const [events, pendingTasks] = await Promise.all([
      this.db.getTodayEvents(data.userId, startOfDay, endOfDay),
      this.db.getPendingTasksLimited(data.userId, 3),
    ]);

    // Build a warm, human morning greeting — not a task list dump
    const hour = new Date().getHours();
    const greetingOpeners = [
      '¡Buenos días! ☀️ Aquí estoy.',
      '¡Buenos días! Ya estoy lista para el día.',
      '¡Hola! ¿Cómo amaneciste? 🌅',
    ];
    const opener = greetingOpeners[hour % greetingOpeners.length];

    const greetingLines: string[] = [opener];

    if (events.length > 0) {
      const firstEvent = events[0];
      const time = firstEvent.start_at
        ? new Date(firstEvent.start_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : '';
      if (events.length === 1) {
        greetingLines.push(`📅 Hoy tienes ${time ? `a las ${time}: ` : ''}${firstEvent.title}.`);
      } else {
        greetingLines.push(`📅 Hoy tienes ${events.length} cosas en el calendario. La primera: ${time ? `${time} — ` : ''}${firstEvent.title}.`);
      }
    } else {
      greetingLines.push('📅 Tienes el día libre hoy — úsalo bien.');
    }

    if (pendingTasks.length > 0) {
      const firstTask = pendingTasks[0].title;
      greetingLines.push(`✅ Una cosa clave de hoy: ${firstTask}.`);
    }

    greetingLines.push('Toca aquí para tu Morning Meeting conmigo. 💬');

    await this.notifications.enqueue({
      userId: data.userId,
      title: '¡Buenos días! ☀️ Leeloo aquí',
      body: greetingLines.join('\n'),
      data: { type: 'morning_briefing', triggeredAt: data.triggeredAt },
      sound: 'default',
      priority: 'high',
    });

    return {
      ok: true,
      userId: data.userId,
      events: events.length,
      tasks: pendingTasks.length,
    };
  }

  async onModuleDestroy() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}
