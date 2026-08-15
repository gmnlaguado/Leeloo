import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Lightweight pg pool shared across worker jobs.
 * Reads SUPABASE direct connection string from DATABASE_URL or SUPABASE_DB_URL.
 */
@Injectable()
export class WorkerDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WorkerDbService');
  private pool: Pool | null = null;

  async onModuleInit() {
    const url =
      String(process.env.DATABASE_URL || '').trim() ||
      String(process.env.SUPABASE_DB_URL || '').trim();
    if (!url) {
      this.logger.warn('DATABASE_URL/SUPABASE_DB_URL not set — DB features disabled in worker');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      max: Number(process.env.WORKER_PG_POOL_MAX || 5),
      ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
    });
    await this.ensureSchema();
  }

  private async ensureSchema() {
    if (!this.pool) return;
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS push_tokens (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id uuid NOT NULL,
          expo_push_token text NOT NULL,
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, expo_push_token)
        );
        CREATE INDEX IF NOT EXISTS push_tokens_user_active_idx
          ON push_tokens(user_id) WHERE is_active = true;

        CREATE TABLE IF NOT EXISTS pending_leeloo_mentions (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id uuid NOT NULL,
          mention_kind text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          consumed boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS plm_user_kind_consumed_idx
          ON pending_leeloo_mentions(user_id, mention_kind, consumed);

        CREATE TABLE IF NOT EXISTS briefings (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id uuid NOT NULL,
          briefing_date date NOT NULL,
          briefing_kind text NOT NULL DEFAULT 'tomorrow_preview',
          text_content text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, briefing_date, briefing_kind)
        );
      `);
      this.logger.log('Schema ensured: push_tokens, pending_leeloo_mentions, briefings');
    } catch (err) {
      this.logger.error(`ensureSchema failed: ${String(err)}`);
    }
  }

  isReady() {
    return Boolean(this.pool);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    if (!this.pool) return { rows: [] };
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as T[] };
  }

  async onModuleDestroy() {
    await this.pool?.end();
    this.pool = null;
  }
}
