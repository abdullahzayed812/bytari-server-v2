import type { Knex } from 'knex';

/**
 * Batch `organization_id → name` lookup for the owner-facing veterinary-care
 * reads. A pet owner is shown WHICH CLINIC added a vaccination / reminder,
 * never which veterinarian (`recordedByUserId` is withheld from owner DTOs);
 * clinic members keep the veterinarian through the clinic-scoped routes.
 */
export class ClinicNameLookup {
  constructor(private readonly db: Knex) {}

  async byIds(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const rows: { id: string; name: string }[] = await this.db('organizations')
      .whereIn('id', unique)
      .select('id', 'name');
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
