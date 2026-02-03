import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class GoogleCalendarService {
  constructor(private readonly db: DatabaseService) {}

  async syncPrimaryCalendar(profileId: string, accessToken: string) {
    const calendarId = 'primary';

    const timeMin = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString();
    const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        singleEvents: true,
        orderBy: 'startTime',
        timeMin,
        timeMax,
        maxResults: 2500,
      },
      timeout: 30000,
    });

    const items: any[] = Array.isArray(res.data?.items) ? res.data.items : [];

    let upserted = 0;
    for (const ev of items) {
      const externalId = String(ev?.id || '').trim();
      if (!externalId) continue;

      const title = String(ev?.summary || 'Busy').trim() || 'Busy';
      const location = ev?.location ? String(ev.location) : null;
      const notes = ev?.description ? String(ev.description) : null;

      const startIso = String(ev?.start?.dateTime || ev?.start?.date || '').trim();
      if (!startIso) continue;
      const endIso = String(ev?.end?.dateTime || ev?.end?.date || '').trim() || null;

      const startAt = new Date(startIso);
      if (Number.isNaN(startAt.getTime())) continue;
      const endAt = endIso ? new Date(endIso) : null;

      const rowId = randomUUID();

      await this.db.query(
        `INSERT INTO calendar_events (
          id, user_id, title, start_at, end_at, location, notes, external_provider, external_id, updated_at
        ) VALUES (
          $1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, 'google', $8, NOW()
        )
        ON CONFLICT (user_id, external_provider, external_id)
        DO UPDATE SET
          title = EXCLUDED.title,
          start_at = EXCLUDED.start_at,
          end_at = EXCLUDED.end_at,
          location = EXCLUDED.location,
          notes = EXCLUDED.notes,
          updated_at = NOW()`,
        [rowId, profileId, title, startAt.toISOString(), endAt ? endAt.toISOString() : null, location, notes, externalId],
      );

      upserted += 1;
    }

    return { calendar_id: calendarId, fetched: items.length, upserted };
  }
}
