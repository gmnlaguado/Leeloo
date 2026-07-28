import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Envelope returned by `encrypt`. All fields are base64-encoded TEXT so they
 * can be stored in plain SQL columns (cheaper than bytea round-trips and
 * trivial to inspect in dashboards without exposing the plaintext).
 */
export interface CryptoEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

/**
 * AES-256-GCM with Additional Authenticated Data (AAD).
 *
 * Why GCM and not CBC: authenticated encryption — any tamper to ciphertext,
 * iv, tag, or AAD makes `decrypt` throw instead of silently returning garbage.
 *
 * Why AAD: cryptographically binds each ciphertext to its row context
 * (`"<user_id>:<provider>"`). Even with read-write DB access, an attacker
 * cannot move a token row from one user's slot to another's — the AAD
 * mismatch fails decryption.
 *
 * Why `key_version`: lets ops rotate `ENCRYPTION_KEY` without re-encrypting
 * every row in a single transaction. Set `ENCRYPTION_KEY` (current) and
 * `ENCRYPTION_KEY_V<N>` for older versions; `decrypt` selects the right one.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger('CryptoService');
  private readonly algorithm = 'aes-256-gcm';
  private readonly currentVersion: number;
  private readonly keys: Map<number, Buffer>;

  constructor(private readonly config: ConfigService) {
    this.keys = new Map();

    const currentRaw = String(this.config.get<string>('ENCRYPTION_KEY') || '').trim();
    if (!currentRaw) {
      throw new Error(
        'ENCRYPTION_KEY is required (64 hex chars / 32 bytes). ' +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    const currentKey = CryptoService.parseKey(currentRaw, 'ENCRYPTION_KEY');

    this.currentVersion = Number(this.config.get<string>('ENCRYPTION_KEY_VERSION') || '1');
    if (!Number.isInteger(this.currentVersion) || this.currentVersion < 1) {
      throw new Error('ENCRYPTION_KEY_VERSION must be a positive integer');
    }
    this.keys.set(this.currentVersion, currentKey);

    // Older keys for rotation: ENCRYPTION_KEY_V1, ENCRYPTION_KEY_V2, ...
    for (let v = 1; v < this.currentVersion; v++) {
      const envName = `ENCRYPTION_KEY_V${v}`;
      const raw = String(this.config.get<string>(envName) || '').trim();
      if (!raw) {
        this.logger.warn(
          `${envName} not configured — rows encrypted with version ${v} will fail to decrypt`,
        );
        continue;
      }
      this.keys.set(v, CryptoService.parseKey(raw, envName));
    }
  }

  /** Encrypts with the current key version. AAD binds to row context. */
  encrypt(plaintext: string, aad: string): CryptoEnvelope {
    if (typeof plaintext !== 'string') {
      throw new TypeError('plaintext must be a string');
    }
    if (typeof aad !== 'string' || !aad) {
      throw new TypeError('aad is required (e.g. "<user_id>:<provider>")');
    }

    const key = this.keys.get(this.currentVersion);
    if (!key) {
      throw new Error(`No key registered for version ${this.currentVersion}`);
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));

    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      keyVersion: this.currentVersion,
    };
  }

  /** Decrypts. Throws on any tamper to ciphertext, iv, tag, AAD, or key. */
  decrypt(envelope: CryptoEnvelope, aad: string): string {
    if (typeof aad !== 'string' || !aad) {
      throw new TypeError('aad is required');
    }

    const version = envelope.keyVersion;
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`No key registered for version ${version}`);
    }

    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

    if (iv.length !== 12) throw new Error('Invalid IV length (expected 12 bytes)');
    if (tag.length !== 16) throw new Error('Invalid auth tag length (expected 16 bytes)');

    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }

  /** Current key version (the one new writes use). */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * Constant-time string comparison helper. Useful for comparing tokens or
   * verifier strings without leaking length-correlated timing.
   */
  static safeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  private static parseKey(raw: string, name: string): Buffer {
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error(`${name} must be 64 hex characters (32 bytes). Got ${raw.length} chars.`);
    }
    return Buffer.from(raw, 'hex');
  }
}
