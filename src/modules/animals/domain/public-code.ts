/**
 * Short public pet identifier (`animals.public_code`). Generated in the
 * database (migration `20261103010000`): 7 symbols from this alphabet, which
 * drops the look-alikes 0/O, 1/I/L and U so a code survives being read out loud
 * or copied by hand. Stored upper-case without separators; shown as `ABC-DEFG`.
 */
export const PUBLIC_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PUBLIC_CODE_LENGTH = 7;

const CODE_RE = new RegExp(`^[${PUBLIC_CODE_ALPHABET}]{${PUBLIC_CODE_LENGTH}}$`);

/**
 * Normalise user input (any case, spaces / dashes / a leading `#`) to the
 * stored form, or `null` when it cannot be a public code.
 */
export function normalizePublicCode(input: string): string | null {
  const compact = input.replace(/[\s\-_#]/g, '').toUpperCase();
  return CODE_RE.test(compact) ? compact : null;
}
