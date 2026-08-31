import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

type Lang = 'en' | 'es' | 'pt' | 'fr';

function toSafeLang(raw: unknown): Lang {
  const s = (typeof raw === 'string' ? raw : '').toLowerCase().slice(0, 2);
  return (['en', 'es', 'pt', 'fr'] as Lang[]).includes(s as Lang) ? (s as Lang) : 'en';
}

function getTimeHint(minsLeft: number, dueDate: Date, lang: Lang): string {
  const locale = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR' }[lang];
  const timeStr = dueDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (minsLeft <= 1) return { en: 'right now', es: 'ahora mismo', pt: 'agora mesmo', fr: 'maintenant' }[lang];
  if (minsLeft <= 60) return { en: `in ${minsLeft} min`, es: `en ${minsLeft} minutos`, pt: `em ${minsLeft} minutos`, fr: `dans ${minsLeft} minutes` }[lang];
  return { en: `at ${timeStr}`, es: `a las ${timeStr}`, pt: `às ${timeStr}`, fr: `à ${timeStr}` }[lang];
}

function buildEventNotif(title: string, location: string | null, timeHint: string, lang: Lang) {
  const loc = location
    ? ` ${{ en: 'at', es: 'en', pt: 'em', fr: 'à' }[lang]} ${location}`
    : '';
  const body = `${title}${loc} — ${timeHint}`;
  const speak = { en: `Hey, ${title}${loc} — ${timeHint}`, es: `Oye, ${title}${loc} — ${timeHint}`, pt: `Ei, ${title}${loc} — ${timeHint}`, fr: `Hé, ${title}${loc} — ${timeHint}` }[lang];
  return { body, speak };
}

function buildTaskNotif(title: string, timeHint: string, lang: Lang) {
  const body = `${{ en: 'Reminder:', es: 'Recuerda:', pt: 'Lembrete:', fr: 'Rappel:' }[lang]} ${title} — ${timeHint}`;
  const speak = { en: `Hey, remember: ${title} — ${timeHint}`, es: `Oye, recuerda: ${title} — ${timeHint}`, pt: `Ei, lembra: ${title} — ${timeHint}`, fr: `Hé, rappelle-toi: ${title} — ${timeHint}` }[lang];
  return { body, speak };
}

@Injectable()
export class RemindersScheduler implements OnModuleInit {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
    private readonly emailService: EmailService,
  ) {}

  async onModuleInit() {
    const enabled =
      String(this.configService.get<string>('REMINDERS_ENABLED') || 'true').toLowerCase() !==
      'false';
    if (!enabled) {
      console.log('[LeelooApi] reminders.disabled');
      return;
    }

    const intervalMs = (() => {
      const raw = this.configService.get<string>('REMINDERS_TICK_MS') || '60000';
      const n = Number(raw);
      return Number.isFinite(n) && n >= 5000 && n <= 300000 ? Math.floor(n) : 60000;
    })();

    this.timer = setInterval(() => {
      this.tick().catch(() => null);
    }, intervalMs);

    setTimeout(() => {
      this.tick().catch(() => null);
    }, 2000);

    console.log('[LeelooApi] reminders.scheduler.started', { interval_ms: intervalMs });
  }

  private isWithinQuietHours(params: { now: Date; quietHours: any; timezone: string }): boolean {
    try {
      const qh = params.quietHours;
      if (!qh || typeof qh !== 'object') return false;

      const startStr = typeof qh.start === 'string' ? qh.start.trim() : '';
      const endStr = typeof qh.end === 'string' ? qh.end.trim() : '';
      if (!startStr || !endStr) return false;

      const tz = typeof qh.tz === 'string' && qh.tz.trim() ? qh.tz.trim() : params.timezone;
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(params.now);
      const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0');
      const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0');
      const nowMin = hh * 60 + mm;

      const parseHHMM = (s: string) => {
        const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(s);
        if (!m) return null;
        const h = Number(m[1]);
        const mi = Number(m[2]);
        if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59)
          return null;
        return h * 60 + mi;
      };

      const startMin = parseHHMM(startStr);
      const endMin = parseHHMM(endStr);
      if (startMin === null || endMin === null) return false;

      if (startMin === endMin) return true;

      // If window crosses midnight.
      if (startMin > endMin) {
        return nowMin >= startMin || nowMin < endMin;
      }
      return nowMin >= startMin && nowMin < endMin;
    } catch {
      return false;
    }
  }

  private async getUserTimezone(userId: string): Promise<string> {
    try {
      const res = await this.db.query(
        `SELECT preferences
         FROM profiles
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );
      const prefs = res.rows?.[0]?.preferences;
      const tz = prefs?.timezone;
      if (typeof tz === 'string' && tz.trim()) return tz.trim();
    } catch (err) {
      console.warn('[RemindersScheduler] getUserTimezone failed', { userId, error: String(err) });
    }
    return 'UTC';
  }

  private async morningBriefing(now: Date) {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS morning_briefing_sent (
        user_id uuid NOT NULL,
        date date NOT NULL,
        PRIMARY KEY (user_id, date)
      )
    `);

    // Select users with a push token — check timezone per user below
    const usersRes = await this.db.query(`
      SELECT DISTINCT p.id as user_id, p.preferred_language, p.expo_push_token, p.preferences
      FROM profiles p
      WHERE p.expo_push_token IS NOT NULL AND p.expo_push_token <> ''
      LIMIT 200
    `);

    for (const u of usersRes.rows) {
      const token = String(u.expo_push_token || '').trim();
      if (!token) continue;

      const lang = toSafeLang(u.preferred_language);
      const userId = String(u.user_id);

      // Resolve user timezone and check if it's 7:00-7:02 AM for them
      const tz = ((): string => {
        const prefs = u.preferences;
        const t = typeof prefs?.timezone === 'string' ? prefs.timezone.trim() : '';
        return t || 'UTC';
      })();

      const localHour = (() => {
        try {
          const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
          return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
        } catch { return now.getUTCHours(); }
      })();
      const localMin = (() => {
        try {
          const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
          return Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
        } catch { return now.getUTCMinutes(); }
      })();

      if (localHour !== 7 || localMin > 2) continue;

      // Get the local date string for dedup
      const localDateStr = (() => {
        try {
          return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // YYYY-MM-DD
        } catch { return now.toISOString().slice(0, 10); }
      })();

      const alreadySent = await this.db.query(
        'SELECT 1 FROM morning_briefing_sent WHERE user_id = $1 AND date = $2 LIMIT 1',
        [userId, localDateStr],
      );
      if ((alreadySent.rows || []).length > 0) continue;

      const todayStart = localDateStr + 'T00:00:00.000Z';
      const todayEnd   = localDateStr + 'T23:59:59.999Z';

      const evRes = await this.db.query(`
        SELECT title, start_at, location FROM calendar_events
        WHERE user_id = $1 AND start_at >= $2 AND start_at <= $3
        ORDER BY start_at LIMIT 5
      `, [userId, todayStart, todayEnd]);

      const taskRes2 = await this.db.query(`
        SELECT title FROM tasks
        WHERE user_id = $1 AND status IN ('pending', 'in_progress')
          AND (due_at >= $2 OR due_at IS NULL)
        ORDER BY due_at ASC NULLS LAST LIMIT 5
      `, [userId, todayStart]);

      const events = evRes.rows;
      const tasks  = taskRes2.rows;
      const locale = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR' }[lang];

      const formatTime = (iso: string) => {
        try {
          return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        } catch { return ''; }
      };

      let speakText: string;
      const greeting = { en: 'Good morning', es: 'Buenos días', pt: 'Bom dia', fr: 'Bonjour' }[lang];
      const noAgenda = { en: 'Your day is clear', es: 'Tu día está libre', pt: 'Seu dia está livre', fr: 'Ta journée est libre' }[lang];

      if (!events.length && !tasks.length) {
        speakText = `${greeting}! ${noAgenda}.`;
      } else {
        const parts: string[] = [];
        if (events.length) {
          const evList = events.map((e: any) => {
            const t = formatTime(e.start_at);
            return t ? `${e.title} a las ${t}` : e.title;
          }).join(', ');
          const evLabel = { en: `${events.length} event${events.length > 1 ? 's' : ''}`, es: `${events.length} evento${events.length > 1 ? 's' : ''}`, pt: `${events.length} evento${events.length > 1 ? 's' : ''}`, fr: `${events.length} événement${events.length > 1 ? 's' : ''}` }[lang];
          parts.push(`${evLabel}: ${evList}`);
        }
        if (tasks.length) {
          const tList = tasks.map((t: any) => t.title).join(', ');
          const tLabel = { en: `${tasks.length} task${tasks.length > 1 ? 's' : ''}`, es: `${tasks.length} tarea${tasks.length > 1 ? 's' : ''}`, pt: `${tasks.length} tarefa${tasks.length > 1 ? 's' : ''}`, fr: `${tasks.length} tâche${tasks.length > 1 ? 's' : ''}` }[lang];
          parts.push(`${tLabel}: ${tList}`);
        }
        speakText = `${greeting}! ${parts.join('. ')}.`;
      }

      const notifTitle = { en: '☀️ Good morning', es: '☀️ Buenos días', pt: '☀️ Bom dia', fr: '☀️ Bonjour' }[lang];
      const pushed = await this.sendExpoPush(token, {
        title: notifTitle,
        body: speakText.slice(0, 200),
        categoryId: 'reminder',
        data: { kind: 'morning_briefing', speak_text: speakText },
      });

      if (pushed) {
        await this.db.query(
          `INSERT INTO morning_briefing_sent (user_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, localDateStr],
        );
        console.log('[LeelooApi] morning.briefing.sent', { userId, lang, tz });
      }
    }
  }

  private async tick() {
    if (this.running) return;
    this.running = true;

    try {
      const now = new Date();
      const toIso = (d: Date) => d.toISOString();
      const windowMs = 65000;
      const windowStart = new Date(now.getTime() - windowMs);
      const windowEnd = new Date(now.getTime() + windowMs);

      await this.db.query(
        `CREATE TABLE IF NOT EXISTS task_reminders_sent (
          dedupe_key text PRIMARY KEY,
          task_id uuid NOT NULL,
          user_id uuid NOT NULL,
          offset_minutes integer NOT NULL,
          fired_at timestamptz NOT NULL DEFAULT NOW()
        )`,
      );

      await this.db.query(
        'CREATE INDEX IF NOT EXISTS idx_task_reminders_sent_user ON task_reminders_sent (user_id, fired_at)',
      );

      const res = await this.db.query(
        `SELECT
          e.id as event_id,
          e.user_id as user_id,
          e.title as title,
          e.start_at as start_at,
          e.location as location,
          e.remind_offsets_minutes as remind_offsets_minutes,
          COALESCE(rs.expo_push_token, p.expo_push_token) as expo_push_token,
          rs.default_reminder_offset_minutes as default_offset,
          rs.quiet_hours as quiet_hours,
          p.preferences as preferences,
          p.preferred_language as preferred_language
        FROM calendar_events e
        LEFT JOIN reminder_settings rs ON rs.user_id = e.user_id
        LEFT JOIN profiles p ON p.id = e.user_id
        WHERE e.start_at >= NOW() - interval '7 days'
          AND e.start_at <= NOW() + interval '7 days'`,
      );

      const taskRes = await this.db.query(
        `SELECT
          t.id as task_id,
          t.user_id as user_id,
          t.title as title,
          t.due_at as due_at,
          COALESCE(rs.expo_push_token, p.expo_push_token) as expo_push_token,
          rs.default_reminder_offset_minutes as default_offset,
          rs.quiet_hours as quiet_hours,
          p.preferences as preferences,
          p.preferred_language as preferred_language
        FROM tasks t
        LEFT JOIN reminder_settings rs ON rs.user_id = t.user_id
        LEFT JOIN profiles p ON p.id = t.user_id
        WHERE t.due_at IS NOT NULL
          AND t.status <> 'done'
          AND t.due_at >= NOW() - interval '7 days'
          AND t.due_at <= NOW() + interval '7 days'`,
      );

      const rows = res.rows || [];
      const taskRows = taskRes.rows || [];

      let sent = 0;
      for (const r of rows) {
        const token = (r?.expo_push_token || '').toString().trim();

        const timezone = await this.getUserTimezone(String(r.user_id));
        const quietHours = r?.quiet_hours;
        if (this.isWithinQuietHours({ now, quietHours, timezone })) {
          continue;
        }

        const startAt = new Date(r.start_at);
        const offsetsRaw = r.remind_offsets_minutes;
        const offsets: number[] = Array.isArray(offsetsRaw)
          ? offsetsRaw
          : typeof offsetsRaw === 'string'
            ? (() => {
                try {
                  const parsed = JSON.parse(offsetsRaw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : offsetsRaw && typeof offsetsRaw === 'object'
              ? Array.isArray(offsetsRaw as any)
                ? (offsetsRaw as any)
                : []
              : [];

        const defaultOffset = Number(r.default_offset);
        const effectiveOffsets = offsets.length
          ? offsets
          : Number.isFinite(defaultOffset) && defaultOffset >= 0
            ? [defaultOffset]
            : [180];

        for (const offMin of effectiveOffsets) {
          const off = Number(offMin);
          if (!Number.isFinite(off) || off < 0 || off > 10080) continue;

          const fireAt = new Date(startAt.getTime() - off * 60_000);
          if (fireAt < windowStart || fireAt > windowEnd) continue;

          const dedupeKey = `${r.event_id}:${off}`;
          const already = await this.db.query(
            'SELECT 1 FROM calendar_reminders_sent WHERE dedupe_key = $1 LIMIT 1',
            [dedupeKey],
          );
          if ((already.rows || []).length > 0) continue;

          const minutesLeft = Math.round((startAt.getTime() - now.getTime()) / 60000);
          const lang = toSafeLang(r.preferred_language);
          const timeHint = getTimeHint(minutesLeft, startAt, lang);
          const { body: notifBody, speak: speakText } = buildEventNotif(
            String(r.title || ''),
            r.location ? String(r.location) : null,
            timeHint,
            lang,
          );
          const pushOk = token
            ? await this.sendExpoPush(token, {
                title: '⏰ Leeloo',
                body: notifBody,
                categoryId: 'reminder',
                data: {
                  kind: 'calendar_reminder',
                  event_id: r.event_id,
                  start_at: toIso(startAt),
                  offset_minutes: off,
                  speak_text: speakText,
                },
              })
            : false;

          let ok = pushOk;
          if (!ok) {
            const email = r?.preferences?.user_identity?.reply_to_email;
            if (typeof email === 'string' && email.trim()) {
              try {
                await this.emailService.sendEmail({
                  to: email.trim(),
                  subject: `Reminder: ${String(r.title || 'Event')}`,
                  text: `${r.title}${r.location ? ` · ${r.location}` : ''}\nStarts at: ${toIso(startAt)}`,
                });
                ok = true;
              } catch (e: any) {
                console.warn('[LeelooApi] reminders.email.failed', { message: e?.message });
              }
            }
          }

          if (ok) {
            await this.db.query(
              `INSERT INTO calendar_reminders_sent (dedupe_key, event_id, user_id, offset_minutes, fired_at)
               VALUES ($1, $2, $3, $4, NOW())`,
              [dedupeKey, r.event_id, r.user_id, off],
            );
            sent += 1;
          }
        }
      }

      for (const r of taskRows) {
        const token = (r?.expo_push_token || '').toString().trim();

        const timezone = await this.getUserTimezone(String(r.user_id));
        const quietHours = r?.quiet_hours;
        if (this.isWithinQuietHours({ now, quietHours, timezone })) {
          continue;
        }

        const dueAt = new Date(r.due_at);
        const defaultOffset = Number(r.default_offset);
        const effectiveOffsets =
          Number.isFinite(defaultOffset) && defaultOffset >= 0 ? [defaultOffset] : [180];

        for (const offMin of effectiveOffsets) {
          const off = Number(offMin);
          if (!Number.isFinite(off) || off < 0 || off > 10080) continue;

          const fireAt = new Date(dueAt.getTime() - off * 60_000);
          if (fireAt < windowStart || fireAt > windowEnd) continue;

          const dedupeKey = `${r.task_id}:${off}`;
          const already = await this.db.query(
            'SELECT 1 FROM task_reminders_sent WHERE dedupe_key = $1 LIMIT 1',
            [dedupeKey],
          );
          if ((already.rows || []).length > 0) continue;

          const minsLeft = Math.round((dueAt.getTime() - now.getTime()) / 60000);
          const lang2 = toSafeLang(r.preferred_language);
          const timeHint2 = getTimeHint(minsLeft, dueAt, lang2);
          const { body: notifBody2, speak: speakText2 } = buildTaskNotif(
            String(r.title || ''),
            timeHint2,
            lang2,
          );
          const pushOk = token
            ? await this.sendExpoPush(token, {
                title: '⏰ Leeloo',
                body: notifBody2,
                categoryId: 'reminder',
                data: {
                  kind: 'task_reminder',
                  task_id: r.task_id,
                  due_at: toIso(dueAt),
                  offset_minutes: off,
                  speak_text: speakText2,
                },
              })
            : false;

          let ok = pushOk;
          if (!ok) {
            const email = r?.preferences?.user_identity?.reply_to_email;
            if (typeof email === 'string' && email.trim()) {
              try {
                await this.emailService.sendEmail({
                  to: email.trim(),
                  subject: `Task reminder: ${String(r.title || 'Task')}`,
                  text: `Task: ${r.title}\nDue at: ${toIso(dueAt)}`,
                });
                ok = true;
              } catch (e: any) {
                console.warn('[LeelooApi] reminders.email.failed', { message: e?.message });
              }
            }
          }

          if (ok) {
            await this.db.query(
              `INSERT INTO task_reminders_sent (dedupe_key, task_id, user_id, offset_minutes, fired_at)
               VALUES ($1, $2, $3, $4, NOW())`,
              [dedupeKey, r.task_id, r.user_id, off],
            );
            sent += 1;
          }
        }
      }

        if (sent > 0) {
        console.log('[LeelooApi] reminders.tick.sent', { sent });
      }

      await this.morningBriefing(now).catch((e: any) => {
        console.warn('[LeelooApi] morning.briefing.error', { message: e?.message });
      });
    } catch (err: any) {
      console.error('[LeelooApi] reminders.tick.error', {
        message: err?.message,
        code: err?.code,
      });
    } finally {
      this.running = false;
    }
  }

  private async sendExpoPush(
    to: string,
    payload: { title: string; body: string; categoryId?: string; data?: Record<string, any> },
  ): Promise<boolean> {
    try {
      const url = 'https://exp.host/--/api/v2/push/send';
      const timeoutMs = (() => {
        const raw = this.configService.get<string>('REMINDERS_PUSH_TIMEOUT_MS') || '4000';
        const n = Number(raw);
        return Number.isFinite(n) && n >= 800 && n <= 15000 ? Math.floor(n) : 4000;
      })();

      const res = await axios.post(
        url,
        {
          to,
          sound: 'default',
          title: payload.title,
          body: payload.body,
          categoryId: payload.categoryId,
          data: payload.data || {},
        },
        { timeout: timeoutMs },
      );

      const st = res.data?.data?.status;
      if (st === 'ok') return true;

      console.warn('[LeelooApi] reminders.push.not_ok', {
        status: st,
        details: res.data?.data?.details || null,
      });
      return false;
    } catch (err: any) {
      console.error('[LeelooApi] reminders.push.error', {
        message: err?.message,
        code: err?.code,
        status: err?.response?.status,
      });
      return false;
    }
  }
}
