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

  onModuleInit() {
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
