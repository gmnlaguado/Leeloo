import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class GoogleCalendarService {
  constructor(private readonly db: DatabaseService) {}

  private toIsoOrNull(v: any): string | null {
    if (!v) return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  private mapLocalToGoogleEvent(local: any) {
    const start = local?.start_at ? new Date(String(local.start_at)) : null;
    const end = local?.end_at ? new Date(String(local.end_at)) : null;
    if (!start || Number.isNaN(start.getTime())) {
      throw new Error('Invalid local start_at');
    }

    return {
      summary: String(local?.title || 'Busy'),
      location: local?.location ? String(local.location) : undefined,
      description: local?.notes ? String(local.notes) : undefined,
      start: {
        dateTime: start.toISOString(),
      },
      end: {
        dateTime: (end && !Number.isNaN(end.getTime()))
          ? end.toISOString()
          : new Date(start.getTime() + 30 * 60_000).toISOString(),
      },
    };
  }

  async createGoogleEvent(accessToken: string, localEvent: any) {
    const calendarId = 'primary';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const payload = this.mapLocalToGoogleEvent(localEvent);
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30000,
    });
    return res.data;
  }

  async updateGoogleEvent(accessToken: string, googleEventId: string, localEvent: any) {
    const calendarId = 'primary';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;
    const payload = this.mapLocalToGoogleEvent(localEvent);
    const res = await axios.put(url, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30000,
    });
    return res.data;
  }

  async deleteGoogleEvent(accessToken: string, googleEventId: string) {
    const calendarId = 'primary';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;
    const res = await axios.delete(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (res.status === 404) return { ok: true, status: 404 };
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    throw new Error(`Google delete failed (HTTP ${res.status})`);
  }

  async syncPrimaryCalendarIncremental(opts: {
    profileId: string;
    accessToken: string;
    syncToken?: string | null;
  }) {
    const calendarId = 'primary';

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const baseParams: Record<string, any> = {
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      showDeleted: true,
    };

    // For first sync (no syncToken), use a time window.
    if (!opts.syncToken) {
      baseParams.timeMin = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString();
      baseParams.timeMax = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();
    } else {
      baseParams.syncToken = opts.syncToken;
    }

    let pageToken: string | null = null;
    let fetched = 0;
    let upserted = 0;
    let deleted = 0;
    let skipped_conflict = 0;
    let nextSyncToken: string | null = null;

    const processEvent = async (ev: any) => {
      const externalId = String(ev?.id || '').trim();
      if (!externalId) return;
      fetched += 1;

      const isCancelled = String(ev?.status || '').toLowerCase() === 'cancelled';
      if (isCancelled) {
        const delRes = await this.db.query(
          `DELETE FROM calendar_events
           WHERE user_id = $1 AND external_provider = 'google' AND external_id = $2
           RETURNING id`,
          [opts.profileId, externalId],
        );
        if ((delRes.rows || []).length > 0) deleted += 1;
        return;
      }

      const title = String(ev?.summary || 'Busy').trim() || 'Busy';
      const location = ev?.location ? String(ev.location) : null;
      const notes = ev?.description ? String(ev.description) : null;

      const startIso = String(ev?.start?.dateTime || ev?.start?.date || '').trim();
      if (!startIso) return;
      const endIso = String(ev?.end?.dateTime || ev?.end?.date || '').trim() || null;

      const startAt = this.toIsoOrNull(startIso);
      if (!startAt) return;
      const endAt = endIso ? this.toIsoOrNull(endIso) : null;

      const externalUpdatedAt = this.toIsoOrNull(ev?.updated) || new Date().toISOString();
      const externalEtag = ev?.etag ? String(ev.etag) : null;

      const existing = await this.db.query(
        `SELECT id, updated_at
         FROM calendar_events
         WHERE user_id = $1 AND external_provider = 'google' AND external_id = $2
         LIMIT 1`,
        [opts.profileId, externalId],
      );
      const row = existing.rows?.[0] || null;
      if (row) {
        const localUpdatedAt = row?.updated_at ? new Date(String(row.updated_at)).getTime() : 0;
        const googleUpdatedAt = externalUpdatedAt ? new Date(externalUpdatedAt).getTime() : 0;
        if (googleUpdatedAt && localUpdatedAt && googleUpdatedAt < localUpdatedAt) {
          skipped_conflict += 1;
          await this.db.query(
            `UPDATE calendar_events
             SET external_updated_at = $1::timestamptz,
                 external_etag = $2
             WHERE id = $3 AND user_id = $4`,
            [externalUpdatedAt, externalEtag, row.id, opts.profileId],
          );
          return;
        }
      }

      const rowId = randomUUID();
      await this.db.query(
        `INSERT INTO calendar_events (
          id, user_id, title, start_at, end_at, location, notes,
          external_provider, external_id, external_updated_at, external_etag, updated_at
        ) VALUES (
          $1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7,
          'google', $8, $9::timestamptz, $10, NOW()
        )
        ON CONFLICT (user_id, external_provider, external_id)
        DO UPDATE SET
          title = EXCLUDED.title,
          start_at = EXCLUDED.start_at,
          end_at = EXCLUDED.end_at,
          location = EXCLUDED.location,
          notes = EXCLUDED.notes,
          external_updated_at = EXCLUDED.external_updated_at,
          external_etag = EXCLUDED.external_etag,
          updated_at = NOW()`,
        [
          rowId,
          opts.profileId,
          title,
          startAt,
          endAt,
          location,
          notes,
          externalId,
          externalUpdatedAt,
          externalEtag,
        ],
      );
      upserted += 1;
    };

    const fetchPage = async () => {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        params: {
          ...baseParams,
          ...(pageToken ? { pageToken } : {}),
        },
        timeout: 30000,
        validateStatus: () => true,
      });

      if (res.status === 410) {
        return { gone: true as const };
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Google events.list failed (HTTP ${res.status})`);
      }

      const items: any[] = Array.isArray(res.data?.items) ? res.data.items : [];
      for (const ev of items) {
        await processEvent(ev);
      }

      pageToken = typeof res.data?.nextPageToken === 'string' ? res.data.nextPageToken : null;
      if (typeof res.data?.nextSyncToken === 'string' && res.data.nextSyncToken.trim()) {
        nextSyncToken = res.data.nextSyncToken.trim();
      }
      return { gone: false as const };
    };

    let first = true;
    while (first || pageToken) {
      first = false;
      const out = await fetchPage();
      if (out.gone) {
        pageToken = null;
        nextSyncToken = null;
        fetched = 0;
        upserted = 0;
        deleted = 0;
        skipped_conflict = 0;
        delete baseParams.syncToken;
        baseParams.timeMin = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString();
        baseParams.timeMax = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();
        continue;
      }
      if (!pageToken) break;
    }

    return {
      calendar_id: calendarId,
      sync_mode: opts.syncToken ? 'incremental' : 'full',
      fetched,
      upserted,
      deleted,
      skipped_conflict,
      next_sync_token: nextSyncToken,
    };
  }

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
