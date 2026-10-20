import type { Knex } from 'knex';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes LIKE wildcards so a user's `%` / `_` match literally (Postgres' default escape is `\`). */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface TextSearchSpec {
  /** Columns matched with a case-insensitive "contains" (cast to text, so citext / enums work too). */
  columns: readonly string[];
  /** `[first, last]` pairs also matched as one "first last" string — "أحمد علي" finds both names. */
  fullNames?: ReadonlyArray<readonly [string, string]>;
  /** uuid columns matched EXACTLY when the term is a full uuid (an id pasted from a link / audit row). */
  ids?: readonly string[];
}

/**
 * The admin-list search predicate: one `AND (… OR …)` group over the given
 * columns. Used by every admin management list so search behaves the same in
 * each section (contains, case-insensitive, wildcards escaped, Arabic matched
 * as typed). A blank term adds nothing.
 */
export function whereTextSearch(
  qb: Knex.QueryBuilder,
  term: string | undefined,
  spec: TextSearchSpec,
): void {
  const t = term?.trim();
  if (!t) return;
  const like = `%${escapeLike(t)}%`;
  const isUuid = UUID_RE.test(t);
  void qb.where((w) => {
    for (const col of spec.columns) void w.orWhereRaw('??::text ilike ?', [col, like]);
    for (const [first, last] of spec.fullNames ?? []) {
      void w.orWhereRaw("concat_ws(' ', ??, ??) ilike ?", [first, last, like]);
    }
    if (isUuid) for (const col of spec.ids ?? []) void w.orWhere(col, t);
  });
}

/** A `users` row's searchable identity (name, email, phone, id) under `alias`. */
export function userSearchSpec(alias = 'users'): TextSearchSpec {
  return {
    columns: [`${alias}.email`, `${alias}.phone`, `${alias}.first_name`, `${alias}.last_name`],
    fullNames: [[`${alias}.first_name`, `${alias}.last_name`]],
    ids: [`${alias}.id`],
  };
}

/** Sub-select of the ids of users matching `term` — for "owner / author / sender" search. */
export function matchingUserIds(db: Knex | Knex.Transaction, term: string): Knex.QueryBuilder {
  const sub = db('users').select('users.id');
  whereTextSearch(sub, term, userSearchSpec('users'));
  return sub;
}
