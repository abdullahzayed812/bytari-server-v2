const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
};

/**
 * Parse a short duration string (`"15m"`, `"30d"`, `"1h"`, `"45s"`, `"2w"`) or a
 * bare integer (seconds) into a number of seconds.
 */
export function durationToSeconds(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const match = /^(\d+)\s*(s|m|h|d|w)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration: "${value}" (expected e.g. "15m", "30d", "3600")`);
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? 's';
  return amount * (UNIT_SECONDS[unit] ?? 1);
}

export function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
