import { z } from 'zod';

/**
 * An optional http(s) link attached to a broadcast / message. Only web URLs —
 * `javascript:`, `intent:`, deep links and the like are rejected so a tap can
 * never run anything other than opening a browser.
 */
export const linkUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), { message: 'Only http(s) links are allowed' });
