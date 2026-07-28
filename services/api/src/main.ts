import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Production env preflight.
 *
 * Notes:
 *   - JWT_SECRET removed: auth uses Clerk JWKS (asymmetric), no shared secret.
 *   - SUPABASE_SERVICE_ROLE_KEY is the canonical Supabase env name.
 *   - DEV_BYPASS_AUTH is explicitly refused in production.
 *   - ENCRYPTION_KEY must be 64 hex chars (32 bytes) for AES-256-GCM.
 */
function preflight() {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (process.env.DEV_BYPASS_AUTH === 'true' && isProd) {
    throw new Error('DEV_BYPASS_AUTH=true is refused in production. Remove it from the env.');
  }
  if (process.env.DEV_AUTH_TOKEN && isProd) {
    throw new Error('DEV_AUTH_TOKEN is refused in production. Use Clerk JWT auth only.');
  }

  if (!isProd) return;

  const must = (name: string) => String(process.env[name] || '').trim();
  const assertOk = (name: string, opts?: { minLen?: number; notEquals?: string[] }) => {
    const v = must(name);
    if (!v) throw new Error(`${name} is required in production`);
    if (opts?.minLen && v.length < opts.minLen)
      throw new Error(`${name} must be at least ${opts.minLen} chars in production`);
    for (const bad of opts?.notEquals || []) {
      if (v === bad) throw new Error(`${name} is using a placeholder value in production`);
    }
  };

  assertOk('ENCRYPTION_KEY', { minLen: 64, notEquals: ['your-encryption-key-32-chars-min'] });
  if (!/^[0-9a-fA-F]{64}$/.test(must('ENCRYPTION_KEY'))) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters in production');
  }

  assertOk('SUPABASE_URL', { notEquals: ['https://your-project.supabase.co'] });
  assertOk('SUPABASE_ANON_KEY', { notEquals: ['your-anon-key'] });
  assertOk('SUPABASE_SERVICE_ROLE_KEY', { notEquals: ['your-service-key'] });
  assertOk('DATABASE_URL');
  assertOk('CLERK_JWKS_URL');
  assertOk('ALLOWED_ORIGINS');
}

/**
 * Strict CORS allowlist driven by ALLOWED_ORIGINS (comma-separated).
 * - Requests without an Origin header (native mobile, server-to-server) pass.
 * - Browser requests must come from a configured origin or are rejected.
 */
function buildCorsOptions() {
  const raw = String(process.env.ALLOWED_ORIGINS || '').trim();
  const allowed = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .filter((o) => {
      try {
        // Reject malformed origins early so misconfig surfaces in logs.
        new URL(o);
        return true;
      } catch {
        console.warn(`[CORS] ignoring invalid origin: "${o}"`);
        return false;
      }
    });

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, ok?: boolean) => void) => {
      if (!origin) return callback(null, true); // mobile / curl / server-to-server
      if (allowed.length === 0) {
        // Production preflight requires ALLOWED_ORIGINS to be set, so this only
        // happens in local dev — be permissive but log it.
        console.warn(`[CORS] no ALLOWED_ORIGINS configured; allowing origin "${origin}"`);
        return callback(null, true);
      }
      if (allowed.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86400,
  };
}

async function bootstrap() {
  preflight();

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('v1');
  app.enableCors(buildCorsOptions());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Leeloo API')
    .setDescription('AI Assistant for Working Women — REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('voice', 'Voice processing endpoints')
    .addTag('tasks', 'Task management')
    .addTag('calendar', 'Calendar integration')
    .addTag('integrations', 'Third-party integrations')
    .addTag('memories', 'Contextual memory')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT || process.env.API_PORT || 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`🟣 Leeloo API running on port: ${port}`);
  console.log(`📚 API Docs: http://<your-ip>:${port}/api/docs`);
}

// Export for testability of `buildCorsOptions` and `preflight` if needed.
export { buildCorsOptions, preflight, bootstrap };

// Only auto-start when invoked as the entry point (skip when imported by tests).
if (require.main === module) {
  bootstrap();
}
