import { businessToday } from '../../../shared/time/business-date.js';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AnimalOwnershipRepository } from '../../animals/infrastructure/animal-ownership.repository.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import type {
  AnimalReminderDTO,
  ClinicListAnimalSummary,
  ClinicListOwnerSummary,
  ClinicReminderListStatus,
  CreateReminderInput,
  UpdateReminderInput,
} from '../domain/veterinary-care.types.js';
import type { AnimalReminderRepository } from '../infrastructure/animal-reminder.repository.js';

export interface ReminderActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface ClinicReminderDTO {
  reminder: AnimalReminderDTO;
  animal: ClinicListAnimalSummary;
  owner: ClinicListOwnerSummary | null;
  /** Open and dated before today (legacy derived `overdue`). */
  isOverdue: boolean;
}

/** "Send today's reminders" fan-out cap (one notification per reminder). */
const TODAY_BATCH_CAP = 500;

/**
 * Animal reminders (legacy `pet_reminders`). Same authorization model as
 * medical records / vaccinations: clinic writes are gated by org permission +
 * the clinic's ACTIVE grant, and a clinic may change only reminders IT
 * created; the current owner reads every reminder and — as in the legacy app —
 * may delete one (it is the owner's own to-do list, not medical history).
 */
export class AnimalReminderService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly reminders: AnimalReminderRepository,
    private readonly ownerships: AnimalOwnershipRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'animal-reminder-service' });
  }

  private async mustOwnInClinic(
    organizationId: string,
    animalId: string,
    reminderId: string,
  ): Promise<AnimalReminderDTO> {
    const existing = await this.reminders.findByIdForAnimal(reminderId, animalId);
    // Another clinic's reminder is hidden behind the same 404.
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Reminder not found');
    }
    return existing;
  }

  async createForClinic(
    organizationId: string,
    animal: { id: string; status: string },
    input: CreateReminderInput,
    actor: ReminderActor,
  ): Promise<AnimalReminderDTO> {
    VeterinaryCarePolicy.assertAnimalActive(animal);
    const reminder = await this.db.transaction(async (tx) => {
      const created = await this.reminders.create(
        {
          animalId: animal.id,
          organizationId,
          recordedByUserId: actor.actorUserId,
          title: input.title,
          description: input.description ?? null,
          reminderDate: input.reminderDate,
          reminderType: input.reminderType ?? 'CHECKUP',
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_REMINDER_CREATED,
          entityType: AuditEntityType.ANIMAL_REMINDER,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId: animal.id, reminderId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.events.publish('reminder.created', {
      reminderId: reminder.id,
      animalId: animal.id,
      organizationId,
      petOwnerUserId: await this.ownerships.currentOwnerUserId(animal.id),
      actorUserId: actor.actorUserId,
    });
    return reminder;
  }

  async getForAnimal(animalId: string, reminderId: string): Promise<AnimalReminderDTO> {
    const r = await this.reminders.findByIdForAnimal(reminderId, animalId);
    if (!r) throw new NotFoundError('Reminder not found');
    return r;
  }

  listForAnimal(
    animalId: string,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: AnimalReminderDTO[]; total: number }> {
    return this.reminders.listForAnimal(animalId, filter);
  }

  /** Edit, complete / reopen, or reschedule (legacy update / updateStatus / reschedule). */
  async updateForClinic(
    organizationId: string,
    animal: { id: string; status: string },
    reminderId: string,
    patch: UpdateReminderInput,
    actor: ReminderActor,
  ): Promise<AnimalReminderDTO> {
    await this.mustOwnInClinic(organizationId, animal.id, reminderId);
    VeterinaryCarePolicy.assertAnimalActive(animal);
    const updated = await this.db.transaction(async (tx) => {
      const r = await this.reminders.update(reminderId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_REMINDER_UPDATED,
          entityType: AuditEntityType.ANIMAL_REMINDER,
          entityId: reminderId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId: animal.id, reminderId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return r;
    });
    this.events.publish('reminder.updated', {
      reminderId,
      animalId: animal.id,
      organizationId,
    });
    return updated;
  }

  async deleteForClinic(
    organizationId: string,
    animalId: string,
    reminderId: string,
    actor: ReminderActor,
  ): Promise<void> {
    await this.mustOwnInClinic(organizationId, animalId, reminderId);
    await this.delete(organizationId, animalId, reminderId, actor);
  }

  /** The current owner removes a reminder from their pet (legacy owner delete). */
  async deleteForOwner(animalId: string, reminderId: string, actor: ReminderActor): Promise<void> {
    const existing = await this.reminders.findByIdForAnimal(reminderId, animalId);
    if (!existing) throw new NotFoundError('Reminder not found');
    await this.delete(existing.organizationId, animalId, reminderId, actor);
  }

  private async delete(
    organizationId: string,
    animalId: string,
    reminderId: string,
    actor: ReminderActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const deleted = await this.reminders.deleteById(reminderId, tx);
      if (deleted !== 1) throw new NotFoundError('Reminder not found');
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_REMINDER_DELETED,
          entityType: AuditEntityType.ANIMAL_REMINDER,
          entityId: reminderId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId, reminderId },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('reminder.deleted', { reminderId, animalId, organizationId });
  }

  async listClinicWide(
    organizationId: string,
    filter: { page: number; pageSize: number; status: ClinicReminderListStatus },
  ): Promise<{ items: ClinicReminderDTO[]; total: number }> {
    const { items, total } = await this.reminders.listForClinic(organizationId, filter);
    const today = businessToday();
    return {
      items: items.map((x) => ({
        ...x,
        isOverdue: !x.reminder.isCompleted && x.reminder.reminderDate < today,
      })),
      total,
    };
  }

  /** "إرسال إشعار" for one reminder (legacy `sendReminderNotification`). */
  async notifyOwner(
    organizationId: string,
    animalId: string,
    reminderId: string,
    actor: ReminderActor,
  ): Promise<{ notified: boolean }> {
    await this.mustOwnInClinic(organizationId, animalId, reminderId);
    const petOwnerUserId = await this.ownerships.currentOwnerUserId(animalId);
    if (!petOwnerUserId) return { notified: false };
    await this.audit.record({
      action: AuditAction.ANIMAL_REMINDER_OWNER_NOTIFIED,
      entityType: AuditEntityType.ANIMAL_REMINDER,
      entityId: reminderId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId, animalId, reminderId },
      context: actor.context,
    });
    this.events.publish('reminder.owner_notified', {
      reminderId,
      animalId,
      organizationId,
      petOwnerUserId,
      actorUserId: actor.actorUserId,
      sentAt: new Date().toISOString(),
    });
    return { notified: true };
  }

  /** "إرسال تذكيرات اليوم" (legacy `sendTodayRemindersNotification`). */
  async notifyTodayOwners(organizationId: string, actor: ReminderActor): Promise<{ sent: number }> {
    const due = await this.reminders.openTodayForClinic(organizationId, TODAY_BATCH_CAP);
    const sentAt = new Date().toISOString();
    let sent = 0;
    for (const r of due) {
      if (!r.ownerUserId) continue;
      this.events.publish('reminder.owner_notified', {
        reminderId: r.id,
        animalId: r.animalId,
        organizationId,
        petOwnerUserId: r.ownerUserId,
        actorUserId: actor.actorUserId,
        sentAt,
      });
      sent += 1;
    }
    await this.audit.record({
      action: AuditAction.ANIMAL_REMINDER_OWNER_NOTIFIED,
      entityType: AuditEntityType.ORGANIZATION,
      entityId: organizationId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId, batch: 'TODAY', sent },
      context: actor.context,
    });
    return { sent };
  }
}
