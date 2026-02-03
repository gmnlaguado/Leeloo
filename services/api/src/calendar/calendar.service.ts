import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class CalendarService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private async ensureSchema() {
    // Repo has no migrations; keep this minimal and idempotent.
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS calendar_events (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        title text NOT NULL,
        start_at timestamptz NOT NULL,
        end_at timestamptz NULL,
        timezone text NULL,
        location text NULL,
        notes text NULL,
        priority text NULL,
        category text NULL,
        remind_offsets_minutes jsonb NULL,
        external_provider text NULL,
        external_id text NULL,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      )`,
    );

    // If the table existed before we added start_at/end_at, don't crash on boot.
    // We keep this logic local (no migrations framework) and safe to run repeatedly.
    try {
      const colsRes = await this.db.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'calendar_events'`,
      );
      const cols = new Set((colsRes.rows || []).map((r) => String(r.column_name)));

      const ensureColumn = async (name: string, typeSql: string) => {
        if (cols.has(name)) return;
        await this.db.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`);
        cols.add(name);
      };

      await ensureColumn('start_at', 'timestamptz NULL');
      await ensureColumn('end_at', 'timestamptz NULL');
      await ensureColumn('remind_offsets_minutes', 'jsonb NULL');
      await ensureColumn('external_provider', 'text NULL');
      await ensureColumn('external_id', 'text NULL');

      // Best-effort backfill from common legacy column names.
      // This runs only when start_at/end_at were missing.
      if (cols.has('start_at')) {
        const legacyStartCandidates = ['start_time', 'starts_at', 'start'];
        const legacyStart = legacyStartCandidates.find((c) => cols.has(c));
        if (legacyStart) {
          await this.db.query(
            `UPDATE calendar_events
             SET start_at = ${legacyStart}
             WHERE start_at IS NULL AND ${legacyStart} IS NOT NULL`,
          );
        }
      }

      if (cols.has('end_at')) {
        const legacyEndCandidates = ['end_time', 'ends_at', 'end'];
        const legacyEnd = legacyEndCandidates.find((c) => cols.has(c));
        if (legacyEnd) {
          await this.db.query(
            `UPDATE calendar_events
             SET end_at = ${legacyEnd}
             WHERE end_at IS NULL AND ${legacyEnd} IS NOT NULL`,
          );
        }
      }

      if (cols.has('remind_offsets_minutes')) {
        const legacyOffsetCandidates = ['remind_offset_minutes', 'reminder_offset_minutes', 'reminder_offset'];
        const legacyOffset = legacyOffsetCandidates.find((c) => cols.has(c));
        if (legacyOffset) {
          await this.db.query(
            `UPDATE calendar_events
             SET remind_offsets_minutes = to_jsonb(ARRAY[${legacyOffset}])
             WHERE remind_offsets_minutes IS NULL AND ${legacyOffset} IS NOT NULL`,
          );
        }
      }
    } catch {
      // If information_schema isn't accessible for any reason, don't crash the API.
      // Worst case: the index creation below may still fail and surface the real error.
    }

    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start ON calendar_events (user_id, start_at)',
    );

    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_calendar_events_external ON calendar_events (user_id, external_provider, external_id)',
    );

    await this.db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_calendar_events_external
       ON calendar_events (user_id, external_provider, external_id)
       WHERE external_provider IS NOT NULL AND external_id IS NOT NULL`,
    );

    await this.db.query(
      `CREATE TABLE IF NOT EXISTS reminder_settings (
        user_id uuid PRIMARY KEY,
        default_reminder_offset_minutes integer NOT NULL DEFAULT 180,
        quiet_hours jsonb NULL,
        language text NULL,
        tone text NULL,
        expo_push_token text NULL,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      )`,
    );

    await this.db.query(
      `CREATE TABLE IF NOT EXISTS calendar_reminders_sent (
        dedupe_key text PRIMARY KEY,
        event_id uuid NOT NULL,
        user_id uuid NOT NULL,
        offset_minutes integer NOT NULL,
        fired_at timestamptz NOT NULL DEFAULT NOW()
      )`,
    );

    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_calendar_reminders_sent_user ON calendar_reminders_sent (user_id, fired_at)',
    );
  }

  private async getProfileId(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return profile.id;
  }

  private async getUserTimezone(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    const tz = profile?.preferences?.timezone;
    if (typeof tz === 'string' && tz.trim()) return tz.trim();
    return 'UTC';
  }

  private formatDayInTimezone(date: Date, timezone: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);

      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
    }
    return date.toISOString().slice(0, 10);
  }

  async createEvent(clerkUserId: string, dto: any) {
    const profileId = await this.getProfileId(clerkUserId);

    const eventId = randomUUID();

    const remindOffsets = Array.isArray(dto?.remind_offsets_minutes) && dto.remind_offsets_minutes.length
      ? dto.remind_offsets_minutes
      : [180];

    const result = await this.db.query(
      `INSERT INTO calendar_events (
        id, user_id, title, start_at, end_at, timezone, location, notes, priority, category, remind_offsets_minutes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      RETURNING *`,
      [
        eventId,
        profileId,
        dto.title,
        dto.start_at,
        dto.end_at || null,
        dto.timezone || null,
        dto.location || null,
        dto.notes || null,
        dto.priority || null,
        dto.category || null,
        JSON.stringify(remindOffsets),
      ],
    );

    console.log('[LeelooApi] calendar.event.created', {
      userId: clerkUserId,
      event_id: result.rows?.[0]?.id,
      start_at: dto.start_at,
    });

    return result.rows[0];
  }

  async updateEvent(clerkUserId: string, id: string, dto: any) {
    const profileId = await this.getProfileId(clerkUserId);

    const fields: string[] = [];
    const params: any[] = [];

    const setField = (col: string, value: any) => {
      fields.push(`${col} = $${params.length + 1}`);
      params.push(value);
    };

    if (dto.title !== undefined) setField('title', dto.title);
    if (dto.start_at !== undefined) setField('start_at', dto.start_at);
    if (dto.end_at !== undefined) setField('end_at', dto.end_at || null);
    if (dto.timezone !== undefined) setField('timezone', dto.timezone || null);
    if (dto.location !== undefined) setField('location', dto.location || null);
    if (dto.notes !== undefined) setField('notes', dto.notes || null);
    if (dto.priority !== undefined) setField('priority', dto.priority || null);
    if (dto.category !== undefined) setField('category', dto.category || null);
    if (dto.remind_offsets_minutes !== undefined) {
      const remindOffsets = Array.isArray(dto.remind_offsets_minutes) && dto.remind_offsets_minutes.length
        ? dto.remind_offsets_minutes
        : [180];
      fields.push(`remind_offsets_minutes = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(remindOffsets));
    }

    fields.push('updated_at = NOW()');

    if (fields.length === 1) {
      const current = await this.db.query(
        'SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2',
        [id, profileId],
      );
      return current.rows[0] || null;
    }

    params.push(id);
    params.push(profileId);

    const query = `UPDATE calendar_events SET ${fields.join(', ')} WHERE id = $$${params.length - 1} AND user_id = $${params.length} RETURNING *`;
    const result = await this.db.query(query, params);

    console.log('[LeelooApi] calendar.event.updated', {
      userId: clerkUserId,
      event_id: id,
      updated: fields.map((f) => f.split('=')[0].trim()).filter((f) => f !== 'updated_at'),
    });

    return result.rows[0] || null;
  }

  async getEventsForDay(clerkUserId: string, day: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const timezone = await this.getUserTimezone(clerkUserId);
    const startLocal = `${day} 00:00:00`;
    const endLocal = `${day} 23:59:59.999`;

    const result = await this.db.query(
      `SELECT *
       FROM calendar_events
       WHERE user_id = $1
         AND (start_at AT TIME ZONE $2) >= $3::timestamp
         AND (start_at AT TIME ZONE $2) <= $4::timestamp
       ORDER BY start_at ASC`,
      [profileId, timezone, startLocal, endLocal],
    );
    return { day, timezone, events: result.rows || [] };
  }

  async getAgendaToday(clerkUserId: string) {
    const timezone = await this.getUserTimezone(clerkUserId);
    const now = new Date();
    const day = this.formatDayInTimezone(now, timezone);
    return this.getEventsForDay(clerkUserId, day);
  }

  async findNextUpcomingEventByTitle(clerkUserId: string, titleQuery: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const q = String(titleQuery || '').trim();
    if (!q) return null;

    const nowIso = new Date().toISOString();
    const result = await this.db.query(
      `SELECT *
       FROM calendar_events
       WHERE user_id = $1
         AND start_at >= $2
         AND title ILIKE $3
       ORDER BY start_at ASC
       LIMIT 1`,
      [profileId, nowIso, `%${q}%`],
    );

    return result.rows?.[0] || null;
  }

  async deleteEvent(clerkUserId: string, id: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query(
      'DELETE FROM calendar_events WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, profileId],
    );

    const deleted = res.rows?.[0] || null;
    if (deleted) {
      console.log('[LeelooApi] calendar.event.deleted', {
        userId: clerkUserId,
        event_id: id,
      });
    }
    return deleted;
  }

  async updateReminderSettings(clerkUserId: string, dto: any) {
    const profileId = await this.getProfileId(clerkUserId);

    const defaultOffset = (() => {
      const n = Number(dto?.default_reminder_offset_minutes);
      if (Number.isFinite(n) && n >= 0 && n <= 10080) return Math.floor(n);
      return null;
    })();

    const quietHours = dto?.quiet_hours !== undefined ? dto.quiet_hours : null;
    const language = dto?.language !== undefined ? String(dto.language || '') : null;
    const tone = dto?.tone !== undefined ? String(dto.tone || '') : null;
    const expoPushToken = dto?.expo_push_token !== undefined ? String(dto.expo_push_token || '') : null;

    const res = await this.db.query(
      `INSERT INTO reminder_settings (
        user_id,
        default_reminder_offset_minutes,
        quiet_hours,
        language,
        tone,
        expo_push_token,
        created_at,
        updated_at
      ) VALUES ($1, COALESCE($2, 180), $3::jsonb, NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        default_reminder_offset_minutes = COALESCE(EXCLUDED.default_reminder_offset_minutes, reminder_settings.default_reminder_offset_minutes),
        quiet_hours = COALESCE(EXCLUDED.quiet_hours, reminder_settings.quiet_hours),
        language = COALESCE(EXCLUDED.language, reminder_settings.language),
        tone = COALESCE(EXCLUDED.tone, reminder_settings.tone),
        expo_push_token = COALESCE(EXCLUDED.expo_push_token, reminder_settings.expo_push_token),
        updated_at = NOW()
      RETURNING *`,
      [
        profileId,
        defaultOffset,
        quietHours ? JSON.stringify(quietHours) : null,
        language,
        tone,
        expoPushToken,
      ],
    );

    console.log('[LeelooApi] reminders.settings.updated', {
      userId: clerkUserId,
      has_token: Boolean(expoPushToken),
      default_offset: defaultOffset,
      has_quiet_hours: Boolean(quietHours),
    });

    return res.rows[0] || null;
  }
}
