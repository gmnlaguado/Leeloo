import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class FamilyService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS family_members (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        name text NOT NULL,
        role text NOT NULL,
        age int NULL,
        school_email_domain text NULL,
        notes text NULL,
        created_at timestamptz DEFAULT NOW()
      )
    `);
    await this.db.query('CREATE INDEX IF NOT EXISTS idx_family_user ON family_members (user_id)');
  }

  private async getProfileId(clerkUserId: string): Promise<string> {
    const p = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return p.id;
  }

  async addMember(clerkUserId: string, data: { name: string; role: string; age?: number }) {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query(
      `INSERT INTO family_members (id, user_id, name, role, age)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), profileId, data.name, data.role, data.age ?? null],
    );
    return res.rows[0];
  }

  async listMembers(clerkUserId: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query(
      `SELECT * FROM family_members WHERE user_id = $1 ORDER BY created_at ASC`,
      [profileId],
    );
    return res.rows;
  }

  async findMemberByName(clerkUserId: string, name: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query(
      `SELECT * FROM family_members WHERE user_id = $1 AND lower(name) LIKE $2 LIMIT 1`,
      [profileId, `%${name.toLowerCase()}%`],
    );
    return res.rows[0] ?? null;
  }
}
