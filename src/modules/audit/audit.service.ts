import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { AuditRepository } from './audit.repository.js';
import type { AuditEntryInput, AuditLogRecord, ListAuditFilter } from './audit.types.js';

/** Metadata keys that must never be persisted, regardless of caller. */
const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'tokenhash',
  'token_hash',
  'secret',
  'authorization',
]);

const MAX_METADATA_BYTES = 8_192;

function sanitizeMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = value;
  }
  // Guard against pathological payloads.
  const json = JSON.stringify(out);
  if (json.length > MAX_METADATA_BYTES) {
    return { truncated: true, bytes: json.length };
  }
  return out;
}

/**
 * The single writer for the audit log. Every module records security-relevant
 * actions through this service — never by inserting `audit_logs` rows directly.
 */
export class AuditService {
  private readonly log: Logger;

  constructor(
    private readonly repo: AuditRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'audit' });
  }

  /**
   * Persist an audit entry. Pass `trx` to make the entry atomic with the
   * administrative operation it records (recommended for critical actions).
   * Throws if the insert fails — the caller's transaction then rolls back.
   */
  async record(input: AuditEntryInput, trx?: Knex.Transaction): Promise<void> {
    await this.repo.insert(
      {
        actor_user_id: input.actorUserId ?? null,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        metadata: sanitizeMetadata(input.metadata),
        ip: input.context?.ip ?? null,
        user_agent: input.context?.userAgent ?? null,
        request_id: input.context?.requestId ?? null,
      },
      trx,
    );
  }

  /**
   * Best-effort variant for non-critical, out-of-transaction events. Never
   * throws — failures are logged and swallowed.
   */
  async recordSafe(input: AuditEntryInput): Promise<void> {
    try {
      await this.record(input);
    } catch (err) {
      this.log.error({ err, action: input.action }, 'failed to write audit entry');
    }
  }

  list(filter: ListAuditFilter): Promise<{ items: AuditLogRecord[]; total: number }> {
    return this.repo.list(filter);
  }
}
