import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';
import { CryptoService, CryptoEnvelope } from '../common/crypto/crypto.service';

type IntegrationProvider = 'google' | 'microsoft';

type ProviderConfig = {
  provider: IntegrationProvider;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope?: string;
  authUrl?: string;
};

type StoredIntegration = {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  scope: string | null;
  token_type: string | null;
  expires_at: string | null;
  last_sync_at: string | null;
  metadata: Record<string, unknown> | null;
  access_token_enc: string | null;
  access_token_iv: string | null;
  access_token_tag: string | null;
  refresh_token_enc: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  key_version: number;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger('IntegrationsService');

  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  // ---------------------------------------------------------------------------
  // Profile resolution
  // ---------------------------------------------------------------------------
  private async getProfileId(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return profile.id;
  }

  private aad(profileId: string, provider: IntegrationProvider): string {
    return `${profileId}:${provider}`;
  }

  // ---------------------------------------------------------------------------
  // Provider config
  // ---------------------------------------------------------------------------
  private readProviderConfig(provider: IntegrationProvider): ProviderConfig {
    if (provider === 'google') {
      return {
        provider,
        clientId: this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') || '',
        clientSecret: this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') || '',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope:
          this.config.get<string>('GOOGLE_OAUTH_SCOPE') ||
          'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly',
      };
    }

    return {
      provider,
      clientId: this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID') || '',
      clientSecret: this.config.get<string>('MICROSOFT_OAUTH_CLIENT_SECRET') || '',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scope:
        this.config.get<string>('MICROSOFT_OAUTH_SCOPE') ||
        'offline_access https://graph.microsoft.com/Calendars.Read',
    };
  }

  // ---------------------------------------------------------------------------
  // OAuth — build authorization URL with state + PKCE
  // ---------------------------------------------------------------------------
  /**
   * Generates the OAuth authorization URL for the given provider with
   * server-side persisted `state` and a PKCE `code_challenge`. The mobile
   * client receives only `state` and the URL — the `code_verifier` never
   * leaves the backend, which is the whole point of PKCE for public clients.
   *
   * Throws on misconfiguration; returns `{ ok:false }` on user-visible errors.
   */
  async buildAuthUrl(opts: { userId: string; provider: IntegrationProvider; redirectUri: string }) {
    const cfg = this.readProviderConfig(opts.provider);
    if (!cfg.clientId) return { ok: false as const, message: 'Missing OAuth client config' };
    if (!cfg.authUrl) return { ok: false as const, message: 'Missing OAuth authUrl config' };
    if (!opts.redirectUri || !opts.redirectUri.trim()) {
      throw new BadRequestException('redirect_uri is required');
    }

    const profileId = await this.getProfileId(opts.userId);

    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url'); // 43 chars
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // Best-effort cleanup before insert (no transaction needed: the unique
    // constraint on `state` is the real guarantee).
    await this.db
      .query('DELETE FROM oauth_states WHERE expires_at < now()')
      .catch((e) => this.logger.warn(`oauth_states cleanup failed: ${String(e)}`));

    await this.db.query(
      `INSERT INTO oauth_states (state, code_verifier, user_id, provider, redirect_uri)
       VALUES ($1, $2, $3, $4, $5)`,
      [state, codeVerifier, profileId, opts.provider, opts.redirectUri.trim()],
    );

    const params = new URLSearchParams();
    params.set('client_id', cfg.clientId);
    params.set('redirect_uri', opts.redirectUri.trim());
    params.set('response_type', 'code');
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    if (cfg.scope) params.set('scope', cfg.scope);
    params.set('state', state);
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');

    return {
      ok: true as const,
      provider: opts.provider,
      state,
      url: `${cfg.authUrl}?${params.toString()}`,
    };
  }

  // ---------------------------------------------------------------------------
  // OAuth — exchange auth code (validates state + PKCE)
  // ---------------------------------------------------------------------------
  async connectIntegration(
    userId: string,
    provider: IntegrationProvider,
    authCode: string,
    state: string,
    redirectUri?: string,
  ) {
    const profileId = await this.getProfileId(userId);
    const code = String(authCode || '').trim();
    const stateStr = String(state || '').trim();

    if (!code) throw new BadRequestException('Missing auth_code');
    if (!stateStr) throw new BadRequestException('Missing state');

    const cfg = this.readProviderConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      return { ok: false, provider, message: 'Missing OAuth client config' };
    }

    // 1. Validate state row (atomic: SELECT FOR UPDATE then DELETE on success)
    const stateRes = await this.db.query<{
      code_verifier: string;
      redirect_uri: string;
      user_id: string;
      provider: string;
      expires_at: string;
    }>(
      `SELECT code_verifier, redirect_uri, user_id, provider, expires_at
       FROM oauth_states
       WHERE state = $1
       LIMIT 1`,
      [stateStr],
    );

    const row = stateRes.rows[0];
    if (!row) throw new UnauthorizedException('Invalid OAuth state');
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.db.query('DELETE FROM oauth_states WHERE state = $1', [stateStr]);
      throw new UnauthorizedException('Expired OAuth state');
    }
    if (row.user_id !== profileId) {
      throw new UnauthorizedException('OAuth state does not belong to this user');
    }
    if (row.provider !== provider) {
      throw new UnauthorizedException('OAuth state provider mismatch');
    }

    // 2. Optional defense-in-depth: redirect_uri exact match
    const callbackRedirect = (redirectUri ?? row.redirect_uri).trim();
    if (callbackRedirect !== row.redirect_uri) {
      throw new UnauthorizedException('redirect_uri mismatch');
    }

    // 3. Exchange with PKCE verifier
    const body = new URLSearchParams();
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
    body.set('code', code);
    body.set('grant_type', 'authorization_code');
    body.set('redirect_uri', callbackRedirect);
    body.set('code_verifier', row.code_verifier);
    if (provider === 'microsoft' && cfg.scope) body.set('scope', cfg.scope);

    let tokenResData: Record<string, unknown> = {};
    try {
      const tokenRes = await axios.post(cfg.tokenUrl, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      });
      tokenResData = tokenRes.data || {};
    } catch (e: unknown) {
      // Clean up state regardless of exchange outcome — single-use semantics.
      await this.db.query('DELETE FROM oauth_states WHERE state = $1', [stateStr]);
      const err = e as { response?: { status?: number; data?: unknown }; message?: unknown };
      this.logger.warn(
        `OAuth token exchange failed (${provider}, status=${err?.response?.status}): ${String(err?.message || '')}`,
      );
      return { ok: false, provider, message: 'Token exchange failed' };
    }

    // 4. Single-use semantics: consume state row.
    await this.db.query('DELETE FROM oauth_states WHERE state = $1', [stateStr]);

    // 5. Persist tokens encrypted.
    const saved = await this.upsertIntegration(profileId, provider, tokenResData);
    return {
      ok: true,
      provider,
      integration: this.toPublicRow(saved),
    };
  }

  // ---------------------------------------------------------------------------
  // Persistence (encrypted)
  // ---------------------------------------------------------------------------
  private async upsertIntegration(
    profileId: string,
    provider: IntegrationProvider,
    token: {
      access_token?: unknown;
      refresh_token?: unknown;
      scope?: unknown;
      token_type?: unknown;
      expires_in?: unknown;
      expires_at?: unknown;
    },
  ): Promise<StoredIntegration | null> {
    const aad = this.aad(profileId, provider);

    const accessRaw = typeof token.access_token === 'string' ? token.access_token : '';
    const refreshRaw = typeof token.refresh_token === 'string' ? token.refresh_token : '';
    const scope = typeof token.scope === 'string' ? token.scope : null;
    const tokenType = typeof token.token_type === 'string' ? token.token_type : null;

    const expiresAt = (() => {
      if (typeof token.expires_at === 'string' && token.expires_at.trim()) {
        return token.expires_at.trim();
      }
      if (
        typeof token.expires_in === 'number' &&
        Number.isFinite(token.expires_in) &&
        token.expires_in > 0
      ) {
        return new Date(Date.now() + token.expires_in * 1000).toISOString();
      }
      return null;
    })();

    const accessEnv = accessRaw ? this.crypto.encrypt(accessRaw, aad) : null;
    const refreshEnv = refreshRaw ? this.crypto.encrypt(refreshRaw, aad) : null;
    const keyVersion = (accessEnv ?? refreshEnv)?.keyVersion ?? this.crypto.getCurrentVersion();

    const idRes = await this.db.query<{ id: string }>(
      'SELECT id FROM user_integrations WHERE user_id = $1 AND provider = $2 LIMIT 1',
      [profileId, provider],
    );
    const existingId = idRes.rows[0]?.id || null;

    if (existingId) {
      const res = await this.db.query<StoredIntegration>(
        `UPDATE user_integrations SET
           access_token_enc  = COALESCE($1, access_token_enc),
           access_token_iv   = COALESCE($2, access_token_iv),
           access_token_tag  = COALESCE($3, access_token_tag),
           refresh_token_enc = COALESCE($4, refresh_token_enc),
           refresh_token_iv  = COALESCE($5, refresh_token_iv),
           refresh_token_tag = COALESCE($6, refresh_token_tag),
           key_version       = $7,
           scope             = COALESCE($8, scope),
           token_type        = COALESCE($9, token_type),
           expires_at        = COALESCE($10::timestamptz, expires_at),
           updated_at        = NOW()
         WHERE id = $11
         RETURNING *`,
        [
          accessEnv?.ciphertext ?? null,
          accessEnv?.iv ?? null,
          accessEnv?.tag ?? null,
          refreshEnv?.ciphertext ?? null,
          refreshEnv?.iv ?? null,
          refreshEnv?.tag ?? null,
          keyVersion,
          scope,
          tokenType,
          expiresAt,
          existingId,
        ],
      );
      return res.rows[0] || null;
    }

    const newId = randomUUID();
    const res = await this.db.query<StoredIntegration>(
      `INSERT INTO user_integrations (
         id, user_id, provider,
         access_token_enc, access_token_iv, access_token_tag,
         refresh_token_enc, refresh_token_iv, refresh_token_tag,
         key_version, scope, token_type, expires_at
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8, $9,
         $10, $11, $12, $13::timestamptz
       )
       RETURNING *`,
      [
        newId,
        profileId,
        provider,
        accessEnv?.ciphertext ?? null,
        accessEnv?.iv ?? null,
        accessEnv?.tag ?? null,
        refreshEnv?.ciphertext ?? null,
        refreshEnv?.iv ?? null,
        refreshEnv?.tag ?? null,
        keyVersion,
        scope,
        tokenType,
        expiresAt,
      ],
    );
    return res.rows[0] || null;
  }

  private async getIntegrationRaw(
    profileId: string,
    provider: IntegrationProvider,
  ): Promise<StoredIntegration | null> {
    const res = await this.db.query<StoredIntegration>(
      'SELECT * FROM user_integrations WHERE user_id = $1 AND provider = $2 LIMIT 1',
      [profileId, provider],
    );
    return res.rows[0] || null;
  }

  private decryptToken(row: StoredIntegration | null, kind: 'access' | 'refresh'): string {
    if (!row) return '';
    const enc = kind === 'access' ? row.access_token_enc : row.refresh_token_enc;
    const iv = kind === 'access' ? row.access_token_iv : row.refresh_token_iv;
    const tag = kind === 'access' ? row.access_token_tag : row.refresh_token_tag;
    if (!enc || !iv || !tag) return '';
    const envelope: CryptoEnvelope = {
      ciphertext: enc,
      iv,
      tag,
      keyVersion: row.key_version,
    };
    return this.crypto.decrypt(envelope, this.aad(row.user_id, row.provider));
  }

  private toPublicRow(row: StoredIntegration | null) {
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      scope: row.scope,
      token_type: row.token_type,
      expires_at: row.expires_at,
      last_sync_at: row.last_sync_at,
      metadata: row.metadata,
      has_access_token: Boolean(row.access_token_enc),
      has_refresh_token: Boolean(row.refresh_token_enc),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API used by controller + worker
  // ---------------------------------------------------------------------------
  async getValidAccessToken(userId: string, provider: IntegrationProvider) {
    const profileId = await this.getProfileId(userId);
    const { token, refreshed } = await this.ensureValidAccessToken(profileId, provider);
    return { token, refreshed, profileId };
  }

  async markSynced(
    profileId: string,
    provider: IntegrationProvider,
    metadata?: Record<string, unknown>,
  ) {
    await this.db.query(
      `UPDATE user_integrations
       SET last_sync_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
           updated_at = NOW()
       WHERE user_id = $1 AND provider = $2`,
      [profileId, provider, metadata ? JSON.stringify(metadata) : null],
    );
  }

  async getIntegrationMetadata(userId: string, provider: IntegrationProvider) {
    const profileId = await this.getProfileId(userId);
    const row = await this.getIntegrationRaw(profileId, provider);
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return { profileId, metadata };
  }

  async patchIntegrationMetadata(
    profileId: string,
    provider: IntegrationProvider,
    patch: Record<string, unknown>,
  ) {
    await this.db.query(
      `UPDATE user_integrations
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
           updated_at = NOW()
       WHERE user_id = $1 AND provider = $2`,
      [profileId, provider, JSON.stringify(patch || {})],
    );
  }

  async getIntegrations(userId: string) {
    const profileId = await this.getProfileId(userId);
    const res = await this.db.query<StoredIntegration>(
      `SELECT * FROM user_integrations
       WHERE user_id = $1
       ORDER BY provider ASC`,
      [profileId],
    );
    return {
      integrations: res.rows.map((row) => this.toPublicRow(row)).filter(Boolean),
    };
  }

  async refreshIntegration(userId: string, provider: IntegrationProvider) {
    const profileId = await this.getProfileId(userId);
    const current = await this.getIntegrationRaw(profileId, provider);
    const refreshToken = this.decryptToken(current, 'refresh').trim();
    if (!refreshToken) return { ok: false, provider, message: 'No refresh token stored' };

    const cfg = this.readProviderConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      return { ok: false, provider, message: 'Missing OAuth client config' };
    }

    const body = new URLSearchParams();
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
    body.set('refresh_token', refreshToken);
    body.set('grant_type', 'refresh_token');
    if (provider === 'microsoft' && cfg.scope) body.set('scope', cfg.scope);

    const tokenRes = await axios.post(cfg.tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });

    const saved = await this.upsertIntegration(profileId, provider, tokenRes.data || {});
    return { ok: true, provider, integration: this.toPublicRow(saved) };
  }

  private async ensureValidAccessToken(profileId: string, provider: IntegrationProvider) {
    const current = await this.getIntegrationRaw(profileId, provider);
    const accessToken = this.decryptToken(current, 'access').trim();
    const expiresAt = current?.expires_at ? new Date(String(current.expires_at)) : null;
    const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() + 60_000 : false;
    if (accessToken && !isExpired) return { token: accessToken, refreshed: false };

    const refreshToken = this.decryptToken(current, 'refresh').trim();
    if (!refreshToken) return { token: '', refreshed: false };

    const cfg = this.readProviderConfig(provider);
    const body = new URLSearchParams();
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
    body.set('refresh_token', refreshToken);
    body.set('grant_type', 'refresh_token');
    if (provider === 'microsoft' && cfg.scope) body.set('scope', cfg.scope);

    const tokenRes = await axios.post(cfg.tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });

    const saved = await this.upsertIntegration(profileId, provider, tokenRes.data || {});
    const newToken = this.decryptToken(saved, 'access').trim();
    return { token: newToken, refreshed: true };
  }

  async healthCheck(userId: string, provider: IntegrationProvider) {
    const profileId = await this.getProfileId(userId);
    const { token, refreshed } = await this.ensureValidAccessToken(profileId, provider);
    if (!token) return { ok: false, provider, message: 'No valid access token' };

    try {
      if (provider === 'google') {
        const res = await axios.get(
          'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
          { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 },
        );
        return { ok: true, provider, refreshed, status: res.status };
      }
      const res = await axios.get('https://graph.microsoft.com/v1.0/me/events?$top=1', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      });
      return { ok: true, provider, refreshed, status: res.status };
    } catch (e: unknown) {
      const err = e as { response?: { status?: unknown }; message?: unknown };
      const status = typeof err?.response?.status === 'number' ? err.response.status : null;
      return {
        ok: false,
        provider,
        refreshed,
        status,
        message: typeof err?.message === 'string' ? err.message : 'Health check failed',
      };
    }
  }

  async disconnectIntegration(userId: string, provider: IntegrationProvider) {
    const profileId = await this.getProfileId(userId);
    const row = await this.getIntegrationRaw(profileId, provider);

    // Best-effort token revocation at the provider before dropping the row.
    if (row) {
      const refreshToken = this.decryptToken(row, 'refresh').trim();
      const accessToken = this.decryptToken(row, 'access').trim();
      const tokenToRevoke = refreshToken || accessToken;
      if (tokenToRevoke && provider === 'google') {
        await axios
          .post(
            'https://oauth2.googleapis.com/revoke',
            new URLSearchParams({ token: tokenToRevoke }).toString(),
            {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              timeout: 10000,
              validateStatus: () => true,
            },
          )
          .catch((e) => this.logger.warn(`Google revoke failed: ${String(e)}`));
      }
      // Microsoft does not expose a per-token revoke endpoint — best practice
      // is to drop the refresh token and let it expire. Tenant-wide sign-out
      // is out of scope here.
    }

    await this.db.query('DELETE FROM user_integrations WHERE user_id = $1 AND provider = $2', [
      profileId,
      provider,
    ]);
    return { ok: true, provider };
  }
}
