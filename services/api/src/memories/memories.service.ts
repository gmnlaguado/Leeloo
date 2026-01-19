import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class MemoriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  private async getProfileId(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return profile.id;
  }

  async getMemoryByKey(userId: string, key: string) {
    const profileId = await this.getProfileId(userId);
    const res = await this.db.query(
      `SELECT * FROM memories WHERE user_id = $1 AND key = $2 LIMIT 1`,
      [profileId, key],
    );
    return res.rows[0] || null;
  }

  async getRecentConversationTurns(userId: string, limit = 5) {
    const profileId = await this.getProfileId(userId);
    const res = await this.db.query(
      `SELECT *
       FROM memories
       WHERE user_id = $1
         AND key LIKE 'turn_%'
       ORDER BY created_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return res.rows || [];
  }

  async getRelevantMemories(userId: string, query: string, limit = 10) {
    void query;
    const profileId = await this.getProfileId(userId);
    const result = await this.db.query(
      `SELECT *
       FROM memories
       WHERE user_id = $1
         AND key NOT LIKE 'turn_%'
       ORDER BY last_used DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows || [];
  }

  async createMemory(userId: string, category: string, key: string, value: any) {
    const profileId = await this.getProfileId(userId);
    const res = await this.db.query(
      `INSERT INTO memories (user_id, category, key, value, confidence, last_used)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [profileId, category, key, value, 1.0],
    );
    return res.rows[0];
  }

  async upsertMemoryByKey(userId: string, category: string, key: string, value: any) {
    const profileId = await this.getProfileId(userId);
    const existing = await this.db.query(
      `SELECT * FROM memories WHERE user_id = $1 AND key = $2 LIMIT 1`,
      [profileId, key],
    );

    const row = existing.rows[0] || null;
    if (!row) {
      return this.createMemory(userId, category, key, value);
    }

    return this.updateMemory(row.id, { category, value, confidence: 1.0 });
  }

  async appendTurn(userId: string, turn: { user: string; assistant: string; language?: string; meta?: any }) {
    const key = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return this.createMemory(userId, 'conversation_turn', key, {
      user: turn.user,
      assistant: turn.assistant,
      ...(turn.language ? { language: turn.language } : {}),
      ...(turn.meta ? { meta: turn.meta } : {}),
      at: new Date().toISOString(),
    });
  }

  async setSessionSummary(userId: string, summary: { language?: string; assistant_name?: string; summary: string }) {
    return this.upsertMemoryByKey(userId, 'session', 'session_summary', {
      assistant_name: summary.assistant_name || 'Leeloo',
      ...(summary.language ? { language: summary.language } : {}),
      summary: summary.summary,
      updated_at: new Date().toISOString(),
    });
  }

  async updateMemory(id: string, updates: any) {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.category !== undefined) {
      fields.push(`category = $${params.length + 1}`);
      params.push(updates.category);
    }
    if (updates.key !== undefined) {
      fields.push(`key = $${params.length + 1}`);
      params.push(updates.key);
    }
    if (updates.value !== undefined) {
      fields.push(`value = $${params.length + 1}`);
      params.push(updates.value);
    }
    if (updates.confidence !== undefined) {
      fields.push(`confidence = $${params.length + 1}`);
      params.push(updates.confidence);
    }

    fields.push('last_used = NOW()');
    params.push(id);

    const res = await this.db.query(
      `UPDATE memories SET ${fields.join(', ')} WHERE id = $${
        params.length
      } RETURNING *`,
      params,
    );
    return res.rows[0];
  }
}
