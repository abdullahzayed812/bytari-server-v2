import { z } from 'zod';

// --- join flow ---------------------------------------------------

export const joinFarmBodySchema = z.object({
  joinCode: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .transform((s) => s.toUpperCase()),
});
export type JoinFarmBody = z.infer<typeof joinFarmBodySchema>;
