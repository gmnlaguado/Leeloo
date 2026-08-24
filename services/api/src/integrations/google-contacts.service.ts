import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class GoogleContactsService {
  private readonly logger = new Logger('GoogleContactsService');

  constructor(private readonly db: DatabaseService) {}

  async fetchContacts(accessToken: string): Promise<
    Array<{ name: string; email?: string; phone?: string; nickname?: string }>
  > {
    const contacts: Array<{ name: string; email?: string; phone?: string; nickname?: string }> = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string> = {
        personFields: 'names,emailAddresses,phoneNumbers,nicknames',
        pageSize: '200',
      };
      if (pageToken) params.pageToken = pageToken;

      const res = await axios.get('https://people.googleapis.com/v1/people/me/connections', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params,
        timeout: 20000,
        validateStatus: () => true,
      });

      if (res.status < 200 || res.status >= 300) {
        this.logger.warn(`Google People API returned ${res.status}`);
        break;
      }

      const connections: any[] = Array.isArray(res.data?.connections) ? res.data.connections : [];
      for (const person of connections) {
        const displayName = String(person?.names?.[0]?.displayName || '').trim();
        if (!displayName) continue;
        contacts.push({
          name: displayName,
          email: person?.emailAddresses?.[0]?.value || undefined,
          phone: person?.phoneNumbers?.[0]?.value || undefined,
          nickname: person?.nicknames?.[0]?.value || undefined,
        });
      }

      pageToken =
        typeof res.data?.nextPageToken === 'string' ? res.data.nextPageToken : undefined;
    } while (pageToken);

    return contacts;
  }

  async syncContactsForUser(accessToken: string, profileId: string): Promise<{ synced: number; skipped: number }> {
    let synced = 0;
    let skipped = 0;

    try {
      const contacts = await this.fetchContacts(accessToken);

      for (const c of contacts) {
        const name = c.name.trim();
        if (!name) { skipped++; continue; }
        try {
          await this.db.query(
            `INSERT INTO contacts (user_id, name, email, phone, nickname, source)
             VALUES ($1, $2, $3, $4, $5, 'google')
             ON CONFLICT (user_id, name) DO UPDATE
               SET email    = COALESCE(EXCLUDED.email, contacts.email),
                   phone    = COALESCE(EXCLUDED.phone, contacts.phone),
                   nickname = COALESCE(EXCLUDED.nickname, contacts.nickname),
                   updated_at = NOW()`,
            [profileId, name, c.email || null, c.phone || null, c.nickname || null],
          );
          synced++;
        } catch {
          skipped++;
        }
      }
    } catch (e) {
      this.logger.warn(`Google Contacts sync failed for profile ${profileId}: ${String(e)}`);
    }

    this.logger.log(`Google Contacts sync: profileId=${profileId} synced=${synced} skipped=${skipped}`);
    return { synced, skipped };
  }
}
