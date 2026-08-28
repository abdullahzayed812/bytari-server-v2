import type { Knex } from 'knex';

/**
 * Select a single (possibly table-qualified) column and return its values as a
 * plain array. A typed, alias-safe replacement for `knex.pluck`, whose generic
 * signature does not play well with `strict` + our lint rules.
 */
export async function pluckColumn<T = string>(qb: Knex.QueryBuilder, column: string): Promise<T[]> {
  const rows: Array<Record<string, unknown>> = await qb.select({ __value: column });
  return rows.map((row) => row.__value as T);
}
