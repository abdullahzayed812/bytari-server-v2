import { describe, expect, it } from 'vitest';
import { ChatPolicy } from '../../src/modules/chat/domain/chat.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('ChatPolicy.assertChatOrganizationType', () => {
  it('accepts CLINIC and FARM (docs 01 §9: Clinic Chat + Farm Chat)', () => {
    expect(() => ChatPolicy.assertChatOrganizationType('CLINIC')).not.toThrow();
    expect(() => ChatPolicy.assertChatOrganizationType('FARM')).not.toThrow();
  });

  it.each(['VETERINARY_STORE', 'VETERINARY_OFFICE', 'SYNDICATE', 'HOSPITAL', 'nonsense'])(
    'rejects %s with 400 ORGANIZATION_TYPE_NOT_SUPPORTED',
    (type) => {
      try {
        ChatPolicy.assertChatOrganizationType(type);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
      }
    },
  );

  it('classifies clinic vs farm', () => {
    expect(ChatPolicy.isClinicType('CLINIC')).toBe(true);
    expect(ChatPolicy.isClinicType('FARM')).toBe(false);
    expect(ChatPolicy.isFarmType('FARM')).toBe(true);
    expect(ChatPolicy.isFarmType('CLINIC')).toBe(false);
  });
});
