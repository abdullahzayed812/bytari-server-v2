import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { deleteReplacedObjects } from '../../../shared/storage/replaced-objects.js';
import { AuditAction, AuditEntityType } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrgActor } from './organization.service.js';

/** Types an admin may permanently delete. */
export const PURGEABLE_ORGANIZATION_TYPES = ['CLINIC', 'VETERINARY_OFFICE', 'FARM'] as const;

/** Why `DELETE /admin/organizations/:id/permanent` refused — `details[0].rule` of a 409. */
export type OrganizationPurgeBlockRule =
  'TYPE_NOT_PURGEABLE' | 'NOT_DELETED' | 'HOLDS_PET_OWNER_RECORDS';

export interface OrganizationPurgeResult {
  id: string;
  deleted: true;
  /** Rows removed explicitly before the cascade, per table (only non-zero entries). */
  removed: Record<string, number>;
}

/**
 * Pet owners' records a clinic authored. Medical history is never destroyed
 * (it is RESTRICT-protected and attribution is mandatory, see
 * `20261104020000_clinic_pet_removal`), and appointments are the owner's
 * history too — a clinic that holds any of them stays soft-deleted.
 */
const PET_OWNER_RECORD_TABLES = ['medical_records', 'vaccinations', 'animal_reminders'] as const;

/**
 * The organization's OWN operational data, RESTRICT-referenced so it never
 * disappears by accident — removed explicitly here, children before parents.
 * (Their own children — daily records of a flock, product images… — CASCADE.)
 */
const OWNED_RESTRICT_TABLES = [
  'farm_expenses',
  'farm_appointments',
  'poultry_daily_records',
  'poultry_health_events',
  'poultry_cases',
  'poultry_flocks',
  'sheep_daily_records',
  'sheep_health_events',
  'sheep_cases',
  'sheep_batches',
  'cattle_daily_records',
  'cattle_health_events',
  'cattle_cases',
  'cattle_batches',
  'veterinary_office_products',
  'veterinary_store_products',
] as const;

/** Storage keys held by the organization's rows (deleted from storage after commit). */
const MEDIA_COLUMNS: ReadonlyArray<{ table: string; column: string; array?: boolean }> = [
  { table: 'clinic_details', column: 'logo_key' },
  { table: 'clinic_details', column: 'gallery_keys', array: true },
  { table: 'clinic_details', column: 'license_document_keys', array: true },
  { table: 'veterinary_office_details', column: 'logo_key' },
  { table: 'veterinary_office_details', column: 'gallery_keys', array: true },
  { table: 'veterinary_office_details', column: 'license_document_keys', array: true },
  { table: 'farm_details', column: 'image_key' },
  { table: 'poultry_cases', column: 'image_key' },
  { table: 'sheep_cases', column: 'image_key' },
  { table: 'cattle_cases', column: 'image_key' },
  { table: 'veterinary_office_products', column: 'primary_image_key' },
  { table: 'veterinary_store_products', column: 'primary_image_key' },
];

/**
 * PERMANENT deletion of a clinic / veterinary office / farm
 * (`DELETE /admin/organizations/:id/permanent`, `organization.admin.delete`,
 * ADMIN-only — no supervisor domain grants it).
 *
 * Two-step by design: the regular admin "حذف" (soft delete → DEACTIVATED,
 * reversible) must have happened first, so this is never the first click.
 *
 *  - BLOCKED (409 `ORGANIZATION_PURGE_BLOCKED`): another type, an organization
 *    that is not DEACTIVATED, or one that holds pet owners' records
 *    ({@link PET_OWNER_RECORD_TABLES} live or archived, clinic appointments) —
 *    those stay soft-deleted: hidden everywhere, history intact.
 *  - REMOVED in ONE transaction: the organization's own operational data
 *    ({@link OWNED_RESTRICT_TABLES}), then the `organizations` row — the schema
 *    CASCADEs the rest (details + subscription dates, memberships + supervisor
 *    grants, follows, likes, reviews, renewal requests, org chat threads, terms
 *    acceptances, clinic access grants) and SET NULLs job offers' org link.
 *    Member / owner USER accounts are never touched.
 *  - KEPT: every audit entry (no FK — `entity_id` survives) plus a new
 *    `ORGANIZATION_PURGED` entry with name/type/owner and per-table counts.
 *    Old notifications keep their payload; the source resolver tolerates a
 *    missing organization.
 *
 * Media objects are deleted from storage after commit, best-effort.
 */
export class OrganizationPurgeService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'organization-purge' });
  }

  async purge(id: string, actor: OrgActor): Promise<OrganizationPurgeResult> {
    const removed: Record<string, number> = {};
    const mediaKeys: string[] = [];
    let ownerUserId = '';

    await this.db.transaction(async (tx) => {
      const org = await tx<{
        id: string;
        name: string;
        type: string;
        status: string;
        owner_user_id: string;
      }>('organizations')
        .where({ id })
        .forUpdate()
        .first('id', 'name', 'type', 'status', 'owner_user_id');
      if (!org) throw new NotFoundError('Organization not found');
      ownerUserId = org.owner_user_id;

      if (!(PURGEABLE_ORGANIZATION_TYPES as readonly string[]).includes(org.type)) {
        this.blocked(
          'TYPE_NOT_PURGEABLE',
          `Only clinics, veterinary offices and farms can be permanently deleted (this is a ${org.type})`,
        );
      }
      if (org.status !== 'DEACTIVATED') {
        this.blocked(
          'NOT_DELETED',
          'Delete the organization first; permanent deletion applies to a deleted organization only',
        );
      }

      const held: Record<string, number> = {};
      for (const table of [...PET_OWNER_RECORD_TABLES, 'clinic_appointments']) {
        const qb = tx(table).where('organization_id', id);
        if (table !== 'clinic_appointments') qb.orWhere('removed_from_organization_id', id);
        const row = (await qb.count<{ count: string }>({ count: '*' }).first()) as
          { count: string } | undefined;
        const n = Number(row?.count ?? 0);
        if (n > 0) held[table] = n;
      }
      if (Object.keys(held).length > 0) {
        this.blocked(
          'HOLDS_PET_OWNER_RECORDS',
          `The organization holds pet owners' records (${Object.entries(held)
            .map(([t, n]) => `${t}: ${n}`)
            .join(', ')}) — they are retained, so it stays deleted (hidden) instead`,
        );
      }

      for (const { table, column, array } of MEDIA_COLUMNS) {
        const values = (await tx(table).where('organization_id', id).pluck(column)) as Array<
          string | string[] | null
        >;
        for (const v of values) {
          if (array && Array.isArray(v)) mediaKeys.push(...v);
          else if (typeof v === 'string') mediaKeys.push(v);
        }
      }
      for (const table of ['veterinary_office_product_images', 'veterinary_store_product_images']) {
        const productTable = table.replace('_images', 's');
        const keys = (await tx(`${table} as i`)
          .join(`${productTable} as p`, 'p.id', 'i.product_id')
          .where('p.organization_id', id)
          .pluck('i.image_key')) as string[];
        mediaKeys.push(...keys);
      }

      for (const table of OWNED_RESTRICT_TABLES) {
        const n = await tx(table).where('organization_id', id).del();
        if (n > 0) removed[table] = n;
      }
      await tx('organizations').where({ id }).del();

      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_PURGED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: {
            name: org.name,
            type: org.type,
            ownerUserId: org.owner_user_id,
            removed,
            mediaObjects: mediaKeys.length,
          },
          context: actor.context,
        },
        tx,
      );
    });

    // After commit only: storage I/O and externally observable events.
    await deleteReplacedObjects(this.storage, this.log, mediaKeys, [], {
      purgedOrganizationId: id,
    });
    this.events.publish('organization.purged', { organizationId: id, ownerUserId });
    return { id, deleted: true, removed };
  }

  private blocked(rule: OrganizationPurgeBlockRule, message: string): never {
    throw new ConflictError(message, {
      code: ErrorCode.ORGANIZATION_PURGE_BLOCKED,
      details: [{ rule, message }],
    });
  }
}
