import { Logger } from '@nestjs/common';

/**
 * tz-util
 * -------
 * Convert a tenant-local wall-clock (e.g. "08:00 on 2026-05-30") into a UTC
 * Date for storage in CareReminderOccurrence.dueAt.
 *
 * Uses Intl.DateTimeFormat to avoid pulling in date-fns-tz or moment-timezone.
 * Asia/Shanghai is the system default. The function does NOT depend on the
 * server clock's timezone — same input → same UTC output regardless of where
 * the Nest process is running.
 *
 * Approach:
 *   1. Build a Date that *naively* represents the local wall-clock as if it
 *      were UTC (so its UTC components match the wall-clock string).
 *   2. Ask Intl what UTC instant the *real* tenant TZ produces for that
 *      wall-clock by reading back the formatted parts of a candidate UTC
 *      instant.
 *   3. The offset between the two gives us the correction.
 *
 * Asia/Shanghai has no DST, so the offset is constant +08:00, but the algorithm
 * is DST-safe so we don't have to special-case it.
 */

const log = new Logger('care-reminders/tz');

export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "08:00" → { h: 8, m: 0 }; returns null if malformed. */
export function parseHm(hm: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

/**
 * Compute UTC offset (in minutes east of UTC) for a given IANA timezone at a
 * given UTC instant. Asia/Shanghai → 480.
 */
export function utcOffsetMinutes(timezone: string, utcInstant: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = fmt.formatToParts(utcInstant);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const y = get('year');
    const mo = get('month');
    const d = get('day');
    let h = get('hour');
    const mi = get('minute');
    const s = get('second');
    if (h === 24) h = 0;
    const asIfUtc = Date.UTC(y, mo - 1, d, h, mi, s);
    return Math.round((asIfUtc - utcInstant.getTime()) / 60000);
  } catch (e) {
    log.warn(`utcOffsetMinutes(${timezone}): ${(e as Error).message}; falling back to UTC.`);
    return 0;
  }
}

/**
 * Given a YYYY-MM-DD calendar date in a tenant timezone + a "HH:MM" wall-clock,
 * return the corresponding UTC Date.
 *
 * Example:
 *   localDateInTzToUtc("2026-05-30", "08:00", "Asia/Shanghai")
 *   → 2026-05-30T00:00:00.000Z   (08:00 +08:00 = 00:00 UTC)
 */
export function localDateInTzToUtc(
  isoDate: string,
  hm: string,
  timezone: string,
): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const hmParsed = parseHm(hm);
  if (!dm || !hmParsed) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);

  // Candidate "as-if-UTC" for the wall clock.
  const naive = new Date(Date.UTC(y, mo - 1, d, hmParsed.h, hmParsed.m, 0));
  // What does the tenant timezone show at that UTC instant?
  const offsetAtNaive = utcOffsetMinutes(timezone, naive);
  // Real UTC instant = naive - tenant_offset.
  // (Asia/Shanghai offset +480 → subtract 480 min → 08:00 local becomes 00:00 UTC.)
  const candidate = new Date(naive.getTime() - offsetAtNaive * 60000);
  // For DST boundaries the offset might shift between naive and candidate;
  // recompute once to converge.
  const offsetAtCandidate = utcOffsetMinutes(timezone, candidate);
  if (offsetAtCandidate !== offsetAtNaive) {
    return new Date(naive.getTime() - offsetAtCandidate * 60000);
  }
  return candidate;
}

/** Current tenant-local date (YYYY-MM-DD) at the current UTC instant. */
export function tenantTodayIso(timezone: string, now: Date = new Date()): string {
  const offsetMin = utcOffsetMinutes(timezone, now);
  const localMs = now.getTime() + offsetMin * 60000;
  return new Date(localMs).toISOString().slice(0, 10);
}

/** Iterate ISO dates [start, start+N) inclusive in the tenant timezone. */
export function tenantDatesAhead(timezone: string, days: number, now: Date = new Date()): string[] {
  const today = tenantTodayIso(timezone, now);
  const base = new Date(today + 'T00:00:00Z');
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Asia/Shanghai day-of-week label for an ISO date. */
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export function dayOfWeekFromIso(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  return DOW[d.getUTCDay()];
}
