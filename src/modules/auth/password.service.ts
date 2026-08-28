import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import type { AuthConfig } from '../../config/index.js';

/**
 * `@node-rs/argon2` exposes `Algorithm` as a `const enum`, which
 * `verbatimModuleSyntax` forbids importing. `Argon2id` is `2`.
 */
const ALGORITHM_ARGON2ID = 2;

/**
 * The only place passwords are hashed / verified. Uses Argon2id with
 * OWASP-aligned parameters. Never logs its inputs or outputs.
 */
export class PasswordService {
  private readonly options: {
    algorithm: number;
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };

  constructor(config: AuthConfig) {
    this.options = {
      algorithm: ALGORITHM_ARGON2ID,
      memoryCost: config.argon2.memoryCost,
      timeCost: config.argon2.timeCost,
      parallelism: config.argon2.parallelism,
    };
  }

  hash(plainPassword: string): Promise<string> {
    return argon2Hash(plainPassword, this.options);
  }

  /** Constant-time verification. Returns `false` (never throws) on a malformed hash. */
  async verify(hashString: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2Verify(hashString, plainPassword);
    } catch {
      return false;
    }
  }
}
