export interface ZonedClock {
  timezone: string;
  dateKey: string;
  hhmm: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function normalizeTimezone(timezone?: string): string {
  const candidate = (timezone || '').trim() || 'Asia/Riyadh';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

export function getClockInTimezone(timezone?: string, now: Date | number = Date.now()): ZonedClock {
  const validTz = normalizeTimezone(timezone);
  const date = typeof now === 'number' ? new Date(now) : now;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const getNum = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0');
  const getStr = (type: string) => parts.find((p) => p.type === type)?.value || '00';

  const rawHour = getStr('hour');
  const hourStr = rawHour === '24' ? '00' : rawHour;
  const minuteStr = getStr('minute');
  const yearStr = getStr('year');
  const monthStr = getStr('month');
  const dayStr = getStr('day');

  return {
    timezone: validTz,
    dateKey: `${yearStr}-${monthStr}-${dayStr}`,
    hhmm: `${hourStr}:${minuteStr}`,
    year: getNum('year'),
    month: getNum('month'),
    day: getNum('day'),
    hour: rawHour === '24' ? 0 : Number(rawHour),
    minute: Number(minuteStr),
  };
}

export function hhmmToMinutes(hhmm: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((hhmm || '').trim());
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidHHMM(hhmm: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test((hhmm || '').trim());
}

export function isWithinQuietHours(nowHHMM: string, start: string, end: string): boolean {
  const cur = hhmmToMinutes(nowHHMM);
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (cur < 0 || s < 0 || e < 0 || s === e) return false;
  if (s < e) {
    return cur >= s && cur < e;
  }
  return cur >= s || cur < e;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days, 0, 0, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Resolves a local wall-clock (YYYY-MM-DD, HH:MM) in an IANA timezone to UTC milliseconds.
 * Handles fixed offsets (like Asia/Riyadh UTC+3 across midnight) and DST Spring/Fall transitions.
 */
export function zonedDateTimeToUtcMs(
  timezone: string,
  dateKey: string,
  hhmm: string
): number {
  const validTz = normalizeTimezone(timezone);
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);

  const targetPseudoUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guessUtc = targetPseudoUtc;

  for (let i = 0; i < 4; i++) {
    const actual = getClockInTimezone(validTz, guessUtc);
    const actualPseudoUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
      0
    );
    const deltaMs = targetPseudoUtc - actualPseudoUtc;
    if (deltaMs === 0) {
      break;
    }
    guessUtc += deltaMs;
  }

  return guessUtc;
}

export interface NextDueInput {
  enabled: boolean;
  timeHHMM: string;
  timezone: string;
  nowMs: number;
  completedDateKey?: string | null;
  forceAfterDateKey?: string | null;
  /**
   * When registering/updating preferences, allow a small window (e.g. 60s)
   * if the user picked the current minute so the next minute tick can still catch it.
   */
  sameMinuteGraceMs?: number;
}

/**
 * Computes the next scheduled UTC timestamp (ms) for a reminder period.
 * Returns null if the period is disabled or time is invalid.
 */
export function computeNextDueUtcMs(input: NextDueInput): number | null {
  if (!input.enabled || !isValidHHMM(input.timeHHMM)) {
    return null;
  }

  const validTz = normalizeTimezone(input.timezone);
  const todayClock = getClockInTimezone(validTz, input.nowMs);
  const graceMs = input.sameMinuteGraceMs ?? 0;

  let candidateDateKey = todayClock.dateKey;
  if (
    input.forceAfterDateKey &&
    candidateDateKey <= input.forceAfterDateKey
  ) {
    candidateDateKey = addDaysToDateKey(input.forceAfterDateKey, 1);
  }

  for (let offset = 0; offset < 4; offset++) {
    const dateKey = offset === 0 ? candidateDateKey : addDaysToDateKey(candidateDateKey, offset);
    if (input.completedDateKey && dateKey === input.completedDateKey) {
      continue;
    }
    const utcMs = zonedDateTimeToUtcMs(validTz, dateKey, input.timeHHMM);
    if (utcMs + graceMs >= input.nowMs) {
      return utcMs;
    }
  }

  // Fallback: next day
  const tomorrow = addDaysToDateKey(todayClock.dateKey, 1);
  return zonedDateTimeToUtcMs(validTz, tomorrow, input.timeHHMM);
}
