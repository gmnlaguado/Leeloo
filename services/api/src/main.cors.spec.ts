import { buildCorsOptions } from './main';

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe('main.buildCorsOptions()', () => {
  it('allows origins in ALLOWED_ORIGINS', () => {
    withEnv({ ALLOWED_ORIGINS: 'https://app.leeloo.ai,https://admin.leeloo.ai' }, () => {
      const opts = buildCorsOptions();
      const origin = opts.origin as (
        o: string | undefined,
        cb: (err: Error | null, ok?: boolean) => void,
      ) => void;
      const cb = jest.fn();
      origin('https://app.leeloo.ai', cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });

  it('rejects origins not in ALLOWED_ORIGINS', () => {
    withEnv({ ALLOWED_ORIGINS: 'https://app.leeloo.ai' }, () => {
      const opts = buildCorsOptions();
      const origin = opts.origin as (
        o: string | undefined,
        cb: (err: Error | null, ok?: boolean) => void,
      ) => void;
      const cb = jest.fn();
      origin('https://evil.example', cb);
      const call = cb.mock.calls[0];
      expect(call[0]).toBeInstanceOf(Error);
      expect(String(call[0])).toMatch(/origin .* not allowed/);
    });
  });

  it('allows requests without an Origin header (native mobile, curl)', () => {
    withEnv({ ALLOWED_ORIGINS: 'https://app.leeloo.ai' }, () => {
      const opts = buildCorsOptions();
      const origin = opts.origin as (
        o: string | undefined,
        cb: (err: Error | null, ok?: boolean) => void,
      ) => void;
      const cb = jest.fn();
      origin(undefined, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });

  it('exposes x-request-id and caches preflight 24h', () => {
    withEnv({ ALLOWED_ORIGINS: 'https://app.leeloo.ai' }, () => {
      const opts = buildCorsOptions();
      expect(opts.exposedHeaders).toContain('x-request-id');
      expect(opts.maxAge).toBe(86400);
      expect(opts.credentials).toBe(true);
    });
  });

  it('drops invalid origins from the allowlist (logged, not fatal)', () => {
    withEnv({ ALLOWED_ORIGINS: 'https://app.leeloo.ai,not-a-url,https://x' }, () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const opts = buildCorsOptions();
      const origin = opts.origin as (
        o: string | undefined,
        cb: (err: Error | null, ok?: boolean) => void,
      ) => void;

      const goodCb = jest.fn();
      origin('https://app.leeloo.ai', goodCb);
      expect(goodCb).toHaveBeenCalledWith(null, true);

      const badCb = jest.fn();
      origin('not-a-url', badCb);
      expect(badCb.mock.calls[0][0]).toBeInstanceOf(Error);

      spy.mockRestore();
    });
  });
});
