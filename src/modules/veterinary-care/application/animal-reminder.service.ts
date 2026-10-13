import { businessToday } from '../../../shared/time/business-date.js';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AnimalOwnershipRepository } from '../../animals/infrastructure/animal-ownership.repository.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import {
  redactForClinic,
  type AnimalReminderDTO,
  type ClinicListAnimalSummary,
  type ClinicListOwnerSummary,
  type ClinicReminderListStatus,
  type CreateReminderInput,
  type UpdateReminderInput,
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
 * Animal reminders (legacy `pet_reminders`) — SHARED across clinics, like
 * vaccinations. Clinic side: every clinic that opens the pet reads all of its
 * reminders, anonymised unless this clinic created them
 * ({@link redactForClinic}); only the creating clinic may change, delete or
 * notify about one (403 `CLINIC_RECORD_NOT_OWNED`). The clinic-wide
 * "التذكيرات" work list stays this clinic's own. Owner side: OWNER-VISIBLE,
 * read-only.
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

  /** The animal's reminder, any clinic's — 404 when it is not this animal's. */
  private async mustExist(animalId: string, reminderId: string): Promise<AnimalReminderDTO> {
    const existing = await this.reminders.findByIdForAnimal(reminderId, animalId);
    if (!existing) throw new NotFoundError('Reminder not found');
    return existing;
  }

  /** …and was created by THIS clinic (403 otherwise). */
  private async mustOwnInClinic(
    organizationId: string,
    animalId: string,
    reminderId: string,
  ): Promise<AnimalReminderDTO> {
    const existing = await this.mustExist(animalId, reminderId);
    VeterinaryCarePolicy.assertClinicOwnsSharedItem(existing, organizationId);
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

  async getForClinic(
    organizationId: string,
    animalId: string,
    reminderId: string,
  ): Promise<AnimalReminderDTO> {
    return redactForClinic(await this.mustExist(animalId, reminderId), organizationId);
  }

  /** Every clinic's reminders for the animal; other clinics' are anonymised. */
  async listForClinic(
    organizationId: string,
    animalId: string,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: AnimalReminderDTO[]; total: number }> {
    const { items, total } = await this.reminders.listForAnimal(animalId, {
      ...filter,
      newestFirst: true,
    });
    return { items: items.map((r) => redactForClinic(r, organizationId)), total };
  }

  /** Owner view: every clinic's reminders for the pet (read-only). */
  listForOwner(
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
