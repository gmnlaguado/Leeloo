import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class MemoriesService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private async ensureSchema() {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS memories (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        category text NOT NULL,
        key text NOT NULL,
        value jsonb NULL,
        confidence real DEFAULT 1.0,
        last_used timestamptz DEFAULT NOW(),
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      )`,
    );

    await this.db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_key_unique ON memories (user_id, key)');
    await this.db.query('CREATE INDEX IF NOT EXISTS idx_memories_user_last_used ON memories (user_id, last_used DESC)');
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_fts ON memories
       USING GIN (to_tsvector('simple', coalesce(key,'') || ' ' || coalesce(category,'') || ' ' || coalesce(value::text,'')))`,
    );
  }

  private async touchMemories(ids: string[]) {
    const safeIds = (ids || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (safeIds.length === 0) return;
    try {
      await this.db.query(
        `UPDATE memories SET last_used = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [safeIds],
      );
    } catch {
    }
  }

  private safeKeyPart(value: string) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_:\-]/g, '')
      .slice(0, 80);
  }

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

  async getMemoriesByKeyPrefix(userId: string, prefix: string, limit = 50) {
    const profileId = await this.getProfileId(userId);
    const safePrefix = String(prefix || '').replace(/%/g, '');
    const res = await this.db.query(
      `SELECT *
       FROM memories
       WHERE user_id = $1
         AND key LIKE $2
       ORDER BY last_used DESC
       LIMIT $3`,
      [profileId, `${safePrefix}%`, limit],
    );
    return res.rows || [];
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
    const profileId = await this.getProfileId(userId);
    const q = String(query || '').trim();
    if (!q) return [];

    const result = await this.db.query(
      `SELECT *,
        ts_rank(
          to_tsvector('simple', coalesce(key,'') || ' ' || coalesce(category,'') || ' ' || coalesce(value::text,'')),
          plainto_tsquery('simple', $2)
        ) AS rank
       FROM memories
       WHERE user_id = $1
         AND key NOT LIKE 'turn_%'
         AND to_tsvector('simple', coalesce(key,'') || ' ' || coalesce(category,'') || ' ' || coalesce(value::text,''))
             @@ plainto_tsquery('simple', $2)
       ORDER BY rank DESC, last_used DESC
       LIMIT $3`,
      [profileId, q, limit],
    );
    const rows = result.rows || [];
    void this.touchMemories(rows.map((r: any) => String(r?.id || '')).filter(Boolean));
    return rows;
  }

  async listMemories(
    userId: string,
    opts?: { prefix?: string; category?: string; limit?: number },
  ) {
    const profileId = await this.getProfileId(userId);
    const limit = typeof opts?.limit === 'number' ? Math.max(1, Math.min(200, Math.floor(opts.limit))) : 50;
    const prefix = typeof opts?.prefix === 'string' ? opts.prefix.trim() : '';
    const category = typeof opts?.category === 'string' ? opts.category.trim() : '';

    if (prefix) {
      return this.getMemoriesByKeyPrefix(userId, prefix, limit);
    }

    if (category) {
      const safeCategory = category.replace(/%/g, '');
      const res = await this.db.query(
        `SELECT *
         FROM memories
         WHERE user_id = $1
           AND category = $2
         ORDER BY last_used DESC
         LIMIT $3`,
        [profileId, safeCategory, limit],
      );
      return res.rows || [];
    }

    const res = await this.db.query(
      `SELECT *
       FROM memories
       WHERE user_id = $1
       ORDER BY last_used DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return res.rows || [];
  }

  async createMemory(userId: string, category: string, key: string, value: any) {
    const profileId = await this.getProfileId(userId);
    const id = randomUUID();
    const res = await this.db.query(
      `INSERT INTO memories (id, user_id, category, key, value, confidence, last_used, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [id, profileId, category, key, value, 1.0],
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

  async getSessionSummary(userId: string) {
    const row = await this.getMemoryByKey(userId, 'session_summary');
    const value = row?.value;
    if (!value || typeof value !== 'object') return null;
    const summary = typeof (value as any).summary === 'string' ? String((value as any).summary) : '';
    return summary ? summary : null;
  }

  async upsertFact(userId: string, namespace: string, key: string, value: any) {
    const ns = this.safeKeyPart(namespace);
    const k = this.safeKeyPart(key);
    const memoryKey = `fact:${ns}:${k}`;
    return this.upsertMemoryByKey(userId, 'fact', memoryKey, {
      namespace: ns,
      key: k,
      value,
      updated_at: new Date().toISOString(),
    });
  }

  async getFacts(userId: string, namespaces: string[], limitPerNamespace = 30) {
    const out: any[] = [];
    for (const nsRaw of namespaces || []) {
      const ns = this.safeKeyPart(nsRaw);
      if (!ns) continue;
      const rows = await this.getMemoriesByKeyPrefix(userId, `fact:${ns}:`, limitPerNamespace);
      for (const r of rows || []) out.push(r);
    }
    return out;
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
    fields.push('updated_at = NOW()');
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
