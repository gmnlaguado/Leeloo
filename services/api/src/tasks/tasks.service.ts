import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  private async getProfileId(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return profile.id;
  }

  async getTasks(clerkUserId: string, filters?: { status?: string; limit?: number }) {
    const profileId = await this.getProfileId(clerkUserId);

    const conditions: string[] = ['user_id = $1'];
    const params: any[] = [profileId];

    if (filters?.status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(filters.status);
    }

    let query = `SELECT * FROM tasks WHERE ${conditions.join(
      ' AND ',
    )} ORDER BY created_at DESC`;

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

    const result = await this.db.query(
      `INSERT INTO tasks (user_id, title, description, due_at, metadata, created_by, status, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [profileId, title, description, due_at, metadata, 'user', 'pending', priority],
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
      const current = await this.db.query(
        'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
        [id, profileId],
      );
      return current.rows[0] || null;
    }

    params.push(id);
    params.push(profileId);
    const query = `UPDATE tasks SET ${fields.join(
      ', ',
    )} WHERE id = $${params.length - 1} AND user_id = $${
      params.length
    } RETURNING *`;

    const result = await this.db.query(query, params);
    return result.rows[0] || null;
  }

  async deleteTask(clerkUserId: string, id: string) {
    const profileId = await this.getProfileId(clerkUserId);
    await this.db.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, profileId]);
    return { success: true };
  }
}
