import type { Request } from 'express';
import type { AuditContext } from './audit.types.js';

export type AuditContextResult = AuditContext;

/** Extract IP / user-agent / request-id from the current request for audit records. */
export function auditContextFromRequest(req: Request): AuditContext {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}
