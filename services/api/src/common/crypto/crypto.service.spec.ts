import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';

const hexKey = (bytes = 32) => randomBytes(bytes).toString('hex');

const makeConfig = (overrides: Record<string, string | undefined> = {}) => {
  const store: Record<string, string | undefined> = {
    ENCRYPTION_KEY: hexKey(),
    ENCRYPTION_KEY_VERSION: '1',
    ...overrides,
  };
  return {
    get: (key: string) => store[key],
  } as unknown as ConfigService;
};

describe('CryptoService', () => {
  it('round-trips plaintext with matching AAD', () => {
    const svc = new CryptoService(makeConfig());
    const env = svc.encrypt('top-secret-refresh-token', 'user-1:google');
    expect(env.ciphertext).not.toEqual('top-secret-refresh-token');
    expect(env.keyVersion).toBe(1);
    expect(svc.decrypt(env, 'user-1:google')).toBe('top-secret-refresh-token');
  });

  it('produces distinct IVs for the same plaintext', () => {
    const svc = new CryptoService(makeConfig());
    const a = svc.encrypt('hello', 'aad-x');
    const b = svc.encrypt('hello', 'aad-x');
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('throws when AAD does not match (authenticity bind)', () => {
    const svc = new CryptoService(makeConfig());
    const env = svc.encrypt('payload', 'user-A:google');
    expect(() => svc.decrypt(env, 'user-B:google')).toThrow();
  });

  it('throws when auth tag is tampered', () => {
    const svc = new CryptoService(makeConfig());
    const env = svc.encrypt('payload', 'aad');
    const tampered = {
      ...env,
      tag: Buffer.from(env.tag, 'base64').reverse().toString('base64'),
    };
    expect(() => svc.decrypt(tampered, 'aad')).toThrow();
  });

  it('throws when ciphertext is tampered', () => {
    const svc = new CryptoService(makeConfig());
    const env = svc.encrypt('payload', 'aad');
    const buf = Buffer.from(env.ciphertext, 'base64');
    buf[0] = buf[0] ^ 0xff;
    const tampered = { ...env, ciphertext: buf.toString('base64') };
    expect(() => svc.decrypt(tampered, 'aad')).toThrow();
  });

  it('rejects keys that are not 64 hex chars', () => {
    const short = () => new CryptoService(makeConfig({ ENCRYPTION_KEY: 'too-short' }));
    const nonHex = () => new CryptoService(makeConfig({ ENCRYPTION_KEY: 'z'.repeat(64) }));
    expect(short).toThrow(/64 hex/);
    expect(nonHex).toThrow(/64 hex/);
  });

  it('rejects missing ENCRYPTION_KEY', () => {
    expect(() => new CryptoService(makeConfig({ ENCRYPTION_KEY: '' }))).toThrow(
      /ENCRYPTION_KEY is required/,
    );
  });

  it('supports key rotation: decrypts old version when ENCRYPTION_KEY_V1 is provided', () => {
    const v1Key = hexKey();
    const v2Key = hexKey();
    const svcV1 = new CryptoService(
      makeConfig({ ENCRYPTION_KEY: v1Key, ENCRYPTION_KEY_VERSION: '1' }),
    );
    const env = svcV1.encrypt('legacy-token', 'aad');

    const svcV2 = new CryptoService(
      makeConfig({
        ENCRYPTION_KEY: v2Key,
        ENCRYPTION_KEY_VERSION: '2',
        ENCRYPTION_KEY_V1: v1Key,
      }),
    );
    expect(svcV2.decrypt(env, 'aad')).toBe('legacy-token');

    // New writes use the new version.
    const env2 = svcV2.encrypt('fresh-token', 'aad');
    expect(env2.keyVersion).toBe(2);
    expect(svcV2.decrypt(env2, 'aad')).toBe('fresh-token');
  });

  it('safeEquals returns true only for equal-length identical strings', () => {
    expect(CryptoService.safeEquals('abc', 'abc')).toBe(true);
    expect(CryptoService.safeEquals('abc', 'abd')).toBe(false);
    expect(CryptoService.safeEquals('abc', 'abcd')).toBe(false);
  });
});
