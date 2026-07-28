import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class TasksService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private async ensureSchema() {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS tasks (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        title text NOT NULL,
        description text NULL,
        due_at timestamptz NULL,
        status text NOT NULL DEFAULT 'pending',
        priority text NULL,
        metadata jsonb NULL,
        created_by text NULL,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      )`,
    );

    await this.db.query('CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks (user_id, due_at)');
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status)',
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

  async getTasks(clerkUserId: string, filters?: { status?: string; limit?: number }) {
    const profileId = await this.getProfileId(clerkUserId);

    const conditions: string[] = ['user_id = $1'];
    const params: any[] = [profileId];

    if (filters?.status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(filters.status);
    }

    let query = `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;

    if (filters?.limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(filters.limit);
    }

    const result = await this.db.query(query, params);
    return result.rows;
  }

  async createTask(taskData: any) {
    const {
      user_id: clerkUserId,
      title,
      description = null,
      due_at = null,
      metadata = null,
      priority = 'medium',
    } = taskData;

    const profileId = await this.getProfileId(clerkUserId);

    const id = randomUUID();

    const result = await this.db.query(
      `INSERT INTO tasks (id, user_id, title, description, due_at, metadata, created_by, status, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, profileId, title, description, due_at, metadata, 'user', 'pending', priority],
    );

    return result.rows[0];
  }

  async updateTask(clerkUserId: string, id: string, updates: any) {
    const profileId = await this.getProfileId(clerkUserId);

    const fields: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      fields.push(`title = $${params.length + 1}`);
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${params.length + 1}`);
      params.push(updates.description);
    }
    if (updates.due_at !== undefined) {
      fields.push(`due_at = $${params.length + 1}`);
      params.push(updates.due_at);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${params.length + 1}`);
      params.push(updates.status);
    }
    if (updates.priority !== undefined) {
      fields.push(`priority = $${params.length + 1}`);
      params.push(updates.priority);
    }
    if (updates.metadata !== undefined) {
      fields.push(`metadata = $${params.length + 1}`);
      params.push(updates.metadata);
    }

    fields.push(`updated_at = NOW()`);

    if (fields.length === 0) {
      const current = await this.db.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [
        id,
        profileId,
      ]);
      return current.rows[0] || null;
    }

    params.push(id);
    params.push(profileId);
    const query = `UPDATE tasks SET ${fields.join(
      ', ',
    )} WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`;

    const result = await this.db.query(query, params);
    return result.rows[0] || null;
  }

  async deleteTask(clerkUserId: string, id: string) {
    const profileId = await this.getProfileId(clerkUserId);
    await this.db.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, profileId]);
    return { success: true };
  }

  async getTasksForDay(clerkUserId: string, day: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const timezone = await this.getUserTimezone(clerkUserId);
    const startLocal = `${day} 00:00:00`;
    const endLocal = `${day} 23:59:59.999`;

    const res = await this.db.query(
      `SELECT *
       FROM tasks
       WHERE user_id = $1
         AND due_at IS NOT NULL
         AND (due_at AT TIME ZONE $2) >= $3::timestamp
         AND (due_at AT TIME ZONE $2) <= $4::timestamp
       ORDER BY due_at ASC`,
      [profileId, timezone, startLocal, endLocal],
    );

    return { day, timezone, tasks: res.rows || [] };
  }
}
