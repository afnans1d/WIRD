import type { SessionProgress, UserPreferencesState } from './storage';

export type AdhkarPeriod = 'morning' | 'evening';

export type SkipReason =
  | 'no_permission'
  | 'opted_out'
  | 'quiet_hours'
  | 'disabled'
  | 'completed_today'
  | 'already_notified'
  | 'not_due_yet';

export interface ReminderEvaluationInput {
  prefs: UserPreferencesState;
  sessions: Record<AdhkarPeriod, SessionProgress | null>;
  notifiedMap: Record<string, boolean>;
  optedOut: boolean;
  permission: NotificationPermission | 'unsupported';
  now?: Date;
  graceMinutes?: number;
}

export interface ReminderEvaluationResult {
  dateKey: string;
  hhmm: string;
  duePeriods: AdhkarPeriod[];
  skipped: Record<AdhkarPeriod, SkipReason | null>;
}

export function getClockInTimezone(
  timezone?: string,
  now: Date = new Date()
): { dateKey: string; hhmm: string } {
  let validTz = timezone?.trim() || 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: validTz });
  } catch {
    validTz = 'UTC';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${hour}:${get('minute')}`,
  };
}

export function hhmmToMinutes(hhmm: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((hhmm || '').trim());
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
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

/**
 * Forward-only due check: never fires early before target time,
 * and triggers once within [0, graceMinutes] after the scheduled minute.
 */
export function isScheduledTimeReached(
  nowHHMM: string,
  targetHHMM: string,
  graceMinutes = 15
): boolean {
  const cur = hhmmToMinutes(nowHHMM);
  const target = hhmmToMinutes(targetHHMM);
  if (cur < 0 || target < 0) return false;
  const elapsed = (1440 + cur - target) % 1440;
  return elapsed <= graceMinutes;
}

export function evaluateDueReminders(
  input: ReminderEvaluationInput
): ReminderEvaluationResult {
  const {
    prefs,
    sessions,
    notifiedMap,
    optedOut,
    permission,
    now = new Date(),
    graceMinutes = 15,
  } = input;

  const { dateKey, hhmm } = getClockInTimezone(prefs.timezone, now);
  const skipped: Record<AdhkarPeriod, SkipReason | null> = {
    morning: null,
    evening: null,
  };
  const duePeriods: AdhkarPeriod[] = [];

  if (permission !== 'granted') {
    return {
      dateKey,
      hhmm,
      duePeriods,
      skipped: { morning: 'no_permission', evening: 'no_permission' },
    };
  }

  if (optedOut) {
    return {
      dateKey,
      hhmm,
      duePeriods,
      skipped: { morning: 'opted_out', evening: 'opted_out' },
    };
  }

  if (
    prefs.quietHoursEnabled &&
    isWithinQuietHours(hhmm, prefs.quietHoursStart, prefs.quietHoursEnd)
  ) {
    return {
      dateKey,
      hhmm,
      duePeriods,
      skipped: { morning: 'quiet_hours', evening: 'quiet_hours' },
    };
  }

  const periods: Array<{ period: AdhkarPeriod; enabled: boolean; time: string }> = [
    { period: 'morning', enabled: prefs.morningEnabled, time: prefs.morningTime },
    { period: 'evening', enabled: prefs.eveningEnabled, time: prefs.eveningTime },
  ];

  for (const item of periods) {
    if (!item.enabled) {
      skipped[item.period] = 'disabled';
      continue;
    }

    const session = sessions[item.period];
    if (session && session.dateKey === dateKey && session.isCompleted) {
      skipped[item.period] = 'completed_today';
      continue;
    }

    const dedupeKey = `${dateKey}:${item.period}`;
    if (notifiedMap[dedupeKey]) {
      skipped[item.period] = 'already_notified';
      continue;
    }

    if (!isScheduledTimeReached(hhmm, item.time, graceMinutes)) {
      skipped[item.period] = 'not_due_yet';
      continue;
    }

    duePeriods.push(item.period);
  }

  return {
    dateKey,
    hhmm,
    duePeriods,
    skipped,
  };
}
