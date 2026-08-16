import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { WorkerDbService } from './worker-db.service';
import { NotificationsJob } from './notifications.job';

export interface CalendarGuardianJobData {
  userId?: string;
  triggeredAt: string;
}

@Injectable()
export class CalendarGuardianJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('CalendarGuardianJob');
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: WorkerDbService,
    private readonly notifications: NotificationsJob,
  ) {}

  async onModuleInit() {
    const intervalMs = Number(process.env.CALENDAR_GUARDIAN_INTERVAL_MS || 15 * 60 * 1000);

    setTimeout(() => {
      void this.scheduleSweep().catch((e) =>
        this.logger.warn(`Initial sweep error: ${String(e)}`),
      );
    }, 30_000);

    this.sweepTimer = setInterval(() => {
      void this.scheduleSweep().catch((e) =>
        this.logger.warn(`scheduleSweep error: ${String(e)}`),
      );
    }, intervalMs);

    this.logger.log(`CalendarGuardianJob started — interval ${intervalMs / 60_000} min`);
  }

  async scheduleSweep() {
    const triggeredAt = new Date().toISOString();
    const userIds = await this.listActiveUserIds();

    if (userIds.length === 0) {
      this.logger.debug('[calendar-guardian] no active users to sweep');
      return;
    }

    for (const userId of userIds) {
      await Promise.allSettled([
        this.alertUpcomingEvents({ userId, triggeredAt }),
        this.alertOverdueTasks({ userId, triggeredAt }),
        this.alertPendingApprovals({ userId, triggeredAt }),
        this.detectCalendarConflicts({ userId, triggeredAt }),
      ]);
    }

    const now = new Date();
    if (now.getHours() === 21 && now.getMinutes() < 15) {
      for (const userId of userIds) {
        await this.prepareTomorrowBriefing({ userId, triggeredAt }).catch((e) =>
          this.logger.warn(`[calendar-guardian] briefing error user=${userId}: ${String(e)}`),
        );
      }
    }
  }

  private async listActiveUserIds(): Promise<string[]> {
    if (!this.db.isReady()) return [];
    return this.db.listActiveUserIds();
  }

  async alertUpcomingEvents(data: CalendarGuardianJobData) {
    const userId = data.userId;
    if (!userId || !this.db.isReady()) return { ok: false, alerted: 0 };

    const events = await this.db.getUpcomingEvents(userId);
    let alerted = 0;

    for (const ev of events) {
      const minutesUntil = Math.max(
        0,
        Math.round((new Date(ev.start_at).getTime() - Date.now()) / 60000),
      );

      if (await this.db.hasMention(userId, 'upcoming_event', 'event_id', ev.id)) continue;

      await this.db.insertMention(userId, 'upcoming_event', {
        event_id: ev.id,
        title: ev.title,
        start_at: ev.start_at,
        location: ev.location,
        minutes_until: minutesUntil,
      });

      await this.notifications.enqueue({
        userId,
        title: 'Próximo evento',
        body: `${ev.title} en ${minutesUntil} min${ev.location ? ` · ${ev.location}` : ''}`,
        data: { type: 'upcoming_event', eventId: ev.id, minutesUntil },
        priority: 'high',
      });
      alerted++;
    }

    return { ok: true, alerted };
  }

  async alertOverdueTasks(data: CalendarGuardianJobData) {
    const userId = data.userId;
    if (!userId || !this.db.isReady()) return { ok: false, overdue: 0 };

    const tasks = await this.db.getOverdueTasks(userId);
    let overdue = 0;

    for (const t of tasks) {
      if (await this.db.hasMention(userId, 'overdue_task', 'task_id', t.id)) continue;

      await this.db.insertMention(userId, 'overdue_task', {
        task_id: t.id,
        title: t.title,
        due_at: t.due_at,
      });

      await this.notifications.enqueue({
        userId,
        title: 'Tarea vencida',
        body: t.title,
        data: { type: 'overdue_task', taskId: t.id },
      });
      overdue++;
    }

    return { ok: true, overdue };
  }

  async alertPendingApprovals(data: CalendarGuardianJobData) {
    const userId = data.userId;
    if (!userId || !this.db.isReady()) return { ok: false, pending: 0 };

    const requests = await this.db.getPendingApprovals(userId);
    let pending = 0;

    for (const r of requests) {
      if (await this.db.hasMention(userId, 'pending_approval', 'request_id', r.id)) continue;

      await this.db.insertMention(userId, 'pending_approval', {
        request_id: r.id,
        child_name: r.child_name,
        message: r.message,
      });

      await this.notifications.enqueue({
        userId,
        title: `${r.child_name} espera tu aprobación`,
        body: r.message.slice(0, 140),
        data: { type: 'pending_approval', requestId: r.id },
      });
      pending++;
    }

    return { ok: true, pending };
  }

  async detectCalendarConflicts(data: CalendarGuardianJobData) {
    const userId = data.userId;
    if (!userId || !this.db.isReady()) return { ok: false, conflicts: 0 };

    const conflicts = await this.db.getCalendarConflicts(userId);
    let count = 0;

    for (const c of conflicts) {
      const conflictKey = `${c.a.id}:${c.b.id}`;
      if (await this.db.hasMention(userId, 'calendar_conflict', 'conflict_key', conflictKey)) continue;

      await this.db.insertMention(userId, 'calendar_conflict', {
        conflict_key: conflictKey,
        a: { id: c.a.id, title: c.a.title, start: c.a.start, end: c.a.end },
        b: { id: c.b.id, title: c.b.title, start: c.b.start, end: c.b.end },
      });
      count++;
    }

    if (count > 0) {
      await this.notifications.enqueue({
        userId,
        title: 'Conflicto de calendario',
        body: `Detecté ${count} solapamiento${count === 1 ? '' : 's'} esta semana.`,
        data: { type: 'calendar_conflict', count },
      });
    }

    return { ok: true, conflicts: count };
  }

  async prepareTomorrowBriefing(data: CalendarGuardianJobData) {
    const userId = data.userId;
    if (!userId || !this.db.isReady()) return { ok: false };

    const now = new Date();
    if (!(now.getHours() === 21 && now.getMinutes() < 30)) {
      return { ok: false, skipped: 'outside_window' };
    }

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const briefingDate = tomorrow.toISOString().slice(0, 10);

    const [events, tasks] = await Promise.all([
      this.db.getTomorrowEvents(userId),
      this.db.getPendingTasksDue(userId, tomorrow),
    ]);

    const lines: string[] = ['Mañana tienes:'];
    if (events.length === 0) {
      lines.push('· Agenda libre.');
    } else {
      for (const ev of events) {
        const t = new Date(ev.start_at).toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
        });
        lines.push(`· ${t} — ${ev.title}${ev.location ? ` (${ev.location})` : ''}`);
      }
    }
    if (tasks.length > 0) {
      lines.push('');
      lines.push('Pendientes:');
      for (const t of tasks) lines.push(`· ${t.title}`);
    }

    await this.db.insertBriefing(userId, briefingDate, lines.join('\n'));

    await this.notifications.enqueue({
      userId,
      title: 'Resumen de mañana',
      body: events.length === 0 ? 'Agenda libre.' : `${events.length} eventos planeados.`,
      data: { type: 'tomorrow_briefing', date: briefingDate },
    });

    return { ok: true, events: events.length, tasks: tasks.length };
  }

  async onModuleDestroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
