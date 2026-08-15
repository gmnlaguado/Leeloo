import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { Pool } from 'pg';

@Injectable()
export class OpenAiQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpenAiQueue.name);
  private pool: Pool | null = null;
  private openai!: OpenAI;
  private anthropic!: Anthropic;

  private static readonly OPENAI_CALLS_PER_HOUR = 30;
  private static readonly CLAUDE_CALLS_PER_HOUR = 20;
  private static readonly CLAUDE_MONTHLY_TOKEN_BUDGET = 5_000_000;

  // In-memory rate limiting — resets on restart, works for single-instance
  private readonly rateLimitMap = new Map<string, { count: number; expiresAt: number }>();
  private monthlyTokens = 0;
  private monthlyTokensKey = '';

  async onModuleInit() {
    const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
    this.openai = new OpenAI({ apiKey: openaiKey });

    const anthropicKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
    this.anthropic = new Anthropic({ apiKey: anthropicKey });

    const dbUrl =
      String(process.env.SUPABASE_DB_URL || '').trim() ||
      String(process.env.DATABASE_URL || '').trim();
    if (dbUrl) {
      this.pool = new Pool({ connectionString: dbUrl });
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  async transcribe(input: { userId: string; filename: string; bytes: Buffer }): Promise<string> {
    await this.assertWithinOpenAiRateLimit(input.userId);
    const file = await toFile(input.bytes, input.filename, { type: 'application/octet-stream' });
    const res = await this.openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });
    return String((res as any)?.text || '');
  }

  async tts(input: { userId: string; text: string; model: string; voice: string }): Promise<string> {
    await this.assertWithinOpenAiRateLimit(input.userId);
    const res = await this.openai.audio.speech.create({
      model: input.model,
      voice: input.voice,
      input: input.text,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }

  async extractIntent(input: {
    userId: string;
    language: string;
    transcription: string;
    memoryContext: string;
    systemPrompt: string;
    systemPromptVersion: string;
  }) {
    try {
      await this.assertWithinClaudeRateLimit(input.userId);
      const raw = await this.extractIntentWithClaude(input);
      const parsed = JSON.parse(raw || '{}');

      const slots = parsed?.slots && typeof parsed.slots === 'object' ? parsed.slots : {};
      const normalizedSlots: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(slots)) {
        if (typeof v === 'string') normalizedSlots[k] = v;
        else if (v !== undefined && v !== null) normalizedSlots[k] = String(v);
      }

      return {
        intent: String(parsed?.intent || 'chat'),
        confidence: Number(parsed?.confidence || 0.5),
        language: (String(parsed?.language || input.language) as any) || 'en',
        slots: normalizedSlots,
        assistant_text: String(parsed?.assistant_text || ''),
        needs_confirmation: Boolean(parsed?.needs_confirmation),
      };
    } catch (err: any) {
      return {
        intent: 'chat',
        confidence: 0.1,
        language: (input.language as any) || 'en',
        slots: {},
        assistant_text: this.fallbackText(input.language),
        needs_confirmation: false,
      };
    }
  }

  async fetchMemoryContext(input: { userId: string; query: string; limit: number }): Promise<string> {
    return this.fetchMemoriesPgvector(input);
  }

  private async extractIntentWithClaude(data: {
    userId: string;
    language: string;
    transcription: string;
    memoryContext: string;
    systemPrompt: string;
    systemPromptVersion: string;
  }): Promise<string> {
    const monthKey = this.monthlyBudgetKey();
    if (monthKey !== this.monthlyTokensKey) {
      this.monthlyTokens = 0;
      this.monthlyTokensKey = monthKey;
    }

    if (this.monthlyTokens >= OpenAiQueue.CLAUDE_MONTHLY_TOKEN_BUDGET) {
      this.logger.warn(`Monthly Claude token budget exhausted (${this.monthlyTokens} tokens used)`);
      throw Object.assign(new Error('Claude monthly budget exceeded'), { status: 429 });
    }

    const userContent = this.buildIntentPrompt(data);
    const response = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      temperature: 0.2,
      system: [{ type: 'text', text: data.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    } as any);

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    this.monthlyTokens += inputTokens + outputTokens;

    this.logger.debug(
      `Claude intent: ${inputTokens} in / ${outputTokens} out. Month total: ${this.monthlyTokens}`,
    );

    const block = response.content?.[0];
    if (block?.type !== 'text') return '{}';

    const text = block.text.trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return '{}';
    return text.slice(start, end + 1);
  }

  private assertWithinOpenAiRateLimit(userId: string) {
    return this.assertRateLimit(`openai:${userId}`, OpenAiQueue.OPENAI_CALLS_PER_HOUR, 'OpenAI');
  }

  private assertWithinClaudeRateLimit(userId: string) {
    return this.assertRateLimit(`claude:${userId}`, OpenAiQueue.CLAUDE_CALLS_PER_HOUR, 'Claude');
  }

  private assertRateLimit(key: string, limit: number, name: string) {
    const now = Date.now();
    const bucket = Math.floor(now / (60 * 60 * 1000));
    const fullKey = `${key}:${bucket}`;

    const entry = this.rateLimitMap.get(fullKey);
    if (!entry) {
      this.rateLimitMap.set(fullKey, { count: 1, expiresAt: now + 60 * 60 * 1000 });
      return;
    }

    if (now > entry.expiresAt) {
      this.rateLimitMap.set(fullKey, { count: 1, expiresAt: now + 60 * 60 * 1000 });
      return;
    }

    entry.count++;
    if (entry.count > limit) {
      const e: any = new Error(`${name} rate limit exceeded`);
      e.status = 429;
      throw e;
    }
  }

  private monthlyBudgetKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private fallbackText(language: string) {
    return String(language || '')
      .toLowerCase()
      .startsWith('es')
      ? 'Ahora mismo estoy teniendo problemas para responder, pero te escuché. ¿Puedes repetirlo en una frase corta?'
      : 'I\'m having trouble right now, but I heard you. Can you repeat that in one short sentence?';
  }

  private buildIntentPrompt(data: { language: string; transcription: string; memoryContext: string; systemPromptVersion: string }) {
    const memory = data.memoryContext ? `MEMORY CONTEXT:\n${data.memoryContext}\n\n` : '';
    return `${memory}LANGUAGE_HINT: ${data.language}\nSYSTEM_PROMPT_VERSION: ${data.systemPromptVersion}\n\nUSER_SAID:\n${data.transcription}`;
  }

  private async fetchMemoriesPgvector(input: { userId: string; query: string; limit: number }): Promise<string> {
    if (!this.pool) return '';

    const profileId = await this.resolveProfileId(input.userId);
    if (!profileId) return '';

    try {
      const q = String(input.query || '').trim();
      if (!q) return '';

      await this.assertWithinOpenAiRateLimit(input.userId);
      const emb = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: q,
      });
      const vec = emb.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) return '';

      const vecLiteral = `[${vec.join(',')}]`;
      const limit = Math.max(1, Math.min(5, Math.floor(input.limit || 5)));
      const res = await this.pool.query(
        `SELECT category, key, value
         FROM memories
         WHERE user_id = $1
           AND key NOT LIKE 'turn_%'
         ORDER BY embedding <-> $2::vector
         LIMIT $3`,
        [profileId, vecLiteral, limit],
      );

      return (res.rows || [])
        .map((r: any) => {
          const cat = String(r?.category || '').trim();
          const k = String(r?.key || '').trim();
          return `${cat}${k ? `:${k}` : ''} = ${JSON.stringify(r?.value)}`;
        })
        .join('\n');
    } catch {
      try {
        const limit = Math.max(1, Math.min(5, Math.floor(input.limit || 5)));
        const [memRes, contactRes] = await Promise.all([
          this.pool.query(
            `SELECT category, key, value
             FROM memories
             WHERE user_id = $1
               AND key NOT LIKE 'turn_%'
             ORDER BY last_used DESC
             LIMIT $2`,
            [profileId, limit],
          ),
          this.pool.query(
            `SELECT name, nickname, email, phone, relation
             FROM contacts
             WHERE user_id = $1
             ORDER BY updated_at DESC
             LIMIT 20`,
            [profileId],
          ),
        ]);

        const memLines = (memRes.rows || []).map((r: any) => {
          const cat = String(r?.category || '').trim();
          const k = String(r?.key || '').trim();
          return `${cat}${k ? `:${k}` : ''} = ${JSON.stringify(r?.value)}`;
        });

        const contactLines = (contactRes.rows || [])
          .filter((r: any) => r?.email || r?.phone)
          .map((r: any) => {
            const name = r.nickname ? `${r.name} (${r.nickname})` : r.name;
            const parts = [];
            if (r.email) parts.push(`email:${r.email}`);
            if (r.phone) parts.push(`phone:${r.phone}`);
            if (r.relation) parts.push(`relation:${r.relation}`);
            return `contact:${name} = ${parts.join(', ')}`;
          });

        return [...memLines, ...contactLines].join('\n');
      } catch {
        return '';
      }
    }
  }

  async fetchUserContext(clerkUserId: string): Promise<{
    todayTasks: string[];
    upcomingEvents: string[];
    pendingApprovals: number;
  }> {
    const empty = { todayTasks: [], upcomingEvents: [], pendingApprovals: 0 };
    if (!this.pool) return empty;

    const profileId = await this.resolveProfileId(clerkUserId);
    if (!profileId) return empty;

    try {
      const [tasksRes, eventsRes, approvalsRes] = await Promise.all([
        this.pool.query<{ title: string }>(
          `SELECT title FROM tasks
           WHERE user_id = $1 AND status = 'pending'
             AND (due_at IS NULL OR due_at::date = CURRENT_DATE)
           ORDER BY due_at NULLS LAST LIMIT 10`,
          [profileId],
        ),
        this.pool.query<{ title: string; start_at: string; location: string | null }>(
          `SELECT title, start_at, location FROM calendar_events
           WHERE user_id = $1
             AND start_at::date = CURRENT_DATE
           ORDER BY start_at ASC LIMIT 10`,
          [profileId],
        ),
        this.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM child_requests
           WHERE parent_id = $1 AND approved = false`,
          [profileId],
        ),
      ]);

      const todayTasks = tasksRes.rows.map((r) => r.title).filter(Boolean);
      const upcomingEvents = eventsRes.rows.map((r) => {
        const time = new Date(r.start_at).toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
        });
        return `${r.title} a las ${time}${r.location ? ` en ${r.location}` : ''}`;
      });
      const pendingApprovals = parseInt(approvalsRes.rows[0]?.count || '0', 10);

      return { todayTasks, upcomingEvents, pendingApprovals };
    } catch (err) {
      this.logger.warn(`fetchUserContext failed user=${clerkUserId}: ${String(err)}`);
      return empty;
    }
  }

  private async resolveProfileId(clerkUserId: string): Promise<string | null> {
    const id = String(clerkUserId || '').trim();
    if (!id) return null;
    if (!this.pool) return null;

    try {
      const res = await this.pool.query(
        'SELECT id FROM profiles WHERE clerk_user_id = $1 LIMIT 1',
        [id],
      );
      return res.rows?.[0]?.id ? String(res.rows[0].id) : null;
    } catch {
      return null;
    }
  }
}
