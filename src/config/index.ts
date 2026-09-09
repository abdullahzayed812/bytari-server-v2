import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Centralised, validated application configuration.
 *
 * All environment access happens here. The rest of the codebase imports the
 * typed {@link AppConfig} object and never touches `process.env` directly.
 */

let dotenvLoaded = false;

function ensureDotenv(): void {
  if (dotenvLoaded) return;
  // In real deployments env vars are injected by the platform; `.env` is a
  // developer convenience only. Missing file is not an error.
  loadDotenv();
  dotenvLoaded = true;
}

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

/** Present + non-empty after trimming. */
function isSet(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    CORS_ORIGINS: csv.default('*'),
    BODY_LIMIT: z.string().default('1mb'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

    DATABASE_URL: z.string().url().optional(),
    DB_HOST: z.string().default('localhost'),
    DB_PORT: z.coerce.number().int().positive().max(65535).default(5432),
    DB_NAME: z.string().default('bytari'),
    DB_USER: z.string().default('bytari'),
    DB_PASSWORD: z.string().default('bytari'),
    DB_SSL: booleanFromString.default('false'),
    // Verify the server certificate chain when DB_SSL is on. Managed Postgres
    // offerings that present a private CA may require this off; keep it on where
    // the platform CA is trusted.
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromString.default('false'),
    DB_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    // Per-connection `statement_timeout` (ms). Caps runaway queries so one
    // slow statement cannot pin a pool connection indefinitely. 0 disables it.
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),

    // --- Real-time (WebSocket) gateway -----------------------------------
    REALTIME_ENABLED: booleanFromString.default('true'),
    REALTIME_PATH: z.string().startsWith('/').default('/realtime'),
    REALTIME_PING_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
    // Dev-only escape hatch: accept unauthenticated sockets. Ignored in production.
    REALTIME_ALLOW_ANONYMOUS: booleanFromString.default('false'),
    // Hard cap on concurrent WebSocket connections per node. 0 disables the cap.
    REALTIME_MAX_CONNECTIONS: z.coerce.number().int().nonnegative().default(10_000),

    // --- Firebase Cloud Messaging (push) — all-or-nothing ---------------
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    // Supports "\n"-escaped PEM as commonly stored in a single env var.
    FIREBASE_PRIVATE_KEY: z
      .string()
      .optional()
      .transform((v) => (v ? v.replace(/\\n/g, '\n') : v)),
    // Alternative to the trio above: full service-account JSON (raw or base64).
    FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

    // --- Cloudflare R2 object storage — all-or-nothing -----------------
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    // Optional CDN / public bucket base used to build public URLs.
    R2_PUBLIC_BASE_URL: z.string().url().optional(),
    R2_FORCE_PATH_STYLE: booleanFromString.default('true'),
    R2_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

    // --- Identity / JWT (Phase 2) -------------------------------------
    // HS256 secret for access tokens. REQUIRED in production; in dev/test a
    // random per-process value is generated if unset (tokens die on restart).
    JWT_ACCESS_SECRET: z.string().min(32).optional(),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    JWT_ISSUER: z.string().default('bytari'),
    JWT_AUDIENCE: z.string().default('bytari-app'),
    // Stricter per-IP limiter for auth endpoints (login / register / refresh).
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    // Argon2id tuning (defaults follow OWASP guidance).
    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19_456),
    ARGON2_ITERATIONS: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

    // --- Bootstrap admin (development seed only) ---------------------
    BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
    BOOTSTRAP_ADMIN_FIRST_NAME: z.string().default('System'),
    BOOTSTRAP_ADMIN_LAST_NAME: z.string().default('Administrator'),

    // --- Development persona seed (dev-seed) --------------------------
    // Runs automatically when NODE_ENV=development. Set true to opt in
    // elsewhere (e.g. a shared staging box) — never allowed in production.
    ENABLE_DEV_SEEDS: booleanFromString.default('false'),

    // --- Outbound email (Gmail SMTP via nodemailer) — all-or-nothing ----
    EMAIL_USER: z.string().email().optional(),
    // A Gmail App Password (16 chars, no spaces) — never the account password.
    EMAIL_PASS: z.string().optional(),
    // Display "From" address. Defaults to EMAIL_USER when unset.
    EMAIL_FROM: z.string().optional(),

    // --- AI responder for Consultations / Inquiries --------------------
    // Backend-only. The endpoint below is a keyless public proxy; there is no
    // secret to configure. Per-kind on/off still lives in `ai_settings`
    // (admin-managed) — this only controls WHICH provider the backend calls.
    // Set AI_TOOLKIT_ENABLED=false to force the no-op provider regardless.
    AI_TOOLKIT_ENABLED: booleanFromString.default('true'),
    AI_TOOLKIT_URL: z.string().url().default('https://toolkit.rork.com/text/llm/'),
    AI_TOOLKIT_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(20_000),
  })
  .superRefine((env, ctx) => {
    // Firebase: if any single credential field is provided, the whole set must be.
    const firebaseTrio = [
      env.FIREBASE_PROJECT_ID,
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    ];
    const anyTrio = firebaseTrio.some(isSet);
    const allTrio = firebaseTrio.every(isSet);
    if (anyTrio && !allTrio && !isSet(env.FIREBASE_SERVICE_ACCOUNT_JSON)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_PROJECT_ID'],
        message:
          'Incomplete Firebase config: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY together, or provide FIREBASE_SERVICE_ACCOUNT_JSON.',
      });
    }

    // Email: both credentials are required together.
    const anyEmail = isSet(env.EMAIL_USER) || isSet(env.EMAIL_PASS);
    const allEmail = isSet(env.EMAIL_USER) && isSet(env.EMAIL_PASS);
    if (anyEmail && !allEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_USER'],
        message: 'Incomplete email config: EMAIL_USER and EMAIL_PASS must both be set.',
      });
    }

    // R2: all four core values are required together.
    const r2Core = [
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.R2_BUCKET,
    ];
    const anyR2 = r2Core.some(isSet) || isSet(env.R2_PUBLIC_BASE_URL);
    const allR2 = r2Core.every(isSet);
    if (anyR2 && !allR2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['R2_BUCKET'],
        message:
          'Incomplete Cloudflare R2 config: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set.',
      });
    }

    // A stable JWT secret is mandatory in production.
    if (env.NODE_ENV === 'production' && !isSet(env.JWT_ACCESS_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET (>=32 chars) is required when NODE_ENV=production.',
      });
    }
  })
  .transform((env) => {
    const firebaseConfigured =
      isSet(env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
      (isSet(env.FIREBASE_PROJECT_ID) &&
        isSet(env.FIREBASE_CLIENT_EMAIL) &&
        isSet(env.FIREBASE_PRIVATE_KEY));

    const r2Configured =
      isSet(env.R2_ACCOUNT_ID) &&
      isSet(env.R2_ACCESS_KEY_ID) &&
      isSet(env.R2_SECRET_ACCESS_KEY) &&
      isSet(env.R2_BUCKET);

    const emailConfigured = isSet(env.EMAIL_USER) && isSet(env.EMAIL_PASS);

    return {
      env: env.NODE_ENV,
      isProduction: env.NODE_ENV === 'production',
      isTest: env.NODE_ENV === 'test',
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
      http: {
        corsOrigins: env.CORS_ORIGINS,
        bodyLimit: env.BODY_LIMIT,
        rateLimit: {
          windowMs: env.RATE_LIMIT_WINDOW_MS,
          max: env.RATE_LIMIT_MAX,
        },
      },
      database: {
        url: env.DATABASE_URL,
        host: env.DB_HOST,
        port: env.DB_PORT,
        name: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        ssl: env.DB_SSL,
        sslRejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
        pool: { min: env.DB_POOL_MIN, max: env.DB_POOL_MAX },
        statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
      },
      realtime: {
        enabled: env.REALTIME_ENABLED,
        path: env.REALTIME_PATH,
        pingIntervalMs: env.REALTIME_PING_INTERVAL_MS,
        allowAnonymous: env.REALTIME_ALLOW_ANONYMOUS && env.NODE_ENV !== 'production',
        maxConnections: env.REALTIME_MAX_CONNECTIONS,
      },
      firebase: firebaseConfigured
        ? {
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY,
            serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
          }
        : null,
      storage: {
        r2: r2Configured
          ? {
              accountId: env.R2_ACCOUNT_ID as string,
              accessKeyId: env.R2_ACCESS_KEY_ID as string,
              secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
              bucket: env.R2_BUCKET as string,
              endpoint: `https://${env.R2_ACCOUNT_ID as string}.r2.cloudflarestorage.com`,
              publicBaseUrl: env.R2_PUBLIC_BASE_URL ?? null,
              forcePathStyle: env.R2_FORCE_PATH_STYLE,
              signedUrlTtlSeconds: env.R2_SIGNED_URL_TTL_SECONDS,
            }
          : null,
      },
      email: emailConfigured
        ? {
            user: env.EMAIL_USER as string,
            pass: env.EMAIL_PASS as string,
            from: env.EMAIL_FROM ?? (env.EMAIL_USER as string),
          }
        : null,
      ai: {
        // `enabled` only picks the provider; the per-kind `ai_settings` flags
        // still gate whether a reply is actually generated.
        enabled: env.AI_TOOLKIT_ENABLED,
        toolkitUrl: env.AI_TOOLKIT_URL,
        toolkitTimeoutMs: env.AI_TOOLKIT_TIMEOUT_MS,
      },
      auth: {
        jwt: {
          accessSecret: isSet(env.JWT_ACCESS_SECRET) ? env.JWT_ACCESS_SECRET : null,
          accessTtl: env.JWT_ACCESS_TTL,
          refreshTtl: env.JWT_REFRESH_TTL,
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
        },
        rateLimit: {
          windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
          max: env.AUTH_RATE_LIMIT_MAX,
        },
        argon2: {
          memoryCost: env.ARGON2_MEMORY_KIB,
          timeCost: env.ARGON2_ITERATIONS,
          parallelism: env.ARGON2_PARALLELISM,
        },
        bootstrapAdmin:
          isSet(env.BOOTSTRAP_ADMIN_EMAIL) && isSet(env.BOOTSTRAP_ADMIN_PASSWORD)
            ? {
                email: env.BOOTSTRAP_ADMIN_EMAIL,
                password: env.BOOTSTRAP_ADMIN_PASSWORD,
                firstName: env.BOOTSTRAP_ADMIN_FIRST_NAME,
                lastName: env.BOOTSTRAP_ADMIN_LAST_NAME,
              }
            : null,
      },
      devSeed: {
        enabled: env.NODE_ENV === 'development' || env.ENABLE_DEV_SEEDS,
      },
    };
  });

export type AppConfig = z.infer<typeof envSchema>;
export type RealtimeConfig = AppConfig['realtime'];
export type FirebaseConfig = NonNullable<AppConfig['firebase']>;
export type R2Config = NonNullable<AppConfig['storage']['r2']>;
export type EmailConfig = NonNullable<AppConfig['email']>;
export type AiConfig = AppConfig['ai'];
export type AuthConfig = AppConfig['auth'];

let cached: AppConfig | undefined;

/**
 * Parse and validate configuration from the environment.
 * Throws a descriptive error (and never a partial config) when validation fails.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  ensureDotenv();
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Memoised accessor for the process-wide configuration. */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test helper: clear the memoised config so the next {@link getConfig} re-reads env. */
export function resetConfigCache(): void {
  cached = undefined;
}
