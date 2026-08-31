import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class GoalsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        title text NOT NULL,
        category text NULL,
        target_date date NULL,
        status text NOT NULL DEFAULT 'active',
        progress int NOT NULL DEFAULT 0,
        notes text NULL,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      )
    `);
    await this.db.query('CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id, status)');
  }

  private async getProfileId(clerkUserId: string): Promise<string> {
    const p = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return p.id;
  }

  async createGoal(clerkUserId: string, data: { title: string; category?: string; target_date?: string }) {
    const profileId = await this.getProfileId(clerkUserId);
    const id = randomUUID();
    const res = await this.db.query(
      `INSERT INTO goals (id, user_id, title, category, target_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, profileId, data.title, data.category ?? null, data.target_date ?? null],
    );
    return res.rows[0];
  }

  async listGoals(clerkUserId: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query(
      `SELECT * FROM goals WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC`,
      [profileId],
    );
    return res.rows;
  }

  async updateGoal(clerkUserId: string, id: string, updates: { progress?: number; status?: string; notes?: string }) {
    const profileId = await this.getProfileId(clerkUserId);
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [id, profileId];
    if (updates.progress !== undefined) { sets.push(`progress = $${params.length + 1}`); params.push(updates.progress); }
    if (updates.status)  { sets.push(`status = $${params.length + 1}`); params.push(updates.status); }
    if (updates.notes)   { sets.push(`notes = $${params.length + 1}`);  params.push(updates.notes); }
    const res = await this.db.query(
      `UPDATE goals SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      params,
    );
    return res.rows[0];
  }
}
