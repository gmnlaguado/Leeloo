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

  // Groq is free-tier with much higher limits than OpenAI — 200/hr keeps wake-word detection healthy.
  // Override via STT_RATE_LIMIT_PER_HOUR env var on Render.
  private static readonly OPENAI_CALLS_PER_HOUR = parseInt(process.env.STT_RATE_LIMIT_PER_HOUR || '0', 10)
    || (process.env.GROQ_API_KEY ? 200 : 30);
  private static readonly CLAUDE_CALLS_PER_HOUR = 20;
  private static readonly CLAUDE_MONTHLY_TOKEN_BUDGET = 5_000_000;

  // In-memory rate limiting — resets on restart, works for single-instance
  private readonly rateLimitMap = new Map<string, { count: number; expiresAt: number }>();
  private monthlyTokens = 0;
  private monthlyTokensKey = '';

  // Cache profileId lookups — clerk_user_id → internal UUID never changes, safe to cache for the process lifetime.
  // Eliminates a DB round-trip per request (resolveProfileId was called once per fetchUserContext AND once per fetchMemoriesPgvector).
  private readonly profileIdCache = new Map<string, string>();

  // Whether the memories.embedding column + pgvector extension exist in this DB.
  // Checked once at startup to avoid generating a useless OpenAI embedding (~500ms) on every request.
  private pgvectorEnabled = false;

  async onModuleInit() {
    // Groq offers free Whisper transcription with OpenAI-compatible API.
    // Set GROQ_API_KEY in Render to enable mic/voice input without paying OpenAI.
    const groqKey = String(process.env.GROQ_API_KEY || '').trim();
    const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
    // 8-second hard timeout on ALL Groq requests. Without this, openai.embeddings.create()
    // (unsupported on Groq) hangs ~60s before failing, blocking every voice request.
    this.openai = groqKey
      ? new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1', timeout: 8_000 })
      : new OpenAI({ apiKey: openaiKey });

    const anthropicKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
    this.anthropic = new Anthropic({ apiKey: anthropicKey });

    const dbUrl =
      String(process.env.SUPABASE_DB_URL || '').trim() ||
      String(process.env.DATABASE_URL || '').trim();
    if (dbUrl) {
      this.pool = new Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 2_000,  // fail fast if pool exhausted — don't block the 6s race
        idleTimeoutMillis: 60_000,
        max: 5,
        ssl: { rejectUnauthorized: false },
      });
      this.pool.query('SELECT 1')
        .then(() => {
          this.logger.log('[DB] Supabase pool connected ✓');
          // Check once if pgvector + memories.embedding column exist.
          // Avoids wasting ~500ms generating OpenAI embeddings on every request when not configured.
          return this.pool!.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_name='memories' AND column_name='embedding' LIMIT 1`,
          );
        })
        .then((r: any) => {
          this.pgvectorEnabled = (r?.rowCount ?? 0) > 0;
          this.logger.log(`[DB] pgvector memories: ${this.pgvectorEnabled ? 'enabled ✓' : 'not configured — using SQL fallback'}`);
        })
        .catch((e: any) => this.logger.error(`[DB] Supabase FAILED: ${e?.message} — memory/ctx unavailable`));
      // Keep-alive ping every 90s — prevents Supabase Pooler session expiry under low traffic.
      setInterval(() => {
        this.pool?.query('SELECT 1').catch(() => { /* silent — reconnect happens automatically */ });
      }, 90 * 1000);
    } else {
      this.logger.warn('[DB] No SUPABASE_DB_URL or DATABASE_URL — memory disabled');
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  // Circuit breaker for leeloo-stt: after 2 consecutive failures, bypass for 5 min.
  // This prevents 500ms+ latency per request when the self-hosted model isn't loading.
  private static sttFailures = 0;
  private static sttBypassUntil = 0;

  async transcribe(input: { userId: string; filename: string; bytes: Buffer; language?: string }): Promise<string> {
    await this.assertWithinOpenAiRateLimit(input.userId);

    // Use self-hosted leeloo-stt first (<2s, already paid $25/mo on Render Standard).
    // Falls back to Groq only if the STT service is unreachable or returns an error.
    const sttBypassed = Date.now() < OpenAiQueue.sttBypassUntil;
    if (sttBypassed) {
      this.logger.warn(`[STT] leeloo-stt circuit open — bypassing for ${Math.ceil((OpenAiQueue.sttBypassUntil - Date.now()) / 1000)}s more`);
    } else {
      try {
        const text = await this.transcribeViaSTTService({ filename: input.filename, bytes: input.bytes });
        if (text) {
          OpenAiQueue.sttFailures = 0; // reset on success
          return text;
        }
      } catch (err: any) {
        OpenAiQueue.sttFailures += 1;
        this.logger.warn(`[STT] leeloo-stt failed (consecutive=${OpenAiQueue.sttFailures}) — falling back to Groq — ${err?.message ?? String(err)}`);
        if (OpenAiQueue.sttFailures >= 2) {
          OpenAiQueue.sttBypassUntil = Date.now() + 5 * 60 * 1000;
          this.logger.error(`[STT] leeloo-stt circuit OPEN — bypassing for 5min after ${OpenAiQueue.sttFailures} consecutive failures`);
        }
      }
    }

    // Groq fallback (cloud Whisper, ~3-8s with turbo model)
    const isGroq = Boolean(process.env.GROQ_API_KEY);
    const provider = isGroq ? 'groq' : 'openai';
    // whisper-large-v3-turbo: Groq's fastest multilingual model.
    // distil-whisper-large-v3-en is English-only and garbles Spanish audio.
    const sttModel = isGroq
      ? 'whisper-large-v3-turbo'
      : (String(process.env.OPENAI_STT_MODEL || '').trim() || 'whisper-1');
    const sttLang = String(input.language || 'es').slice(0, 2).toLowerCase();
    const timeoutMs = isGroq ? 20_000 : 45_000;
    this.logger.log(`[STT] transcribe start — provider=${provider} model=${sttModel} lang=${sttLang} file=${input.filename} bytes=${input.bytes.length}`);
    const file = await toFile(input.bytes, input.filename, { type: 'audio/m4a' });

    // Use AbortController to actually cancel the underlying HTTP request on timeout.
    // Promise.race alone doesn't cancel the fetch; AbortController does.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      this.logger.warn(`[STT] ${provider} aborting — exceeded ${timeoutMs / 1000}s`);
      controller.abort();
    }, timeoutMs);

    let res: any;
    try {
      res = await this.openai.audio.transcriptions.create(
        { file, model: sttModel, language: sttLang, response_format: 'json' } as any,
        { signal: controller.signal } as any,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (controller.signal.aborted) {
      throw new Error(`[STT] ${provider} timeout after ${timeoutMs / 1000}s`);
    }

    const text = String((res as any)?.text || '');
    this.logger.log(`[STT] transcribe result — provider=${provider} "${text.slice(0, 80)}" (${text.length} chars)`);
    return text;
  }

  private async transcribeViaSTTService(input: { filename: string; bytes: Buffer }): Promise<string | null> {
    const sttUrl = String(process.env.STT_URL || '').trim();
    const sttSecret = String(process.env.STT_SHARED_SECRET || '').trim();
    if (!sttUrl || !sttSecret) return null;

    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.bytes)], { type: 'application/octet-stream' });
    form.append('file', blob, input.filename);
    form.append('language', 'es');

    const t0 = Date.now();
    this.logger.log(`[STT] leeloo-stt start — file=${input.filename} bytes=${input.bytes.length}`);

    const res = await fetch(`${sttUrl}/v1/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sttSecret}` },
      body: form,
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`leeloo-stt ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json() as { text?: string };
    const text = String(json?.text || '').trim();
    this.logger.log(`[STT] leeloo-stt result — ${Date.now() - t0}ms — "${text.slice(0, 80)}" (${text.length} chars)`);
    return text || null;
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

      const resolvedLang = String(parsed?.language || input.language || 'es').toLowerCase().slice(0, 5);
      const resolvedConf = Number(parsed?.confidence ?? 0.5);
      this.logger.log(`[INTENT] intent=${parsed?.intent} lang=${resolvedLang} conf=${resolvedConf} text="${String(parsed?.assistant_text || '').slice(0, 80)}"`);

      return {
        intent: String(parsed?.intent || 'chat'),
        confidence: resolvedConf,
        language: (resolvedLang as any),
        slots: normalizedSlots,
        assistant_text: String(parsed?.assistant_text || ''),
        needs_confirmation: Boolean(parsed?.needs_confirmation),
      };
    } catch (err: any) {
      this.logger.error(`[INTENT] extractIntent failed — ${err?.message ?? String(err)}`);
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
    // 12s timeout — profileId now cached so only the embedding + pgvector query remain.
    // Supabase Pooler cold-start adds up to 4s on top; 12s covers the worst case.
    return Promise.race([
      this.fetchMemoriesPgvector(input),
      new Promise<string>((resolve) =>
        setTimeout(() => {
          this.logger.warn('[MEMORY] DB timeout after 6s — skipping memory context');
          resolve('');
        }, 6_000),
      ),
    ]);
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

    const userContent = this.buildIntentPrompt({ ...data, language: data.language || 'es' });
    const claudeController = new AbortController();
    const claudeTimeout = setTimeout(() => {
      this.logger.warn('[INTENT] Claude timeout after 25s — aborting');
      claudeController.abort();
    }, 25_000);

    let response: any;
    try {
      response = await this.anthropic.messages.create(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          temperature: 0.3,
          system: [{ type: 'text', text: data.systemPrompt, cache_control: { type: 'ephemeral' } }],
          // Prefill forces Claude to begin with '{' — prevents prose responses that break JSON parsing.
          messages: [
            { role: 'user', content: userContent },
            { role: 'assistant', content: '{' },
          ],
        } as any,
        { signal: claudeController.signal } as any,
      );
    } finally {
      clearTimeout(claudeTimeout);
    }

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    this.monthlyTokens += inputTokens + outputTokens;

    this.logger.debug(
      `Claude intent: ${inputTokens} in / ${outputTokens} out. Month total: ${this.monthlyTokens}`,
    );

    const block = response.content?.[0];
    if (block?.type !== 'text') {
      this.logger.warn(`[INTENT] Claude returned no text block — content=${JSON.stringify(response.content).slice(0, 200)}`);
      return '{}';
    }

    const rawText = block.text.trim();
    this.logger.debug(`[INTENT] Claude raw (${rawText.length} chars): ${rawText.slice(0, 300)}`);
    // Prepend '{' — the prefill sends that character but it is excluded from response text.
    const text = rawText.startsWith('{') ? rawText : '{' + rawText;
    const end = text.lastIndexOf('}');
    if (end === -1) {
      this.logger.warn(`[INTENT] Claude response missing closing brace — raw="${rawText.slice(0, 200)}"`);
      return '{}';
    }
    return text.slice(0, end + 1);
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

    // Groq does not support embeddings — and if pgvector column doesn't exist, skip to SQL fallback.
    // Avoids wasting ~500ms on an OpenAI embedding call that will just throw.
    const isGroq = Boolean(process.env.GROQ_API_KEY);
    if (isGroq || !this.pgvectorEnabled) {
      return this.fetchMemoriesSqlFallback(profileId, input.limit);
    }

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
      return this.fetchMemoriesSqlFallback(profileId, input.limit);
    }
  }

  private async fetchMemoriesSqlFallback(profileId: string, limitRaw: number): Promise<string> {
    if (!this.pool) return '';
    try {
      const limit = Math.max(1, Math.min(5, Math.floor(limitRaw || 5)));
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

      // Last 3 conversation turns for session continuity
      let turnLines: string[] = [];
      try {
        const turnRes = await this.pool.query(
          `SELECT value FROM memories
           WHERE user_id = $1 AND key LIKE 'turn_%'
           ORDER BY created_at DESC LIMIT 3`,
          [profileId],
        );
        turnLines = (turnRes.rows || [])
          .reverse()
          .map((r: any) => {
            const v = r?.value;
            if (!v) return null;
            const u = typeof v.user === 'string' ? v.user : '';
            const a = typeof v.assistant === 'string' ? v.assistant : '';
            if (!u && !a) return null;
            return `[prev] user: ${u.slice(0, 200)} | leeloo: ${a.slice(0, 300)}`;
          })
          .filter(Boolean) as string[];
      } catch { /* turns table may not have rows yet */ }

      return [...turnLines, ...memLines, ...contactLines].join('\n');
    } catch {
      return '';
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

    const cached = this.profileIdCache.get(id);
    if (cached) return cached;

    try {
      const res = await this.pool.query(
        'SELECT id FROM profiles WHERE clerk_user_id = $1 LIMIT 1',
        [id],
      );
      const profileId = res.rows?.[0]?.id ? String(res.rows[0].id) : null;
      if (profileId) this.profileIdCache.set(id, profileId);
      return profileId;
    } catch {
      return null;
    }
  }
}
