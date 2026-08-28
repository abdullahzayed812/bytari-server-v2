import { z } from 'zod';

/** Reusable pagination query schema. Merge into route query schemas. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  total: number;
}

/** Build the `meta` block for a paginated success envelope. */
export function pageMeta(page: number, pageSize: number, total: number): Record<string, unknown> {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function offset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
