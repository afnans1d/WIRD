/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdhkarCalendarIcs } from '../src/lib/icsCalendar.ts';
import {
  evaluateDueReminders,
  getClockInTimezone,
  isScheduledTimeReached,
  isWithinQuietHours,
} from '../src/lib/reminderScheduler.ts';
import type { SessionProgress, UserPreferencesState } from '../src/lib/storage.ts';

function makePrefs(overrides: Partial<UserPreferencesState> = {}): UserPreferencesState {
  return {
    theme: 'light',
    fontSize: 'lg',
    hapticsEnabled: true,
    reducedMotion: false,
    quietModeDefault: false,
    morningEnabled: true,
    eveningEnabled: true,
    morningTime: '06:00',
    eveningTime: '17:30',
    timezone: 'Asia/Riyadh',
    quietHoursEnabled: true,
    quietHoursStart: '23:00',
    quietHoursEnd: '04:30',
    ...overrides,
  };
}

const emptySessions: Record<'morning' | 'evening', SessionProgress | null> = {
  morning: null,
  evening: null,
};

test('timezone clock calculation resolves Asia/Riyadh (UTC+3) accurately', () => {
  // 03:00 UTC === 06:00 Asia/Riyadh
  const now = new Date('2026-11-24T03:00:00Z');
  const clock = getClockInTimezone('Asia/Riyadh', now);
  assert.equal(clock.dateKey, '2026-11-24');
  assert.equal(clock.hhmm, '06:00');
});

test('fires due morning notification at scheduled time and within catch-up window, never early', () => {
  const prefs = makePrefs();

  // 05:59 Asia/Riyadh (02:59 UTC) -> must NOT fire early
  const early = evaluateDueReminders({
    prefs,
    sessions: emptySessions,
    notifiedMap: {},
    optedOut: false,
    permission: 'granted',
    now: new Date('2026-11-24T02:59:00Z'),
  });
  assert.deepEqual(early.duePeriods, []);
  assert.equal(early.skipped.morning, 'not_due_yet');

  // 06:00 Asia/Riyadh (03:00 UTC) -> fires morning
  const exact = evaluateDueReminders({
    prefs,
    sessions: emptySessions,
    notifiedMap: {},
    optedOut: false,
    permission: 'granted',
    now: new Date('2026-11-24T03:00:00Z'),
  });
  assert.deepEqual(exact.duePeriods, ['morning']);

  // 06:10 Asia/Riyadh (03:10 UTC) -> still eligible within 15-min window if not yet notified
  const catchUp = evaluateDueReminders({
    prefs,
    sessions: emptySessions,
    notifiedMap: {},
    optedOut: false,
    permission: 'granted',
    now: new Date('2026-11-24T03:10:00Z'),
  });
  assert.deepEqual(catchUp.duePeriods, ['morning']);
});

test('prevents duplicate notifications for the same day and period', () => {
  const prefs = makePrefs();
  const res = evaluateDueReminders({
    prefs,
    sessions: emptySessions,
    notifiedMap: { '2026-11-24:morning': true },
    optedOut: false,
    permission: 'granted',
    now: new Date('2026-11-24T03:02:00Z'),
  });
  assert.deepEqual(res.duePeriods, []);
  assert.equal(res.skipped.morning, 'already_notified');
});

test('respects disabled period toggles and global notification opt-out', () => {
  // Disabled morning toggle
  const disabledMorning = evaluateDueReminders({
    prefs: makePrefs({ morningEnabled: false }),
    sessions: emptySessions,
    notifiedMap: {},
    optedOut: false,
    permission: 'granted',
    now: new Date('2026-11-24T03:00:00Z'),
  });
  assert.deepEqual(disabledMorning.duePeriods, []);
  assert.equal(disabledMorning.skipped.morning, 'disabled');

  // Global opt-out
  const optedOut = evaluateDueReminders({
    prefs: makePrefs(),
    sessions: emptySessions,
    notifiedMap: {},
    optedOut: true,
    permission: 'granted',
    now: new Date('2026-11-24T03:00:00Z'),
  });
  assert.deepEqual(optedOut.duePeriods, []);
  assert.equal(optedOut.skipped.morning, 'opted_out');
  assert.equal(optedOut.skipped.evening, 'opted_out');
});

test('respects quiet hours including midnight wrap-around', () => {
  assert.equal(isWithinQuietHours('23:30', '23:00', '04:30'), true);
  assert.equal(isWithinQuietHours('03:15', '23:00', '04:30'), true);
  assert.equal(isWithinQuietHours('04:30', '23:00', '04:30'), false);
  assert.equal(isWithinQuietHours('14:00', '13:00', '15:00'), true);

  // Morning scheduled at 04:00 while quiet hours 23:00..04:30 are enabled -> blocked
  const res = evaluateDueReminders({
    prefs: makePrefs({ morningTime: '04:00', quietHoursEnabled: true }),
    sessions: emptySessions,
    notifiedMap: {},
    optedOut: false,
    permission: 'granted',
    now: new Date('2026-11-24T01:00:00Z'), // 04:00 Riyadh
  });
  assert.deepEqual(res.duePeriods, []);
  assert.equal(res.skipped.morning, 'quiet_hours');
});

test('suppresses reminder when daily Adhkar session is already completed', () => {
  const prefs = makePrefs();
  const res = evaluateDueReminders({
    prefs,
    sessions: {
      morning: {
        period: 'morning',
        dateKey: '2026-11-24',
        currentIndex: 24,
        counts: {},
        completedIds: ['1'],
        skippedIds: [],
        isCompleted: true,
        updatedAt: '2026-11-24T02:30:00Z',
      },
      evening: null,
    },
    notifiedMap: {},
    optedOut: false,
    permission: 'granted',
    now: new Date('2026-11-24T03:00:00Z'),
  });
  assert.deepEqual(res.duePeriods, []);
  assert.equal(res.skipped.morning, 'completed_today');
});

test('midnight time boundary forward check works cleanly', () => {
  assert.equal(isScheduledTimeReached('00:05', '23:55', 15), true);
  assert.equal(isScheduledTimeReached('23:50', '23:55', 15), false);
});

test('generates valid RFC 5545 .ics calendar file for enabled reminders only', () => {
  const icsBoth = buildAdhkarCalendarIcs(
    makePrefs({ morningTime: '05:30', eveningTime: '17:45' }),
    'https://gen-lang-client-0521174523.web.app',
    new Date('2026-11-24T03:00:00Z')
  );
  assert.ok(icsBoth.includes('BEGIN:VCALENDAR\r\n'));
  assert.ok(icsBoth.includes('UID:wird-morning-adhkar@wird.app\r\n'));
  assert.ok(icsBoth.includes('UID:wird-evening-adhkar@wird.app\r\n'));
  assert.ok(icsBoth.includes('DTSTART;TZID=Asia/Riyadh:20261124T053000\r\n'));
  assert.ok(icsBoth.includes('DTSTART;TZID=Asia/Riyadh:20261124T174500\r\n'));
  assert.ok(icsBoth.includes('RRULE:FREQ=DAILY\r\n'));
  assert.ok(icsBoth.includes('BEGIN:VALARM\r\n'));
  assert.ok(icsBoth.includes('URL:https://gen-lang-client-0521174523.web.app/?session=morning\r\n'));
  assert.ok(icsBoth.includes('URL:https://gen-lang-client-0521174523.web.app/?session=evening\r\n'));

  const icsMorningOnly = buildAdhkarCalendarIcs(
    makePrefs({ eveningEnabled: false }),
    'https://gen-lang-client-0521174523.web.app',
    new Date('2026-11-24T03:00:00Z')
  );
  assert.ok(icsMorningOnly.includes('UID:wird-morning-adhkar@wird.app'));
  assert.equal(icsMorningOnly.includes('UID:wird-evening-adhkar@wird.app'), false);
});
