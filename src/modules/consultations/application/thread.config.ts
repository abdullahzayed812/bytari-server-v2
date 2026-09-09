import { rooms } from '../../../infra/realtime/index.js';
import { AuditAction } from '../../audit/audit.types.js';
import type { AiSettingKey, ThreadKind } from '../domain/thread.constants.js';

/** Everything that differs between a Consultation and an Inquiry. */
export interface ThreadKindConfig {
  kind: ThreadKind;
  threadTable: string;
  messageTable: string;
  /** Consultations may reference an owned animal; inquiries never do. */
  hasAnimal: boolean;
  aiSettingKey: AiSettingKey;
  /** Actor eligible to CREATE: 'ANY_USER' (pet owner) | 'APPROVED_VET'. */
  createEligibility: 'ANY_USER' | 'APPROVED_VET';
  /**
   * Whether a domain supervisor must ALSO be an approved veterinarian to hold
   * RESPONDER access (true for the clinical CONSULTATION / INQUIRY kinds;
   * false for SUPPORT — an app-support agent is not a vet). ADMIN is always
   * exempt.
   */
  responderRequiresApprovedVet: boolean;
  /**
   * Whether a newly created thread of this kind gets an automatic AI reply
   * (when the matching `ai_settings` flag is also on). `true` for the clinical
   * CONSULTATION / INQUIRY kinds; `false` for SUPPORT ("تواصل معنا"), which is
   * human-only. The thread is always OPEN and freely writable by the creator —
   * only CLOSE (or a manual sender block) stops them.
   */
  aiAutoRespond: boolean;
  perms: { read: string; respond: string; close: string; adminRead: string };
  auditActions: { created: string; closed: string; blocked: string; unblocked: string };
  events: {
    created: string;
    message: string;
    closed: string;
    blocked: string;
    unblocked: string;
  };
  /** Public field name for the parent id in message DTOs. */
  parentIdField: 'consultationId' | 'inquiryId' | 'supportId';
  room: (id: string) => string;
}

export const CONSULTATION_CONFIG: ThreadKindConfig = {
  kind: 'CONSULTATION',
  threadTable: 'consultations',
  messageTable: 'consultation_messages',
  hasAnimal: true,
  aiSettingKey: 'CONSULTATION_AI',
  createEligibility: 'ANY_USER',
  responderRequiresApprovedVet: true,
  aiAutoRespond: true,
  perms: {
    read: 'consultation.read',
    respond: 'consultation.respond',
    close: 'consultation.close',
    adminRead: 'consultation.admin.read',
  },
  auditActions: {
    created: AuditAction.CONSULTATION_CREATED,
    closed: AuditAction.CONSULTATION_CLOSED,
    blocked: AuditAction.CONSULTATION_SENDER_BLOCKED,
    unblocked: AuditAction.CONSULTATION_SENDER_UNBLOCKED,
  },
  events: {
    created: 'consultation.created',
    message: 'consultation.message.created',
    closed: 'consultation.closed',
    blocked: 'consultation.sender_blocked',
    unblocked: 'consultation.sender_unblocked',
  },
  parentIdField: 'consultationId',
  room: rooms.consultation,
};

export const INQUIRY_CONFIG: ThreadKindConfig = {
  kind: 'INQUIRY',
  threadTable: 'inquiries',
  messageTable: 'inquiry_messages',
  hasAnimal: false,
  aiSettingKey: 'INQUIRY_AI',
  createEligibility: 'APPROVED_VET',
  responderRequiresApprovedVet: true,
  aiAutoRespond: true,
  perms: {
    read: 'inquiry.read',
    respond: 'inquiry.respond',
    close: 'inquiry.close',
    adminRead: 'inquiry.admin.read',
  },
  auditActions: {
    created: AuditAction.INQUIRY_CREATED,
    closed: AuditAction.INQUIRY_CLOSED,
    blocked: AuditAction.INQUIRY_SENDER_BLOCKED,
    unblocked: AuditAction.INQUIRY_SENDER_UNBLOCKED,
  },
  events: {
    created: 'inquiry.created',
    message: 'inquiry.message.created',
    closed: 'inquiry.closed',
    blocked: 'inquiry.sender_blocked',
    unblocked: 'inquiry.sender_unblocked',
  },
  parentIdField: 'inquiryId',
  room: rooms.inquiry,
};

/**
 * "تواصل معنا" — a support message to the administration. Same kernel as an
 * inquiry (no animal), but creation is open to ANY signed-in user and the
 * responder side is the SUPPORT system-supervisor domain (or ADMIN).
 */
export const SUPPORT_CONFIG: ThreadKindConfig = {
  kind: 'SUPPORT',
  threadTable: 'support_threads',
  messageTable: 'support_thread_messages',
  hasAnimal: false,
  aiSettingKey: 'SUPPORT_AI',
  createEligibility: 'ANY_USER',
  responderRequiresApprovedVet: false,
  // "تواصل معنا" is human-only — no automatic AI reply.
  aiAutoRespond: false,
  perms: {
    read: 'support.read',
    respond: 'support.respond',
    close: 'support.close',
    adminRead: 'support.admin.read',
  },
  auditActions: {
    created: AuditAction.SUPPORT_MESSAGE_CREATED,
    closed: AuditAction.SUPPORT_MESSAGE_CLOSED,
    blocked: AuditAction.SUPPORT_MESSAGE_SENDER_BLOCKED,
    unblocked: AuditAction.SUPPORT_MESSAGE_SENDER_UNBLOCKED,
  },
  events: {
    created: 'support.created',
    message: 'support.message.created',
    closed: 'support.closed',
    blocked: 'support.sender_blocked',
    unblocked: 'support.sender_unblocked',
  },
  parentIdField: 'supportId',
  room: rooms.support,
};
