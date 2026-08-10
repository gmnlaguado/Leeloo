import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

export type Contact = {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  nickname: string | null;
  relation: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class ContactsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private async ensureSchema() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name text NOT NULL,
        email text,
        phone text,
        nickname text,
        relation text,
        source text NOT NULL DEFAULT 'manual',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW(),
        UNIQUE (user_id, name)
      )
    `);
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts (user_id)`,
    );
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_contacts_name_lower ON contacts (user_id, LOWER(name))`,
    );
  }

  private async getProfileId(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return String(profile.id);
  }

  async listContacts(clerkUserId: string): Promise<Contact[]> {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query<Contact>(
      `SELECT * FROM contacts WHERE user_id = $1 ORDER BY name ASC`,
      [profileId],
    );
    return res.rows;
  }

  async syncContacts(
    clerkUserId: string,
    contacts: Array<{
      name: string;
      email?: string;
      phone?: string;
      nickname?: string;
      relation?: string;
      source?: string;
    }>,
  ): Promise<{ synced: number; skipped: number }> {
    const profileId = await this.getProfileId(clerkUserId);
    let synced = 0;
    let skipped = 0;
    for (const c of contacts) {
      const name = String(c.name || '').trim();
      if (!name) { skipped++; continue; }
      try {
        await this.db.query(
          `INSERT INTO contacts (user_id, name, email, phone, nickname, relation, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, name) DO UPDATE
             SET email = COALESCE(EXCLUDED.email, contacts.email),
                 phone = COALESCE(EXCLUDED.phone, contacts.phone),
                 nickname = COALESCE(EXCLUDED.nickname, contacts.nickname),
                 relation = COALESCE(EXCLUDED.relation, contacts.relation),
                 updated_at = NOW()`,
          [profileId, name, c.email || null, c.phone || null, c.nickname || null, c.relation || null, c.source || 'phone'],
        );
        synced++;
      } catch { skipped++; }
    }
    return { synced, skipped };
  }

  async findByName(clerkUserId: string, query: string): Promise<Contact | null> {
    const profileId = await this.getProfileId(clerkUserId);
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;

    // Exact name or nickname match
    const exact = await this.db.query<Contact>(
      `SELECT * FROM contacts
       WHERE user_id = $1 AND (LOWER(name) = $2 OR LOWER(nickname) = $2)
       LIMIT 1`,
      [profileId, q],
    );
    if (exact.rows.length > 0) return exact.rows[0];

    // Prefix / partial match
    const partial = await this.db.query<Contact>(
      `SELECT * FROM contacts
       WHERE user_id = $1 AND (LOWER(name) LIKE $2 OR LOWER(nickname) LIKE $2)
       ORDER BY name ASC LIMIT 1`,
      [profileId, `%${q}%`],
    );
    return partial.rows[0] || null;
  }

  async upsertContact(
    clerkUserId: string,
    contact: { name: string; email?: string; phone?: string; nickname?: string; relation?: string; source?: string },
  ): Promise<Contact> {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query<Contact>(
      `INSERT INTO contacts (user_id, name, email, phone, nickname, relation, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, name) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, contacts.email),
             phone = COALESCE(EXCLUDED.phone, contacts.phone),
             nickname = COALESCE(EXCLUDED.nickname, contacts.nickname),
             relation = COALESCE(EXCLUDED.relation, contacts.relation),
             updated_at = NOW()
       RETURNING *`,
      [profileId, contact.name, contact.email || null, contact.phone || null, contact.nickname || null, contact.relation || null, contact.source || 'manual'],
    );
    return res.rows[0];
  }

  async deleteContact(clerkUserId: string, contactId: string): Promise<{ ok: boolean }> {
    const profileId = await this.getProfileId(clerkUserId);
    await this.db.query(
      `DELETE FROM contacts WHERE id = $1 AND user_id = $2`,
      [contactId, profileId],
    );
    return { ok: true };
  }
}
