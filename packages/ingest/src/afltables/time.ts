/**
 * Match start time from the page's own date string (proposal §6.4.6).
 *
 * The main time is venue-local. A bracketed second time, shown only when it differs, is the same
 * moment in AEST (UTC+10, no daylight saving). So the start is the bracket time − 10 h, or the
 * local time − 10 h when there's no bracket. The bracket carries no date: the AEST − local
 * difference is wrapped into ±12 h, which rolls a Perth night game (10:20 PM (12:20 AM)) into the
 * next AEST day while keeping a daylight-saving venue (1:20 PM (12:20 PM)) on the same day.
 *
 * This is the fallback: Squiggle's `unixtime` is joined in M1d and stays the primary source.
 * Match pages write the weekday as `Sat, `, season pages as `Sat ` (no comma); both are accepted.
 */

export interface PageDateTime {
  /** Venue-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Venue-local date and time as shown, without the bracketed AEST time. */
  localTime: string;
  /** ISO instant. */
  startUtc: string;
}

export class PageDateError extends Error {
  constructor(text: string) {
    super(`Unrecognised AFL Tables date "${text}"`);
    this.name = 'PageDateError';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_TIME =
  /^((?:[A-Z][a-z]{2},? )?(\d{1,2})-([A-Z][a-z]{2})-(\d{4}) (\d{1,2}):(\d{2}) ([AP]M))(?: \((\d{1,2}):(\d{2}) ([AP]M)\))?$/;
const AEST_OFFSET_MIN = 10 * 60;
const DAY_MIN = 24 * 60;

export function parsePageDateTime(text: string): PageDateTime {
  const m = DATE_TIME.exec(text.trim());
  if (!m) throw new PageDateError(text);
  const [, localTime = '', day, mon, year, hh, mm, ap, bh, bm, bap] = m;
  const month = MONTHS.indexOf(mon ?? '');
  const midnightUtc = Date.UTC(Number(year), month, Number(day));
  const check = new Date(midnightUtc);
  if (month < 0 || check.getUTCDate() !== Number(day) || check.getUTCMonth() !== month) {
    throw new PageDateError(text);
  }

  const local = minutesOfDay(hh, mm, ap, text);
  let delta = 0;
  if (bh !== undefined) {
    delta = minutesOfDay(bh, bm, bap, text) - local;
    if (delta > DAY_MIN / 2) delta -= DAY_MIN;
    if (delta < -DAY_MIN / 2) delta += DAY_MIN;
  }
  const startMs = midnightUtc + (local + delta - AEST_OFFSET_MIN) * 60_000;
  return {
    date: new Date(midnightUtc).toISOString().slice(0, 10),
    localTime,
    startUtc: new Date(startMs).toISOString(),
  };
}

function minutesOfDay(
  hours: string | undefined,
  minutes: string | undefined,
  ampm: string | undefined,
  text: string,
): number {
  const h = Number(hours);
  const min = Number(minutes);
  if (h < 1 || h > 12 || min > 59) throw new PageDateError(text);
  return ((h % 12) + (ampm === 'PM' ? 12 : 0)) * 60 + min;
}
