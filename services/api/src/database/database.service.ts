import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryResult, QueryResultRow } from 'pg';

class DbError extends Error {
  code?: string;
  severity?: string;
  detail?: string;
  hint?: string;
  length: number;

  constructor(msg: string, meta: Record<string, unknown> = {}) {
    super(msg);
    this.name = 'DbError';
    this.code = meta['code'] as string | undefined;
    this.severity = meta['severity'] as string | undefined;
    this.detail = meta['detail'] as string | undefined;
    this.hint = meta['hint'] as string | undefined;
    this.length = msg.length;
  }
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly proxyUrl: string;
  private readonly proxySecret: string;
  private readonly supabaseKey: string;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    this.proxyUrl = `${supabaseUrl}/functions/v1/sql-proxy`;
    this.proxySecret = this.configService.getOrThrow<string>('SQL_PROXY_SECRET');
    this.supabaseKey = this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'x-proxy-secret': this.proxySecret,
      },
      body: JSON.stringify({ sql: text, params: params ?? [] }),
    });

    const json = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const msg = String(json['error'] ?? `HTTP ${response.status}`);
      this.logger.error(`SQL proxy error: ${msg}`, { text, code: json['code'] });
      throw new DbError(msg, json);
    }

    return {
      rows: (json['rows'] as T[]) ?? [],
      rowCount: (json['rowCount'] as number) ?? 0,
      command: String(json['command'] ?? 'SELECT'),
      fields: [],
      oid: 0,
    } as unknown as QueryResult<T>;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getClient(): Promise<never> {
    throw new Error('Direct client access is not available — use query() instead');
  }

  async onModuleDestroy(): Promise<void> {
    // Nothing to close — connections are managed by the edge function pool
  }
}
