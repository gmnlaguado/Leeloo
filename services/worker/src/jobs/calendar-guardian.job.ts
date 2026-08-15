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

    // Initial sweep after 30 s to let the pool stabilise
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
    const res = await this.db.query<{ id: string }>(
      `SELECT DISTINCT id FROM profiles
       WHERE id IN (
         SELECT user_id FROM calendar_events WHERE start_at >= NOW() - INTERVAL '1 day'
         UNION
         SELECT user_id FROM tasks WHERE status = 'pending'
         UNION
         SELECT parent_id AS user_id FROM child_requests WHERE approved = false
       )`,
    );
    return res.rows.map((r) => r.id).filter(Boolean);
  }

  async alertUpcomingEvents(data: CalendarGuardianJobData) {
    const userId = data.userId;
    if (!userId || !this.db.isReady()) return { ok: false, alerted: 0 };

    const res = await this.db.query<{
      id: string;
      title: string;
      start_at: string;
      location: string | null;
    }>(
      `SELECT id, title, start_at, location FROM calendar_events
       WHERE user_id = $1
         AND start_at BETWEEN NOW() AND NOW() + INTERVAL '2 hours'
       ORDER BY start_at ASC`,
      [userId],
    );

    let alerted = 0;
    for (const ev of res.rows) {
      const minutesUntil = Math.max(
        0,
        Math.round((new Date(ev.start_at).getTime() - Date.now()) / 60000),
      );

      const dedup = await this.db.query(
        `SELECT 1 FROM pending_leeloo_mentions
         WHERE user_id = $1 AND mention_kind = 'upcoming_event'
           AND payload->>'event_id' = $2 AND consumed = false
         LIMIT 1`,
        [userId, ev.id],
      );
      if (dedup.rows.length > 0) continue;

      await this.db.query(
        `INSERT INTO pending_leeloo_mentions (user_id, mention_kind, payload)
         VALUES ($1, 'upcoming_event', $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            event_id: ev.id,
            title: ev.title,
            start_at: ev.start_at,
            location: ev.location,
            minutes_until: minutesUntil,
          }),
        ],
      );

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

    const res = await this.db.query<{ id: string; title: string; due_at: string }>(
      `SELECT id, title, due_at FROM tasks
       WHERE user_id = $1 AND status = 'pending'
         AND due_at IS NOT NULL AND due_at < NOW()
       ORDER BY due_at ASC
       LIMIT 20`,
      [userId],
    );

    let overdue = 0;
    for (const t of res.rows) {
      const dedup = await this.db.query(
        `SELECT 1 FROM pending_leeloo_mentions
         WHERE user_id = $1 AND mention_kind = 'overdue_task'
           AND payload->>'task_id' = $2 AND consumed = false
         LIMIT 1`,
        [userId, t.id],
      );
      if (dedup.rows.length > 0) continue;

      await this.db.query(
        `INSERT INTO pending_leeloo_mentions (user_id, mention_kind, payload)
         VALUES ($1, 'overdue_task', $2::jsonb)`,
        [userId, JSON.stringify({ task_id: t.id, title: t.title, due_at: t.due_at })],
      );

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

    const res = await this.db.query<{
      id: string;
      child_name: string;
      message: string;
      created_at: string;
    }>(
      `SELECT id, child_name, message, created_at FROM child_requests
       WHERE parent_id = $1 AND approved = false
         AND created_at < NOW() - INTERVAL '1 hour'
       ORDER BY created_at ASC
       LIMIT 20`,
      [userId],
    );

    let pending = 0;
    for (const r of res.rows) {
      const dedup = await this.db.query(
        `SELECT 1 FROM pending_leeloo_mentions
         WHERE user_id = $1 AND mention_kind = 'pending_approval'
           AND payload->>'request_id' = $2 AND consumed = false
         LIMIT 1`,
        [userId, r.id],
      );
      if (dedup.rows.length > 0) continue;

      await this.db.query(
        `INSERT INTO pending_leeloo_mentions (user_id, mention_kind, payload)
         VALUES ($1, 'pending_approval', $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            request_id: r.id,
            child_name: r.child_name,
            message: r.message,
          }),
        ],
      );

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

    const res = await this.db.query<{
      a_id: string;
      a_title: string;
      a_start: string;
      a_end: string;
      b_id: string;
      b_title: string;
      b_start: string;
      b_end: string;
    }>(
      `SELECT a.id AS a_id, a.title AS a_title, a.start_at AS a_start, a.end_at AS a_end,
              b.id AS b_id, b.title AS b_title, b.start_at AS b_start, b.end_at AS b_end
       FROM calendar_events a
       JOIN calendar_events b
         ON a.user_id = b.user_id AND a.id < b.id
        AND a.start_at < b.end_at AND b.start_at < a.end_at
       WHERE a.user_id = $1
         AND a.start_at >= NOW() AND a.start_at < NOW() + INTERVAL '7 days'
       ORDER BY a.start_at ASC
       LIMIT 20`,
      [userId],
    );

    let conflicts = 0;
    for (const c of res.rows) {
      const conflictKey = `${c.a_id}:${c.b_id}`;
      const dedup = await this.db.query(
        `SELECT 1 FROM pending_leeloo_mentions
         WHERE user_id = $1 AND mention_kind = 'calendar_conflict'
           AND payload->>'conflict_key' = $2 AND consumed = false
         LIMIT 1`,
        [userId, conflictKey],
      );
      if (dedup.rows.length > 0) continue;

      await this.db.query(
        `INSERT INTO pending_leeloo_mentions (user_id, mention_kind, payload)
         VALUES ($1, 'calendar_conflict', $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            conflict_key: conflictKey,
            a: { id: c.a_id, title: c.a_title, start: c.a_start, end: c.a_end },
            b: { id: c.b_id, title: c.b_title, start: c.b_start, end: c.b_end },
          }),
        ],
      );
      conflicts++;
    }

    if (conflicts > 0) {
      await this.notifications.enqueue({
        userId,
        title: 'Conflicto de calendario',
        body: `Detecté ${conflicts} solapamiento${conflicts === 1 ? '' : 's'} esta semana.`,
        data: { type: 'calendar_conflict', count: conflicts },
      });
    }

    return { ok: true, conflicts };
  }

  async prepareTomorrowBriefing(data: CalendarGuardianJobData) {
    const userId = data.userId;
    if (!userId || !this.db.isReady()) return { ok: false };

    const now = new Date();
    if (!(now.getHours() === 21 && now.getMinutes() < 30)) {
      return { ok: false, skipped: 'outside_window' };
    }

    const events = await this.db.query<{
      title: string;
      start_at: string;
      location: string | null;
    }>(
      `SELECT title, start_at, location FROM calendar_events
       WHERE user_id = $1
         AND start_at::date = (NOW() + INTERVAL '1 day')::date
       ORDER BY start_at ASC`,
      [userId],
    );

    const tasks = await this.db.query<{ title: string; due_at: string | null }>(
      `SELECT title, due_at FROM tasks
       WHERE user_id = $1 AND status = 'pending'
         AND (due_at IS NULL OR due_at::date <= (NOW() + INTERVAL '1 day')::date)
       ORDER BY due_at NULLS LAST
       LIMIT 10`,
      [userId],
    );

    const lines: string[] = [];
    lines.push('Mañana tienes:');
    if (events.rows.length === 0) {
      lines.push('· Agenda libre.');
    } else {
      for (const ev of events.rows) {
        const t = new Date(ev.start_at).toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
        });
        lines.push(`· ${t} — ${ev.title}${ev.location ? ` (${ev.location})` : ''}`);
      }
    }
    if (tasks.rows.length > 0) {
      lines.push('');
      lines.push('Pendientes:');
      for (const t of tasks.rows) lines.push(`· ${t.title}`);
    }
    const text = lines.join('\n');

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const briefingDate = tomorrow.toISOString().slice(0, 10);

    await this.db.query(
      `INSERT INTO briefings (user_id, briefing_date, briefing_kind, text_content)
       VALUES ($1, $2, 'tomorrow_preview', $3)
       ON CONFLICT DO NOTHING`,
      [userId, briefingDate, text],
    );

    await this.notifications.enqueue({
      userId,
      title: 'Resumen de mañana',
      body: events.rows.length === 0 ? 'Agenda libre.' : `${events.rows.length} eventos planeados.`,
      data: { type: 'tomorrow_briefing', date: briefingDate },
    });

    return { ok: true, events: events.rows.length, tasks: tasks.rows.length };
  }

  async onModuleDestroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
