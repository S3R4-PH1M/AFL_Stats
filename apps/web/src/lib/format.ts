/**
 * Display formatting. The published files hold raw values; presentation lives here (§12).
 */
const DASH = '–';

/** AFL score, e.g. `11.15 (81)`. */
export function formatScore(goals: number, behinds: number, points: number): string {
  return `${goals}.${behinds} (${points})`;
}

/** Ladder percentage to 2 dp; a dash when there are no points against yet. */
export function formatPercentage(percentage: number | null): string {
  return percentage === null ? DASH : percentage.toFixed(2);
}

/** A stat value; a dash outside the stat's coverage (NULL). */
export function formatStat(value: number | null): string {
  return value === null ? DASH : String(value);
}

const attendanceFormat = new Intl.NumberFormat('en-AU');

export function formatAttendance(attendance: number | null): string {
  return attendance === null ? DASH : attendanceFormat.format(attendance);
}
