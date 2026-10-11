import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { AuditRepository } from './audit.repository.js';
import { NotFoundError } from '../../shared/errors/index.js';
import type {
  AuditEntryInput,
  AuditLogDetail,
  AuditLogRecord,
  ListAuditFilter,
} from './audit.types.js';

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

/** Key fragments that mark a value as a credential when READING old entries. */
const SENSITIVE_FRAGMENTS = ['password', 'token', 'secret', 'authorization', 'otp', 'apikey'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z]/g, '');
  return SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_FRAGMENTS.some((f) => k.includes(f));
}

/**
 * Read-side, recursive redaction. The write path only strips top-level keys,
 * so an older entry (or a nested `changes` object) could still hold one —
 * nothing credential-like ever leaves the server.
 */
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redactMetadata(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? '[redacted]' : redactMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

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

  async list(filter: ListAuditFilter): Promise<{ items: AuditLogRecord[]; total: number }> {
    const page = await this.repo.list(filter);
    return {
      total: page.total,
      items: page.items.map((i) => ({
        ...i,
        metadata: redactMetadata(i.metadata) as Record<string, unknown>,
      })),
    };
  }

  /** One entry for the admin details view (`audit.read`). 404 when unknown. */
  async getDetail(id: string): Promise<AuditLogDetail> {
    const entry = await this.repo.findById(id);
    if (!entry) throw new NotFoundError('Audit entry not found');
    const metadata = redactMetadata(entry.metadata) as Record<string, unknown>;
    const orgId =
      entry.entityType === 'ORGANIZATION' && entry.entityId
        ? entry.entityId
        : typeof metadata.organizationId === 'string'
          ? metadata.organizationId
          : null;
    const organization =
      orgId && UUID_RE.test(orgId)
        ? ((await this.repo.findOrganization(orgId)) ?? { id: orgId, name: null, type: null })
        : null;
    return { ...entry, metadata, organization };
  }
}
