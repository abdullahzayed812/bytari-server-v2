import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { AI_SETTING_KEYS, type AiSettingKey } from '../domain/thread.constants.js';
import type { AiSettingsRepository } from '../infrastructure/ai-settings.repository.js';

export interface AiSettingsActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface AiSettingsView {
  consultationAiEnabled: boolean;
  inquiryAiEnabled: boolean;
  /** Admin-defined fixed instruction given to the AI with every consultation (`null` = none). */
  consultationAiInstruction: string | null;
  inquiryAiInstruction: string | null;
}

type EnabledField = 'consultationAiEnabled' | 'inquiryAiEnabled';
type InstructionField = 'consultationAiInstruction' | 'inquiryAiInstruction';

const KEY_BY_FIELD: Record<EnabledField, AiSettingKey> = {
  consultationAiEnabled: 'CONSULTATION_AI',
  inquiryAiEnabled: 'INQUIRY_AI',
};

const INSTRUCTION_KEY_BY_FIELD: Record<InstructionField, AiSettingKey> = {
  consultationAiInstruction: 'CONSULTATION_AI',
  inquiryAiInstruction: 'INQUIRY_AI',
};

/**
 * Admin-only AI enablement flags for Consultations / Inquiries. Phase 13
 * implements only the on/off decision — no provider. The table is extensible
 * (add a `key` to {@link AI_SETTING_KEYS} + the CHECK) for future AI settings.
 */
export class AiSettingsService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly repo: AiSettingsRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'ai-settings-service' });
  }

  isEnabled(key: AiSettingKey): Promise<boolean> {
    return this.repo.isEnabled(key);
  }

  /** The admin's fixed instruction for this AI setting — server-side only, fed to the responder. */
  getInstruction(key: AiSettingKey): Promise<string | null> {
    return this.repo.getInstruction(key);
  }

  async view(): Promise<AiSettingsView> {
    const rows = await this.repo.all();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      consultationAiEnabled: byKey.get('CONSULTATION_AI')?.enabled ?? false,
      inquiryAiEnabled: byKey.get('INQUIRY_AI')?.enabled ?? false,
      consultationAiInstruction: byKey.get('CONSULTATION_AI')?.instruction ?? null,
      inquiryAiInstruction: byKey.get('INQUIRY_AI')?.instruction ?? null,
    };
  }

  async update(actor: AiSettingsActor, patch: Partial<AiSettingsView>): Promise<AiSettingsView> {
    const changed: Array<{ field: EnabledField; key: AiSettingKey; enabled: boolean }> = [];
    for (const field of Object.keys(KEY_BY_FIELD) as EnabledField[]) {
      const value = patch[field];
      if (typeof value === 'boolean') {
        changed.push({ field, key: KEY_BY_FIELD[field], enabled: value });
      }
    }
    // `''` / whitespace clears the instruction (stored as NULL).
    const instructions: Array<{ key: AiSettingKey; instruction: string | null }> = [];
    for (const field of Object.keys(INSTRUCTION_KEY_BY_FIELD) as InstructionField[]) {
      const value = patch[field];
      if (value === undefined) continue;
      const trimmed = value?.trim() ?? '';
      instructions.push({
        key: INSTRUCTION_KEY_BY_FIELD[field],
        instruction: trimmed.length > 0 ? trimmed : null,
      });
    }

    if (instructions.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const i of instructions) {
          await this.repo.setInstruction(i.key, i.instruction, actor.actorUserId, tx);
          await this.audit.record(
            {
              action: AuditAction.AI_SETTING_UPDATED,
              entityType: AuditEntityType.AI_SETTING,
              entityId: null,
              actorUserId: actor.actorUserId,
              // Length only — the instruction text itself stays out of the audit log.
              metadata: { key: i.key, instructionLength: i.instruction?.length ?? 0 },
              context: actor.context,
            },
            tx,
          );
        }
      });
    }

    if (changed.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const c of changed) {
          await this.repo.setEnabled(c.key, c.enabled, actor.actorUserId, tx);
          await this.audit.record(
            {
              action: AuditAction.AI_SETTING_UPDATED,
              entityType: AuditEntityType.AI_SETTING,
              // `audit_logs.entity_id` is a uuid column — the setting key lives
              // in metadata instead.
              entityId: null,
              actorUserId: actor.actorUserId,
              metadata: { key: c.key, enabled: c.enabled },
              context: actor.context,
            },
            tx,
          );
        }
      });
      for (const c of changed) {
        this.events.publish('ai.settings.updated', { key: c.key, enabled: c.enabled });
      }
    }

    return this.view();
  }
}

export { AI_SETTING_KEYS };
