import type { Knex } from 'knex';

/** Who created a record — display name only (never contact data or credentials). */
export interface CreatorSummary {
  id: string;
  firstName: string;
  lastName: string;
}

type WithCreatorId = { createdByUserId?: string | null; createdBy?: unknown };

/**
 * Batched id → name lookup used to show "أضيف بواسطة: …" on records that
 * store only `created_by_user_id` (set server-side from the authenticated
 * actor — never client-supplied). One query per response, no N+1.
 */
export class UserNameDirectory {
  constructor(private readonly db: Knex) {}

  async namesFor(ids: string[]): Promise<Map<string, CreatorSummary>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows: Array<{ id: string; first_name: string; last_name: string }> = await this.db(
      'users',
    )
      .whereIn('id', unique)
      .select('id', 'first_name', 'last_name');
    return new Map(
      rows.map((r) => [r.id, { id: r.id, firstName: r.first_name, lastName: r.last_name }]),
    );
  }

  /**
   * Adds `createdBy` to a DTO, or to every DTO of an array, that carries
   * `createdByUserId` and no `createdBy` yet. Anything else passes through.
   */
  async attach<T>(value: T): Promise<T> {
    const items = (Array.isArray(value) ? value : [value]) as unknown[];
    const targets = items.filter(
      (v): v is WithCreatorId =>
        typeof v === 'object' && v !== null && 'createdByUserId' in v && !('createdBy' in v),
    );
    if (targets.length === 0) return value;
    const names = await this.namesFor(
      targets.map((t) => t.createdByUserId).filter((id): id is string => typeof id === 'string'),
    );
    const enrich = (v: unknown): unknown =>
      targets.includes(v as WithCreatorId)
        ? {
            ...(v as object),
            createdBy: (v as WithCreatorId).createdByUserId
              ? (names.get((v as WithCreatorId).createdByUserId as string) ?? null)
              : null,
          }
        : v;
    return (Array.isArray(value) ? value.map(enrich) : enrich(value)) as T;
  }
}
