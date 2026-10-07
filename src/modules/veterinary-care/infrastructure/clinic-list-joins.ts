import type { Knex } from 'knex';
import type {
  ClinicListAnimalSummary,
  ClinicListOwnerSummary,
} from '../domain/veterinary-care.types.js';

/**
 * Shared joins for the clinic-wide lists (vaccinations / reminders, legacy
 * `clinic-vaccinations` / `clinic-reminders` screens): each row carries the
 * animal summary and its CURRENT owner's name + phone.
 *
 * The inner join on an ACTIVE `animal_clinic_access` grant for the SAME clinic
 * is the privacy gate: a clinic only ever sees rows (and owner contact) for
 * animals it currently treats — revoking access hides them immediately.
 */
export function joinClinicAnimalAndOwner(
  qb: Knex.QueryBuilder,
  alias: string,
  organizationId: string,
): Knex.QueryBuilder {
  return qb
    .join('animals as a', 'a.id', `${alias}.animal_id`)
    .join('animal_clinic_access as ac', function joinGrant() {
      this.on('ac.animal_id', '=', `${alias}.animal_id`)
        .andOn('ac.organization_id', '=', `${alias}.organization_id`)
        .andOnVal('ac.status', '=', 'ACTIVE');
    })
    .leftJoin('animal_ownerships as ow', function joinOwner() {
      this.on('ow.animal_id', '=', `${alias}.animal_id`).andOnNull('ow.ended_at');
    })
    .leftJoin('users as u', 'u.id', 'ow.owner_user_id')
    .where(`${alias}.organization_id`, organizationId)
    .andWhere('a.listing_only', false);
}

export const CLINIC_LIST_JOIN_COLUMNS = [
  'a.name as a_name',
  'a.species as a_species',
  'a.breed as a_breed',
  'u.id as u_id',
  'u.first_name as u_first_name',
  'u.last_name as u_last_name',
  'u.phone as u_phone',
] as const;

export interface ClinicListJoinColumns {
  a_name: string;
  a_species: string;
  a_breed: string | null;
  u_id: string | null;
  u_first_name: string | null;
  u_last_name: string | null;
  u_phone: string | null;
}

export function readClinicListJoin(
  animalId: string,
  row: ClinicListJoinColumns,
): { animal: ClinicListAnimalSummary; owner: ClinicListOwnerSummary | null } {
  return {
    animal: { id: animalId, name: row.a_name, species: row.a_species, breed: row.a_breed },
    owner: row.u_id
      ? {
          id: row.u_id,
          firstName: row.u_first_name ?? '',
          lastName: row.u_last_name ?? '',
          phone: row.u_phone,
        }
      : null,
  };
}
