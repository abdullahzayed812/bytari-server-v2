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
}

const KEY_BY_FIELD: Record<keyof AiSettingsView, AiSettingKey> = {
  consultationAiEnabled: 'CONSULTATION_AI',
  inquiryAiEnabled: 'INQUIRY_AI',
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

  async view(): Promise<AiSettingsView> {
    const rows = await this.repo.all();
    const map = new Map(rows.map((r) => [r.key, r.enabled]));
    return {
      consultationAiEnabled: map.get('CONSULTATION_AI') ?? false,
      inquiryAiEnabled: map.get('INQUIRY_AI') ?? false,
    };
  }

  async update(actor: AiSettingsActor, patch: Partial<AiSettingsView>): Promise<AiSettingsView> {
    const changed: Array<{ field: keyof AiSettingsView; key: AiSettingKey; enabled: boolean }> = [];
    for (const field of Object.keys(KEY_BY_FIELD) as Array<keyof AiSettingsView>) {
      const value = patch[field];
      if (typeof value === 'boolean') {
        changed.push({ field, key: KEY_BY_FIELD[field], enabled: value });
      }
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
