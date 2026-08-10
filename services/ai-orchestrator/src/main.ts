import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function failFastEnv() {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  // Auth uses Clerk JWKS (asymmetric), no shared secret. Dev-only bypasses are
  // explicitly refused in production, matching services/api/src/main.ts.
  if (process.env.DEV_BYPASS_AUTH === 'true' && isProd) {
    throw new Error('DEV_BYPASS_AUTH=true is refused in production. Remove it from the env.');
  }
  if (process.env.DEV_AUTH_TOKEN && isProd) {
    throw new Error('DEV_AUTH_TOKEN is refused in production. Use Clerk JWT auth only.');
  }

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

  assertOk('OPENAI_API_KEY', { notEquals: ['sk-your-key-here'] });
  assertOk('ANTHROPIC_API_KEY', { notEquals: ['sk-ant-your-key-here'] });
  assertOk('SUPABASE_URL', { notEquals: ['https://your-project.supabase.co'] });
  assertOk('SUPABASE_SERVICE_KEY', { notEquals: ['your-service-key'] });
  assertOk('REDIS_URL', { notEquals: ['redis://localhost:6379'] });

  if (isProd) {
    assertOk('CLERK_JWKS_URL');
    assertOk('API_BASE_URL');
  }
}

async function bootstrap() {
  failFastEnv();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');

  const port = Number(process.env.PORT || process.env.AI_ORCHESTRATOR_PORT || 3002);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
