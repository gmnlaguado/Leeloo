import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';

type OpenAiJobPayload =
  | { userId: string; name: 'transcribe'; filename: string; bytesBase64: string }
  | {
      userId: string;
      name: 'intent';
      language: string;
      transcription: string;
      memoryContext: string;
      systemPrompt: string;
      systemPromptVersion: string;
    }
  | { userId: string; name: 'tts'; text: string; model: string; voice: string }
  | { userId: string; name: 'memory'; query: string; limit: number };

@Injectable()
export class OpenAiQueue implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue;
  private events!: QueueEvents;
  private worker!: Worker;
  private redis!: IORedis;
  private pool: Pool | null = null;
  private openai!: OpenAI;

  private static readonly OPENAI_CALLS_PER_HOUR = 100;

  async onModuleInit() {
    const redisUrl = String(process.env.REDIS_URL || '').trim();
    this.redis = new IORedis(redisUrl);

    this.queue = new Queue('openai', {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });

    this.events = new QueueEvents('openai', { connection: this.redis });

    const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
    this.openai = new OpenAI({ apiKey: openaiKey });

    const dbUrl =
      String(process.env.SUPABASE_DB_URL || '').trim() ||
      String(process.env.DATABASE_URL || '').trim();
    if (dbUrl) {
      this.pool = new Pool({ connectionString: dbUrl });
    }

    this.worker = new Worker(
      'openai',
      async (job) => {
        const data = job.data as OpenAiJobPayload;
        if (data.name === 'transcribe') {
          const bytes = Buffer.from(data.bytesBase64, 'base64');
          const file = await toFile(bytes, data.filename, { type: 'application/octet-stream' });
          const res = await this.openai.audio.transcriptions.create({
            file,
            model: 'whisper-1',
          });
          return String((res as any)?.text || '');
        }

        if (data.name === 'tts') {
          const res = await this.openai.audio.speech.create({
            model: data.model,
            voice: data.voice,
            input: data.text,
          });
          const buf = Buffer.from(await res.arrayBuffer());
          return buf.toString('base64');
        }

        if (data.name === 'intent') {
          const content = this.buildIntentPrompt(data);
          const completion = await this.openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            temperature: 0.2,
            messages: [
              { role: 'system', content: data.systemPrompt },
              { role: 'user', content },
            ],
            response_format: { type: 'json_object' },
          });
          const raw = completion.choices?.[0]?.message?.content || '{}';
          return raw;
        }

        if (data.name === 'memory') {
          return this.fetchMemoriesPgvector({
            userId: data.userId,
            query: data.query,
            limit: data.limit,
          });
        }

        return null;
      },
      {
        connection: this.redis,
      },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.events?.close();
    await this.queue?.close();
    await this.redis?.quit();
    await this.pool?.end();
  }

  async transcribe(input: { userId: string; filename: string; bytes: Buffer }) {
    await this.assertWithinOpenAiRateLimit(input.userId);
    const job = await this.queue.add('transcribe', {
      userId: input.userId,
      name: 'transcribe',
      filename: input.filename,
      bytesBase64: input.bytes.toString('base64'),
    });
    try {
      return (await job.waitUntilFinished(this.events)) as string;
    } catch (err: any) {
      this.throwOnOpenAiBackpressure(err);
      throw err;
    }
  }

  async tts(input: { userId: string; text: string; model: string; voice: string }) {
    await this.assertWithinOpenAiRateLimit(input.userId);
    const job = await this.queue.add('tts', {
      userId: input.userId,
      name: 'tts',
      text: input.text,
      model: input.model,
      voice: input.voice,
    });
    try {
      return (await job.waitUntilFinished(this.events)) as string;
    } catch (err: any) {
      this.throwOnOpenAiBackpressure(err);
      throw err;
    }
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
      await this.assertWithinOpenAiRateLimit(input.userId);
      const job = await this.queue.add('intent', {
        userId: input.userId,
        name: 'intent',
        language: input.language,
        transcription: input.transcription,
        memoryContext: input.memoryContext,
        systemPrompt: input.systemPrompt,
        systemPromptVersion: input.systemPromptVersion,
      });

      const raw = (await job.waitUntilFinished(this.events)) as string;
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
      this.throwOnOpenAiBackpressure(err);
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

  async fetchMemoryContext(input: { userId: string; query: string; limit: number }) {
    const job = await this.queue.add('memory', {
      userId: input.userId,
      name: 'memory',
      query: input.query,
      limit: input.limit,
    });
    return (await job.waitUntilFinished(this.events)) as string;
  }

  private throwOnOpenAiBackpressure(err: any) {
    const status = Number(err?.status || err?.response?.status || 0);
    if (status === 429 || status >= 500) {
      const e: any = new Error('OpenAI backpressure');
      e.status = status || 503;
      throw e;
    }
  }

  private async assertWithinOpenAiRateLimit(userId: string) {
    const id = String(userId || '').trim();
    if (!id) return;

    const now = new Date();
    const bucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
      now.getUTCDate(),
    ).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}`;
    const key = `openai:rl:${id}:${bucket}`;

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.pexpire(key, 60 * 60 * 1000);
    }

    if (count > OpenAiQueue.OPENAI_CALLS_PER_HOUR) {
      const e: any = new Error('OpenAI rate limit exceeded');
      e.status = 429;
      throw e;
    }
  }

  private fallbackText(language: string) {
    return String(language || '')
      .toLowerCase()
      .startsWith('es')
      ? 'Ahora mismo estoy teniendo problemas para responder, pero te escuché. ¿Puedes repetirlo en una frase corta?'
      : 'I’m having trouble right now, but I heard you. Can you repeat that in one short sentence?';
  }

  private buildIntentPrompt(data: Extract<OpenAiJobPayload, { name: 'intent' }>) {
    const memory = data.memoryContext ? `MEMORY CONTEXT:\n${data.memoryContext}\n\n` : '';
    return `${memory}LANGUAGE_HINT: ${data.language}\nSYSTEM_PROMPT_VERSION: ${data.systemPromptVersion}\n\nUSER_SAID:\n${data.transcription}`;
  }

  private async fetchMemoriesPgvector(input: { userId: string; query: string; limit: number }) {
    // Best-effort.
    // If you have pgvector enabled, define:
    // - a "memories" table with columns (user_id uuid, key text, category text, value jsonb, embedding vector)
    // - and an embedding vector for each row
    // Also set SUPABASE_DB_URL or DATABASE_URL.
    if (!this.pool) return '';

    const profileId = await this.resolveProfileId(input.userId);
    if (!profileId) return '';

    try {
      const q = String(input.query || '').trim();
      if (!q) return '';

      // Compute query embedding (counts as an OpenAI call).
      await this.assertWithinOpenAiRateLimit(input.userId);
      const emb = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: q,
      });
      const vec = emb.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) return '';

      // Best-effort pgvector query.
      // Requires a column named "embedding" with type vector.
      // If not present, this will throw and we'll fallback.
      const vecLiteral = `[${vec.join(',')}]`;
      const limit = Math.max(1, Math.min(10, Math.floor(input.limit || 10)));
      const res = await this.pool.query(
        `SELECT category, key, value
         FROM memories
         WHERE user_id = $1
           AND key NOT LIKE 'turn_%'
         ORDER BY embedding <-> $2::vector
         LIMIT $3`,
        [profileId, vecLiteral, limit],
      );

      const rows = res.rows || [];
      return rows
        .map((r: any) => {
          const cat = String(r?.category || '').trim();
          const k = String(r?.key || '').trim();
          const v = r?.value;
          const line = `${cat}${k ? `:${k}` : ''}`;
          return `${line} = ${JSON.stringify(v)}`;
        })
        .join('\n');
    } catch {
      // Fallback to recency.
      try {
        const limit = Math.max(1, Math.min(10, Math.floor(input.limit || 10)));
        const res = await this.pool.query(
          `SELECT category, key, value
           FROM memories
           WHERE user_id = $1
             AND key NOT LIKE 'turn_%'
           ORDER BY last_used DESC
           LIMIT $2`,
          [profileId, limit],
        );
        const rows = res.rows || [];
        return rows
          .map((r: any) => {
            const cat = String(r?.category || '').trim();
            const k = String(r?.key || '').trim();
            const v = r?.value;
            const line = `${cat}${k ? `:${k}` : ''}`;
            return `${line} = ${JSON.stringify(v)}`;
          })
          .join('\n');
      } catch {
        return '';
      }
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
