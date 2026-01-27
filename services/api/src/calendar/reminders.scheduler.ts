import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class RemindersScheduler implements OnModuleInit {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  async onModuleInit() {
    const enabled = String(this.configService.get<string>('REMINDERS_ENABLED') || 'true').toLowerCase() !== 'false';
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

  private async tick() {
    if (this.running) return;
    this.running = true;

    try {
      const now = new Date();
      const toIso = (d: Date) => d.toISOString();
      const windowMs = 65000;
      const windowStart = new Date(now.getTime() - windowMs);
      const windowEnd = new Date(now.getTime() + windowMs);

      const res = await this.db.query(
        `SELECT
          e.id as event_id,
          e.user_id as user_id,
          e.title as title,
          e.start_at as start_at,
          e.location as location,
          e.remind_offsets_minutes as remind_offsets_minutes,
          rs.expo_push_token as expo_push_token,
          rs.default_reminder_offset_minutes as default_offset
        FROM calendar_events e
        LEFT JOIN reminder_settings rs ON rs.user_id = e.user_id
        WHERE e.start_at >= NOW() - interval '7 days'
          AND e.start_at <= NOW() + interval '7 days'`,
      );

      const rows = res.rows || [];

      let sent = 0;
      for (const r of rows) {
        const token = (r?.expo_push_token || '').toString().trim();
        if (!token) continue;

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
              ? (Array.isArray((offsetsRaw as any)) ? (offsetsRaw as any) : [])
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

          const ok = await this.sendExpoPush(token, {
            title: 'Leeloo',
            body: `${r.title}${r.location ? ` · ${r.location}` : ''}`,
            data: {
              kind: 'calendar_reminder',
              event_id: r.event_id,
              start_at: toIso(startAt),
              offset_minutes: off,
            },
          });

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

      if (sent > 0) {
        console.log('[LeelooApi] reminders.tick.sent', { sent });
      }
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
    payload: { title: string; body: string; data?: Record<string, any> },
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
