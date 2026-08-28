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
  parentIdField: 'consultationId' | 'inquiryId';
  room: (id: string) => string;
}

export const CONSULTATION_CONFIG: ThreadKindConfig = {
  kind: 'CONSULTATION',
  threadTable: 'consultations',
  messageTable: 'consultation_messages',
  hasAnimal: true,
  aiSettingKey: 'CONSULTATION_AI',
  createEligibility: 'ANY_USER',
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
