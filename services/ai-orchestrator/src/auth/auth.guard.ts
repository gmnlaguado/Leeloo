import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer?: string;
  private readonly audience?: string;
  private readonly devBypass: boolean;
  private readonly devUserId: string;
  private readonly devAuthToken?: string;

  constructor(private readonly configService: ConfigService) {
    this.devBypass = this.configService.get<string>('DEV_BYPASS_AUTH') === 'true';
    this.devUserId = this.configService.get<string>('DEV_USER_ID') || 'dev-user';
    this.devAuthToken = this.configService.get<string>('DEV_AUTH_TOKEN') || undefined;

    if (this.devBypass || this.devAuthToken) {
      // Skip JWKS init in dev mode
      this.jwks = null as any;
      this.issuer = undefined;
      this.audience = undefined;
      return;
    }

    const jwksUrl = this.configService.get<string>('CLERK_JWKS_URL');
    if (!jwksUrl) {
      throw new Error('CLERK_JWKS_URL is not configured');
    }

    let jwksUrlObj: URL;
    try {
      jwksUrlObj = new URL(jwksUrl);
    } catch {
      throw new Error(
        `CLERK_JWKS_URL is invalid: "${jwksUrl}". Fix it or set DEV_BYPASS_AUTH=true for local development.`,
      );
    }

    this.jwks = createRemoteJWKSet(jwksUrlObj);
    this.issuer = this.configService.get<string>('CLERK_ISSUER') || undefined;
    this.audience = this.configService.get<string>('CLERK_AUDIENCE') || undefined;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const method = request?.method;
    const path = request?.originalUrl || request?.url;
    if (this.devBypass) {
      request.user = { id: this.devUserId, claims: { dev: true } };
      return true;
    }

    const authHeader = request.headers.authorization;

    if (this.devAuthToken) {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[AuthGuard] Missing Bearer token (dev token mode)', { method, path });
        throw new UnauthorizedException('Missing or invalid authorization header');
      }

      const token = authHeader.substring(7);
      if (token !== this.devAuthToken) {
        console.log('[AuthGuard] Invalid token (dev token mode)', {
          method,
          path,
          tokenLen: token?.length ?? 0,
        });
        throw new UnauthorizedException('Invalid token');
      }

      request.user = { id: this.devUserId, claims: { dev: true } };
      return true;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[AuthGuard] Missing Bearer token', { method, path });
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        ...(this.issuer ? { issuer: this.issuer } : {}),
        ...(this.audience ? { audience: this.audience } : {}),
      });

      const userId = typeof payload.sub === 'string' ? payload.sub : null;
      if (!userId) {
        throw new UnauthorizedException('Invalid token (missing sub)');
      }

      request.user = { id: userId, claims: payload };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
