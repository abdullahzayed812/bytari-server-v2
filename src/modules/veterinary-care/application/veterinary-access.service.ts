import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AnimalRepository } from '../../animals/infrastructure/animal.repository.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import {
  toClinicAnimalAccessDTO,
  type ClinicAnimalAccessDTO,
} from '../domain/veterinary-care.types.js';
import type {
  AnimalClinicAccessRepository,
  ClinicAnimalListItem,
} from '../infrastructure/animal-clinic-access.repository.js';

export interface VetCareActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface OrgRef {
  id: string;
  type: string;
}

/**
 * Manages the dedicated CLINIC ↔ animal veterinary-access relationship
 * (`animal_clinic_access`). This relationship is INDEPENDENT of animal ownership
 * and is the gate every medical operation checks after organization membership.
 */
export class VeterinaryAccessService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly access: AnimalClinicAccessRepository,
    private readonly animals: AnimalRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinary-access-service' });
  }

  /** True when `organizationId` currently holds ACTIVE veterinary access to `animalId`. */
  hasActiveAccess(animalId: string, organizationId: string): Promise<boolean> {
    return this.access.hasActiveAccess(animalId, organizationId);
  }

  async grant(org: OrgRef, animalId: string, actor: VetCareActor): Promise<ClinicAnimalAccessDTO> {
    VeterinaryCarePolicy.assertVeterinaryOrgType(org);

    const animal = await this.animals.findById(animalId);
    if (!animal) throw new NotFoundError('Animal not found');

    const existing = await this.access.findActive(animalId, org.id);
    if (existing) {
      throw new ConflictError('This clinic already has veterinary access to the animal');
    }

    const granted = await this.db.transaction(async (tx) => {
      const created = await this.access.grant(
        { animalId, organizationId: org.id, grantedByUserId: actor.actorUserId },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_CLINIC_ACCESS_GRANTED,
          entityType: AuditEntityType.ANIMAL_CLINIC_ACCESS,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: org.id, animalId },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('veterinary_access.granted', {
      accessId: granted.id,
      organizationId: org.id,
      animalId,
    });
    return toClinicAnimalAccessDTO(granted);
  }

  async revoke(organizationId: string, animalId: string, actor: VetCareActor): Promise<void> {
    const existing = await this.access.findActive(animalId, organizationId);
    if (!existing) {
      throw new NotFoundError('This clinic does not have veterinary access to the animal');
    }

    await this.db.transaction(async (tx) => {
      const closed = await this.access.revokeActive(
        animalId,
        organizationId,
        actor.actorUserId,
        tx,
      );
      if (closed !== 1) {
        throw new ConflictError('Veterinary access changed concurrently; please retry');
      }
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_CLINIC_ACCESS_REVOKED,
          entityType: AuditEntityType.ANIMAL_CLINIC_ACCESS,
          entityId: existing.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('veterinary_access.revoked', {
      accessId: existing.id,
      organizationId,
      animalId,
    });
  }

  list(
    organizationId: string,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: ClinicAnimalListItem[]; total: number }> {
    return this.access.listActiveForClinic(organizationId, filter);
  }
}
