import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { WorkerDbService } from './worker-db.service';
import { NotificationsJob } from './notifications.job';

const CHECKIN_HOUR = 21; // 9pm local time

@Injectable()
export class EveningCheckinJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EveningCheckinJob');
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: WorkerDbService,
    private readonly notifications: NotificationsJob,
  ) {}

  async onModuleInit() {
    const checkMs = Number(process.env.EVENING_CHECKIN_CHECK_MS || 5 * 60 * 1000);

    setTimeout(
      () => void this.dispatchPerTimezone().catch(() => {}),
      15_000,
    );

    this.checkTimer = setInterval(() => {
      void this.dispatchPerTimezone().catch((e) =>
        this.logger.warn(`dispatchPerTimezone error: ${String(e)}`),
      );
    }, checkMs);

    this.logger.log(`EveningCheckinJob started — check interval ${checkMs / 60_000} min`);
  }

  async dispatchPerTimezone() {
    if (!this.db.isReady()) return;

    const users = await this.db.getUsersForEveningCheckin();
    const now = new Date();
    let dispatched = 0;

    for (const user of users) {
      try {
        const tz = user.timezone || 'America/Bogota';
        const localHour = new Date(
          now.toLocaleString('en-US', { timeZone: tz }),
        ).getHours();

        if (localHour !== CHECKIN_HOUR) continue;

        await this.execute({ userId: user.id, timezone: tz, triggeredAt: now.toISOString() });
        await this.db.updateEveningCheckinLastSent(user.id, now.toISOString());
        dispatched++;
      } catch (err) {
        this.logger.warn(`[evening-checkin] dispatch error user=${user.id}: ${String(err)}`);
      }
    }

    if (dispatched > 0) {
      this.logger.log(`[evening-checkin] dispatched ${dispatched} check-ins`);
    }
  }

  async execute(data: { userId: string; timezone?: string; triggeredAt: string }) {
    this.logger.log(`eveningCheckin.execute user=${data.userId}`);

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const completedTasks = await this.db.getCompletedTasksToday(data.userId, startOfDay, endOfDay);
    const pendingTasks = await this.db.getPendingTasksLimited(data.userId, 3);

    const messages = [
      '¡Buenas noches! 🌙',
      completedTasks.length > 0
        ? `Hoy completaste ${completedTasks.length} tarea${completedTasks.length !== 1 ? 's' : ''}. ¡Bien hecho! 🎯`
        : 'Espero que hayas tenido un buen día. ✨',
      pendingTasks.length > 0
        ? `Para mañana tienes: ${pendingTasks.slice(0, 2).map((t) => t.title).join(', ')}.`
        : 'No tienes pendientes para mañana. Descansa bien. 😊',
      'Estoy aquí si necesitas algo antes de dormir.',
    ];

    await this.notifications.enqueue({
      userId: data.userId,
      title: '¡Buenas noches! Leeloo aquí 🌙',
      body: messages.join('\n'),
      data: { type: 'evening_checkin', triggeredAt: data.triggeredAt },
      sound: 'default',
      priority: 'normal',
    });

    return { ok: true, userId: data.userId, completedTasks: completedTasks.length };
  }

  async onModuleDestroy() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}
