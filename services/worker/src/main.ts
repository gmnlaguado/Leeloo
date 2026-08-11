import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Production env preflight for the worker.
 *
 * Notes:
 *   - The worker runs on Render as `type: worker` — NO HTTP port is exposed.
 *     We use `createApplicationContext` instead of `app.listen()`.
 *   - JWT_SECRET removed: not used anywhere (auth is Clerk JWKS asymmetric).
 *   - SUPABASE_SERVICE_ROLE_KEY is the canonical Supabase env name.
 *   - ENCRYPTION_KEY must match the API's (so the worker can decrypt OAuth
 *     tokens) and must be 64 hex chars / 32 bytes.
 */
function failFastEnv() {
  const must = (name: string) => String(process.env[name] || '').trim();
  const assertOk = (name: string, opts?: { minLen?: number; notEquals?: string[] }) => {
    const v = must(name);
    if (!v) throw new Error(`${name} is required`);
    if (opts?.minLen && v.length < opts.minLen)
      throw new Error(`${name} must be at least ${opts.minLen} chars`);
    for (const bad of opts?.notEquals || []) {
      if (v === bad) throw new Error(`${name} is using a placeholder value`);
    }
  };

  assertOk('SUPABASE_URL', { notEquals: ['https://your-project.supabase.co'] });
  assertOk('SUPABASE_SERVICE_ROLE_KEY', { notEquals: ['your-service-key'] });
  assertOk('REDIS_URL', { notEquals: ['redis://localhost:6379'] });
  assertOk('ENCRYPTION_KEY', { minLen: 64, notEquals: ['your-encryption-key-32-chars-min'] });
  if (!/^[0-9a-fA-F]{64}$/.test(must('ENCRYPTION_KEY'))) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  }
}

async function bootstrap() {
  failFastEnv();

  // Headless context — no HTTP server. Render `type: worker` does not expose
  // a port; calling `app.listen()` here was a deploy footgun.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableShutdownHooks();
  await app.init();

  console.log('🟣 Leeloo Worker running — listening for BullMQ jobs');

  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, draining and exiting…`);
    try {
      await app.close();
    } catch (e) {
      console.warn(`[worker] error during shutdown: ${String(e)}`);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((e) => {
  console.error('[worker] fatal bootstrap error:', e);
  process.exit(1);
});
