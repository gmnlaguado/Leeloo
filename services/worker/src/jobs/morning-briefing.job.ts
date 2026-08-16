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

    const greetingLines: string[] = ['¡Buenos días! ☀️ Aquí tu resumen del día:'];

    if (events.length > 0) {
      greetingLines.push('📅 Hoy:');
      for (const ev of events) {
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

    if (pendingTasks.length > 0) {
      greetingLines.push(
        `✅ Pendientes: ${pendingTasks.map((t) => t.title).join(', ')}`,
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
