import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { CHAT_ORG_TYPES } from './chat.constants.js';

/**
 * Pure chat rules. Anything needing the database (membership, ownership,
 * participation) lives in {@link ChatService}; this file only encodes the
 * relationships that are fixed by the specification.
 */
export const ChatPolicy = {
  /**
   * Chat exists only for CLINIC (Pet Owner ↔ Clinic) and FARM (Farm Owner ↔
   * member) organizations (docs 01 §9). A VETERINARY_OFFICE / VETERINARY_STORE
   * has no confirmed chat context.
   */
  assertChatOrganizationType(orgType: string): void {
    if (!(CHAT_ORG_TYPES as readonly string[]).includes(orgType)) {
      throw new BadRequestError('Chat is only available for clinics and farms', {
        code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
      });
    }
  },

  /** The clinic side of a Pet Owner ↔ Clinic conversation is the whole clinic, not one vet. */
  isClinicType(orgType: string): boolean {
    return orgType === 'CLINIC';
  },

  isFarmType(orgType: string): boolean {
    return orgType === 'FARM';
  },
} as const;
