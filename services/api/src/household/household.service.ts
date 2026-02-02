import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

export type HouseholdContact = {
  id: string;
  user_id: string;
  role: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class HouseholdService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private async ensureSchema() {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS household_contacts (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        role text NULL,
        name text NOT NULL,
        email text NULL,
        phone text NULL,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      )`,
    );

    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_household_contacts_user ON household_contacts (user_id, created_at)',
    );
  }

  private async getProfileId(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return profile.id;
  }

  async listContacts(clerkUserId: string): Promise<HouseholdContact[]> {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query(
      `SELECT *
       FROM household_contacts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [profileId],
    );
    return (res.rows || []) as any;
  }

  async createContact(
    clerkUserId: string,
    dto: { role?: string | null; name: string; email?: string | null; phone?: string | null },
  ): Promise<HouseholdContact> {
    const profileId = await this.getProfileId(clerkUserId);
    const id = randomUUID();

    const name = String(dto?.name || '').trim();
    if (!name) throw new Error('name is required');

    const role = dto?.role !== undefined ? String(dto.role || '').trim() || null : null;
    const email = dto?.email !== undefined ? String(dto.email || '').trim() || null : null;
    const phone = dto?.phone !== undefined ? String(dto.phone || '').trim() || null : null;

    const res = await this.db.query(
      `INSERT INTO household_contacts (id, user_id, role, name, email, phone)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [id, profileId, role, name, email, phone],
    );
    return res.rows[0] as any;
  }

  async updateContact(
    clerkUserId: string,
    id: string,
    dto: { role?: string | null; name?: string; email?: string | null; phone?: string | null },
  ): Promise<HouseholdContact | null> {
    const profileId = await this.getProfileId(clerkUserId);

    const fields: string[] = [];
    const params: any[] = [];

    const setField = (col: string, value: any) => {
      fields.push(`${col} = $${params.length + 1}`);
      params.push(value);
    };

    if (dto.name !== undefined) {
      const name = String(dto.name || '').trim();
      if (!name) throw new Error('name is required');
      setField('name', name);
    }

    if (dto.role !== undefined) {
      const role = String(dto.role || '').trim();
      setField('role', role || null);
    }

    if (dto.email !== undefined) {
      const email = String(dto.email || '').trim();
      setField('email', email || null);
    }

    if (dto.phone !== undefined) {
      const phone = String(dto.phone || '').trim();
      setField('phone', phone || null);
    }

    if (fields.length === 0) {
      const current = await this.db.query(
        'SELECT * FROM household_contacts WHERE id = $1 AND user_id = $2',
        [id, profileId],
      );
      return (current.rows[0] || null) as any;
    }

    fields.push('updated_at = NOW()');

    params.push(id);
    params.push(profileId);

    const query = `UPDATE household_contacts SET ${fields.join(', ')} WHERE id = $$${params.length - 1} AND user_id = $${params.length} RETURNING *`;
    const res = await this.db.query(query, params);
    return (res.rows[0] || null) as any;
  }

  async deleteContact(clerkUserId: string, id: string): Promise<{ ok: boolean }> {
    const profileId = await this.getProfileId(clerkUserId);
    await this.db.query('DELETE FROM household_contacts WHERE id = $1 AND user_id = $2', [id, profileId]);
    return { ok: true };
  }

  private normalizeKey(s: string) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async findBestContactByNameOrRole(
    clerkUserId: string,
    query: string,
  ): Promise<HouseholdContact | null> {
    const q = this.normalizeKey(query);
    if (!q) return null;

    const contacts = await this.listContacts(clerkUserId);
    if (!contacts.length) return null;

    const scored = contacts
      .map((c) => {
        const name = this.normalizeKey(c.name || '');
        const role = this.normalizeKey(c.role || '');
        const hay = `${role} ${name}`.trim();
        const exact = hay === q;
        const contains = hay.includes(q) || q.includes(hay);
        const score = exact ? 100 : contains ? 50 : 0;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.c || null;
  }
}
