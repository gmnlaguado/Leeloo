import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class IntegrationsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private async ensureSchema() {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS user_integrations (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        provider text NOT NULL,
        access_token text NULL,
        refresh_token text NULL,
        scope text NULL,
        token_type text NULL,
        expires_at timestamptz NULL,
        last_sync_at timestamptz NULL,
        metadata jsonb NULL,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW(),
        UNIQUE (user_id, provider)
      )`,
    );

    await this.db.query('ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS last_sync_at timestamptz NULL');
    await this.db.query('ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS metadata jsonb NULL');

    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_user_integrations_user_provider ON user_integrations (user_id, provider)',
    );
  }

  private async getProfileId(clerkUserId: string): Promise<string> {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return profile.id;
  }

  private readProviderConfig(provider: 'google' | 'microsoft') {
    if (provider === 'google') {
      return {
        provider,
        clientId: this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') || '',
        clientSecret: this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') || '',
        tokenUrl: 'https://oauth2.googleapis.com/token',
      };
    }

    return {
      provider,
      clientId: this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID') || '',
      clientSecret: this.config.get<string>('MICROSOFT_OAUTH_CLIENT_SECRET') || '',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scope: this.config.get<string>('MICROSOFT_OAUTH_SCOPE') || 'offline_access https://graph.microsoft.com/Calendars.Read',
    };
  }

  private async upsertIntegration(
    profileId: string,
    provider: 'google' | 'microsoft',
    token: {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      token_type?: string;
      expires_in?: number;
      expires_at?: string;
    },
  ) {
    const idRes = await this.db.query<{ id: string }>(
      'SELECT id FROM user_integrations WHERE user_id = $1 AND provider = $2 LIMIT 1',
      [profileId, provider],
    );

    const existingId = idRes.rows?.[0]?.id || null;
    const expiresAt = (() => {
      if (typeof token.expires_at === 'string' && token.expires_at.trim()) return token.expires_at.trim();
      if (typeof token.expires_in === 'number' && Number.isFinite(token.expires_in) && token.expires_in > 0) {
        return new Date(Date.now() + token.expires_in * 1000).toISOString();
      }
      return null;
    })();

    const accessToken = typeof token.access_token === 'string' ? token.access_token : null;
    const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : null;
    const scope = typeof token.scope === 'string' ? token.scope : null;
    const tokenType = typeof token.token_type === 'string' ? token.token_type : null;

    if (existingId) {
      const res = await this.db.query(
        `UPDATE user_integrations
         SET access_token = COALESCE($1, access_token),
             refresh_token = COALESCE($2, refresh_token),
             scope = COALESCE($3, scope),
             token_type = COALESCE($4, token_type),
             expires_at = COALESCE($5::timestamptz, expires_at),
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [accessToken, refreshToken, scope, tokenType, expiresAt, existingId],
      );
      return res.rows?.[0] || null;
    }

    const newId = randomUUID();
    const res = await this.db.query(
      `INSERT INTO user_integrations (
        id, user_id, provider, access_token, refresh_token, scope, token_type, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
      RETURNING *`,
      [newId, profileId, provider, accessToken, refreshToken, scope, tokenType, expiresAt],
    );
    return res.rows?.[0] || null;
  }

  private async getIntegration(profileId: string, provider: 'google' | 'microsoft') {
    const res = await this.db.query(
      'SELECT * FROM user_integrations WHERE user_id = $1 AND provider = $2 LIMIT 1',
      [profileId, provider],
    );
    return res.rows?.[0] || null;
  }

  async getValidAccessToken(userId: string, provider: 'google' | 'microsoft') {
    const profileId = await this.getProfileId(userId);
    const { token, refreshed } = await this.ensureValidAccessToken(profileId, provider);
    return { token, refreshed, profileId };
  }

  async markSynced(profileId: string, provider: 'google' | 'microsoft', metadata?: Record<string, any>) {
    await this.db.query(
      `UPDATE user_integrations
       SET last_sync_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
           updated_at = NOW()
       WHERE user_id = $1 AND provider = $2`,
      [profileId, provider, metadata ? JSON.stringify(metadata) : null],
    );
  }

  async getIntegrationMetadata(userId: string, provider: 'google' | 'microsoft') {
    const profileId = await this.getProfileId(userId);
    const row = await this.getIntegration(profileId, provider);
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return { profileId, metadata };
  }

  async patchIntegrationMetadata(profileId: string, provider: 'google' | 'microsoft', patch: Record<string, any>) {
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
    const res = await this.db.query(
      `SELECT provider, expires_at, created_at, updated_at,
              last_sync_at, metadata,
              (access_token IS NOT NULL AND access_token <> '') AS has_access_token,
              (refresh_token IS NOT NULL AND refresh_token <> '') AS has_refresh_token
       FROM user_integrations
       WHERE user_id = $1
       ORDER BY provider ASC`,
      [profileId],
    );
    return { integrations: res.rows || [] };
  }

  async connectIntegration(
    userId: string,
    provider: 'google' | 'microsoft',
    authCode: string,
    redirectUri?: string,
  ) {
    const profileId = await this.getProfileId(userId);
    const code = String(authCode || '').trim();
    if (!code) return { ok: false, provider, message: 'Missing auth_code' };

    const cfg = this.readProviderConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      return { ok: false, provider, message: 'Missing OAuth client config' };
    }

    const body = new URLSearchParams();
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
    body.set('code', code);
    body.set('grant_type', 'authorization_code');
    if (typeof redirectUri === 'string' && redirectUri.trim()) {
      body.set('redirect_uri', redirectUri.trim());
    }
    if (provider === 'microsoft') {
      body.set('scope', (cfg as any).scope);
    }

    const tokenRes = await axios.post(cfg.tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });

    const saved = await this.upsertIntegration(profileId, provider, tokenRes.data || {});
    return { ok: true, provider, integration: saved };
  }

  async refreshIntegration(userId: string, provider: 'google' | 'microsoft') {
    const profileId = await this.getProfileId(userId);
    const current = await this.getIntegration(profileId, provider);
    const refreshToken = typeof current?.refresh_token === 'string' ? current.refresh_token : '';
    if (!refreshToken.trim()) return { ok: false, provider, message: 'No refresh token stored' };

    const cfg = this.readProviderConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      return { ok: false, provider, message: 'Missing OAuth client config' };
    }

    const body = new URLSearchParams();
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
    body.set('refresh_token', refreshToken.trim());
    body.set('grant_type', 'refresh_token');
    if (provider === 'microsoft') {
      body.set('scope', (cfg as any).scope);
    }

    const tokenRes = await axios.post(cfg.tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });

    const saved = await this.upsertIntegration(profileId, provider, tokenRes.data || {});
    return { ok: true, provider, integration: saved };
  }

  private async ensureValidAccessToken(profileId: string, provider: 'google' | 'microsoft') {
    const current = await this.getIntegration(profileId, provider);
    const accessToken = typeof current?.access_token === 'string' ? current.access_token : '';
    const expiresAt = current?.expires_at ? new Date(String(current.expires_at)) : null;
    const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() + 60_000 : false;
    if (accessToken.trim() && !isExpired) return { token: accessToken.trim(), refreshed: false };

    const refreshToken = typeof current?.refresh_token === 'string' ? current.refresh_token : '';
    if (!refreshToken.trim()) return { token: '', refreshed: false };

    const cfg = this.readProviderConfig(provider);
    const body = new URLSearchParams();
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
    body.set('refresh_token', refreshToken.trim());
    body.set('grant_type', 'refresh_token');
    if (provider === 'microsoft') {
      body.set('scope', (cfg as any).scope);
    }

    const tokenRes = await axios.post(cfg.tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });

    const saved = await this.upsertIntegration(profileId, provider, tokenRes.data || {});
    const newToken = typeof saved?.access_token === 'string' ? saved.access_token : '';
    return { token: newToken.trim(), refreshed: true };
  }

  async healthCheck(userId: string, provider: 'google' | 'microsoft') {
    const profileId = await this.getProfileId(userId);
    const { token, refreshed } = await this.ensureValidAccessToken(profileId, provider);
    if (!token) return { ok: false, provider, message: 'No valid access token' };

    try {
      if (provider === 'google') {
        const res = await axios.get('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000,
        });
        return { ok: true, provider, refreshed, status: res.status };
      }

      const res = await axios.get('https://graph.microsoft.com/v1.0/me/events?$top=1', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      });
      return { ok: true, provider, refreshed, status: res.status };
    } catch (e: any) {
      const status = e?.response?.status || null;
      return { ok: false, provider, refreshed, status, message: e?.message || 'Health check failed' };
    }
  }
}
