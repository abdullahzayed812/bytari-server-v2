import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';

/**
 * Global test bootstrap.
 * Loads `.env.test` when present, otherwise `.env`, then forces the test
 * profile and cheap-but-valid crypto parameters for speed.
 */
loadDotenv({ path: existsSync('.env.test') ? '.env.test' : '.env' });

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET ??= 'test-jwt-secret-that-is-at-least-32-characters';
process.env.JWT_ACCESS_TTL ??= '15m';
process.env.JWT_REFRESH_TTL ??= '30d';
// Fast Argon2id parameters — tests hash many passwords.
process.env.ARGON2_MEMORY_KIB ??= '512';
process.env.ARGON2_ITERATIONS ??= '1';
process.env.ARGON2_PARALLELISM ??= '1';
