import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

const BASE_ENV = {
  NODE_ENV: 'test',
  DB_HOST: 'db.example',
  DB_PORT: '6000',
  DB_NAME: 'x',
  DB_USER: 'y',
  DB_PASSWORD: 'z',
};

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.http.corsOrigins).toEqual(['*']);
    expect(config.http.rateLimit.windowMs).toBe(60_000);
    expect(config.isTest).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it('coerces and parses typed values', () => {
    const config = loadConfig({
      ...BASE_ENV,
      PORT: '8080',
      CORS_ORIGINS: 'https://a.test, https://b.test',
      DB_SSL: 'true',
      DB_POOL_MAX: '25',
    });
    expect(config.port).toBe(8080);
    expect(config.http.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(config.database.ssl).toBe(true);
    expect(config.database.pool.max).toBe(25);
  });

  it('exposes production-hardening knobs with safe defaults', () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.database.statementTimeoutMs).toBe(30_000);
    expect(config.database.sslRejectUnauthorized).toBe(false);
    expect(config.realtime.maxConnections).toBe(10_000);
  });

  it('overrides the hardening knobs from the environment', () => {
    const config = loadConfig({
      ...BASE_ENV,
      DB_STATEMENT_TIMEOUT_MS: '0',
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
      REALTIME_MAX_CONNECTIONS: '5',
    });
    expect(config.database.statementTimeoutMs).toBe(0);
    expect(config.database.sslRejectUnauthorized).toBe(true);
    expect(config.realtime.maxConnections).toBe(5);
  });

  it('prefers DATABASE_URL when provided', () => {
    const config = loadConfig({
      ...BASE_ENV,
      DATABASE_URL: 'postgres://u:p@h:5432/dbname',
    });
    expect(config.database.url).toBe('postgres://u:p@h:5432/dbname');
  });

  it('throws a descriptive error on invalid input', () => {
    expect(() => loadConfig({ ...BASE_ENV, PORT: 'not-a-number' })).toThrowError(
      /Invalid environment configuration/,
    );
  });

  describe('infrastructure config', () => {
    it('defaults realtime on with sane values and no firebase / r2', () => {
      const config = loadConfig({ ...BASE_ENV });
      expect(config.realtime).toEqual({
        enabled: true,
        path: '/realtime',
        pingIntervalMs: 30_000,
        allowAnonymous: false,
        maxConnections: 10_000,
      });
      expect(config.firebase).toBeNull();
      expect(config.storage.r2).toBeNull();
    });

    it('never allows anonymous realtime in production', () => {
      const config = loadConfig({
        ...BASE_ENV,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a-production-grade-secret-at-least-32-chars',
        REALTIME_ALLOW_ANONYMOUS: 'true',
      });
      expect(config.realtime.allowAnonymous).toBe(false);
    });

    it('requires JWT_ACCESS_SECRET in production', () => {
      expect(() => loadConfig({ ...BASE_ENV, NODE_ENV: 'production' })).toThrowError(
        /JWT_ACCESS_SECRET/,
      );
    });

    it('parses a complete Firebase credential set and unescapes the private key', () => {
      const config = loadConfig({
        ...BASE_ENV,
        FIREBASE_PROJECT_ID: 'proj',
        FIREBASE_CLIENT_EMAIL: 'sa@proj.iam.gserviceaccount.com',
        FIREBASE_PRIVATE_KEY: '-----BEGIN-----\\nline\\n-----END-----',
      });
      expect(config.firebase?.projectId).toBe('proj');
      expect(config.firebase?.privateKey).toBe('-----BEGIN-----\nline\n-----END-----');
    });

    it('rejects a partial Firebase credential set', () => {
      expect(() =>
        loadConfig({ ...BASE_ENV, FIREBASE_PROJECT_ID: 'proj', FIREBASE_CLIENT_EMAIL: 'x@y' }),
      ).toThrowError(/Incomplete Firebase config/);
    });

    it('parses a complete R2 config and derives the endpoint', () => {
      const config = loadConfig({
        ...BASE_ENV,
        R2_ACCOUNT_ID: 'acc123',
        R2_ACCESS_KEY_ID: 'ak',
        R2_SECRET_ACCESS_KEY: 'sk',
        R2_BUCKET: 'bytari-files',
        R2_PUBLIC_BASE_URL: 'https://files.bytari.test',
      });
      expect(config.storage.r2).toMatchObject({
        bucket: 'bytari-files',
        endpoint: 'https://acc123.r2.cloudflarestorage.com',
        publicBaseUrl: 'https://files.bytari.test',
        forcePathStyle: true,
      });
    });

    it('rejects a partial R2 config', () => {
      expect(() => loadConfig({ ...BASE_ENV, R2_ACCOUNT_ID: 'acc', R2_BUCKET: 'b' })).toThrowError(
        /Incomplete Cloudflare R2 config/,
      );
    });
  });
});
