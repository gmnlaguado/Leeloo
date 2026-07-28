import { preflight } from '../main';

const setEnv = (env: Record<string, string | undefined>) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
};

describe('main.preflight()', () => {
  it('refuses DEV_BYPASS_AUTH=true in production', () => {
    const restore = setEnv({ NODE_ENV: 'production', DEV_BYPASS_AUTH: 'true' });
    try {
      expect(() => preflight()).toThrow(/DEV_BYPASS_AUTH.*production/);
    } finally {
      restore();
    }
  });

  it('refuses DEV_AUTH_TOKEN in production', () => {
    const restore = setEnv({ NODE_ENV: 'production', DEV_AUTH_TOKEN: 'anything' });
    try {
      expect(() => preflight()).toThrow(/DEV_AUTH_TOKEN.*production/);
    } finally {
      restore();
    }
  });

  it('refuses non-hex ENCRYPTION_KEY in production', () => {
    const restore = setEnv({
      NODE_ENV: 'production',
      DEV_BYPASS_AUTH: undefined,
      DEV_AUTH_TOKEN: undefined,
      ENCRYPTION_KEY: 'z'.repeat(64),
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_ROLE_KEY: 's',
      DATABASE_URL: 'postgres://x',
      CLERK_JWKS_URL: 'https://x/jwks',
      ALLOWED_ORIGINS: 'https://app.example',
    });
    try {
      expect(() => preflight()).toThrow(/ENCRYPTION_KEY must be 64 hex/);
    } finally {
      restore();
    }
  });

  it('passes when all production envs are present and valid', () => {
    const restore = setEnv({
      NODE_ENV: 'production',
      DEV_BYPASS_AUTH: undefined,
      DEV_AUTH_TOKEN: undefined,
      ENCRYPTION_KEY: 'a'.repeat(64),
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'role',
      DATABASE_URL: 'postgres://x',
      CLERK_JWKS_URL: 'https://x/jwks',
      ALLOWED_ORIGINS: 'https://app.example',
    });
    try {
      expect(() => preflight()).not.toThrow();
    } finally {
      restore();
    }
  });

  it('does not enforce production envs outside production', () => {
    const restore = setEnv({ NODE_ENV: 'development' });
    try {
      expect(() => preflight()).not.toThrow();
    } finally {
      restore();
    }
  });
});
