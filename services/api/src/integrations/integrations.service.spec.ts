import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { IntegrationsService } from './integrations.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * Tests for the OAuth state + PKCE handshake and encrypted-token persistence.
 *
 * We do NOT spin up Postgres here. DatabaseService is replaced with a tiny
 * in-memory fake that captures inserted oauth_states and user_integrations
 * rows. This lets us assert the security invariants without touching IO.
 */

type Row = Record<string, unknown>;

class InMemoryDb {
  oauthStates: Row[] = [];
  userIntegrations: Row[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.startsWith('INSERT INTO oauth_states')) {
      const [state, code_verifier, user_id, provider, redirect_uri] = params;
      this.oauthStates.push({
        state,
        code_verifier,
        user_id,
        provider,
        redirect_uri,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      return { rows: [] as T[] };
    }

    if (text.startsWith('SELECT code_verifier, redirect_uri, user_id, provider, expires_at')) {
      const [state] = params;
      const row = this.oauthStates.find((r) => r.state === state) || null;
      return { rows: (row ? [row] : []) as T[] };
    }

    if (text.startsWith('DELETE FROM oauth_states WHERE state')) {
      const [state] = params;
      this.oauthStates = this.oauthStates.filter((r) => r.state !== state);
      return { rows: [] as T[] };
    }

    if (text.startsWith('DELETE FROM oauth_states WHERE expires_at')) {
      this.oauthStates = this.oauthStates.filter(
        (r) => new Date(String(r.expires_at)).getTime() > Date.now(),
      );
      return { rows: [] as T[] };
    }

    if (text.startsWith('SELECT id FROM user_integrations')) {
      const [user_id, provider] = params;
      const row = this.userIntegrations.find(
        (r) => r.user_id === user_id && r.provider === provider,
      );
      return { rows: (row ? [{ id: row.id }] : []) as T[] };
    }

    if (text.startsWith('INSERT INTO user_integrations')) {
      const [
        id,
        user_id,
        provider,
        access_token_enc,
        access_token_iv,
        access_token_tag,
        refresh_token_enc,
        refresh_token_iv,
        refresh_token_tag,
        key_version,
        scope,
        token_type,
        expires_at,
      ] = params;
      const row = {
        id,
        user_id,
        provider,
        access_token_enc,
        access_token_iv,
        access_token_tag,
        refresh_token_enc,
        refresh_token_iv,
        refresh_token_tag,
        key_version,
        scope,
        token_type,
        expires_at,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.userIntegrations.push(row);
      return { rows: [row] as T[] };
    }

    return { rows: [] as T[] };
  }
}

const fakeProfiles = () => ({
  ensureProfileByClerkUserId: jest.fn(async (clerkId: string) => ({
    id: `profile-of-${clerkId}`,
  })),
});

const hexKey = () => randomBytes(32).toString('hex');

const makeService = () => {
  const db = new InMemoryDb();
  const profiles = fakeProfiles();
  const config = {
    get: (k: string) => {
      const env: Record<string, string> = {
        ENCRYPTION_KEY: hexKey(),
        ENCRYPTION_KEY_VERSION: '1',
        GOOGLE_OAUTH_CLIENT_ID: 'gci',
        GOOGLE_OAUTH_CLIENT_SECRET: 'gcs',
      };
      return env[k];
    },
  } as unknown as ConfigService;
  const crypto = new CryptoService(config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new IntegrationsService(db as any, profiles as any, config, crypto);
  return { svc, db, profiles, crypto };
};

describe('IntegrationsService.buildAuthUrl', () => {
  it('persists state with TTL, PKCE verifier, and exact redirect_uri', async () => {
    const { svc, db } = makeService();
    const out = await svc.buildAuthUrl({
      userId: 'clerk-user-A',
      provider: 'google',
      redirectUri: 'https://app.leeloo.ai/oauth/callback',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.length).toBeGreaterThan(20);
    expect(out.url).toContain('code_challenge=');
    expect(out.url).toContain('code_challenge_method=S256');

    expect(db.oauthStates).toHaveLength(1);
    const row = db.oauthStates[0];
    expect(row.user_id).toBe('profile-of-clerk-user-A');
    expect(row.provider).toBe('google');
    expect(row.redirect_uri).toBe('https://app.leeloo.ai/oauth/callback');
    expect(String(row.code_verifier).length).toBeGreaterThan(40);
    // PKCE verifier MUST NOT leak into the URL.
    expect(out.url).not.toContain(String(row.code_verifier));
  });

  it('rejects empty redirect_uri', async () => {
    const { svc } = makeService();
    await expect(
      svc.buildAuthUrl({ userId: 'u', provider: 'google', redirectUri: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('IntegrationsService.connectIntegration', () => {
  const seedState = async () => {
    const { svc, db } = makeService();
    const out = await svc.buildAuthUrl({
      userId: 'clerk-user-A',
      provider: 'google',
      redirectUri: 'https://app.leeloo.ai/oauth/callback',
    });
    if (!out.ok) throw new Error('seed failed');
    return { svc, db, state: out.state };
  };

  it('throws UnauthorizedException on unknown state', async () => {
    const { svc } = await seedState();
    await expect(
      svc.connectIntegration('clerk-user-A', 'google', 'CODE', 'NOT-THE-STATE'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws BadRequestException on missing auth_code', async () => {
    const { svc, state } = await seedState();
    await expect(
      svc.connectIntegration('clerk-user-A', 'google', '', state),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws UnauthorizedException when state belongs to another user', async () => {
    const { svc, state } = await seedState();
    await expect(
      svc.connectIntegration('clerk-user-B', 'google', 'CODE', state),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException on expired state', async () => {
    const { svc, db, state } = await seedState();
    db.oauthStates[0].expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(
      svc.connectIntegration('clerk-user-A', 'google', 'CODE', state),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Expired row must be cleaned up so a replay never works.
    expect(db.oauthStates).toHaveLength(0);
  });

  it('throws UnauthorizedException on redirect_uri mismatch', async () => {
    const { svc, state } = await seedState();
    await expect(
      svc.connectIntegration(
        'clerk-user-A',
        'google',
        'CODE',
        state,
        'https://evil.example/callback',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
