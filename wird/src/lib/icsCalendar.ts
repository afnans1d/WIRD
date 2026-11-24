import { getClockInTimezone } from './reminderScheduler';
import type { UserPreferencesState } from './storage';

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function formatUtcStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function addMinutesToHHMM(hhmm: string, addMinutes: number): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  const total = (h * 60 + m + addMinutes) % 1440;
  const nextH = String(Math.floor(total / 60)).padStart(2, '0');
  const nextM = String(total % 60).padStart(2, '0');
  return `${nextH}${nextM}00`;
}

export function buildAdhkarCalendarIcs(
  prefs: UserPreferencesState,
  appOrigin = 'https://gen-lang-client-0521174523.web.app',
  now: Date = new Date()
): string {
  const cleanOrigin = appOrigin.replace(/\/+$/, '');
  const { dateKey } = getClockInTimezone(prefs.timezone, now);
  const dateCompact = dateKey.replace(/-/g, '');
  const dtStamp = formatUtcStamp(now);
  const safeTz = (prefs.timezone || 'Asia/Riyadh').replace(/[^a-zA-Z0-9_\/+\-]/g, '');

  const events: string[] = [];

  const items: Array<{
    enabled: boolean;
    uid: string;
    time: string;
    summary: string;
    description: string;
    url: string;
  }> = [
    {
      enabled: prefs.morningEnabled,
      uid: 'wird-morning-adhkar@wird.app',
      time: prefs.morningTime,
      summary: 'وِرد · أذكار الصباح',
      description: `حان وقت أذكار الصباح حفظك الله.\nافتح وِرد الآن: ${cleanOrigin}/?session=morning`,
      url: `${cleanOrigin}/?session=morning`,
    },
    {
      enabled: prefs.eveningEnabled,
      uid: 'wird-evening-adhkar@wird.app',
      time: prefs.eveningTime,
      summary: 'وِرد · أذكار المساء',
      description: `حان وقت أذكار المساء حفظك الله.\nافتح وِرد الآن: ${cleanOrigin}/?session=evening`,
      url: `${cleanOrigin}/?session=evening`,
    },
  ];

  for (const item of items) {
    if (!item.enabled) continue;
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(item.time);
    const hhmm = match ? `${match[1]}:${match[2]}` : '06:00';
    const startCompact = `${hhmm.replace(':', '')}00`;
    const endCompact = addMinutesToHHMM(hhmm, 10);

    events.push(
      [
        'BEGIN:VEVENT',
        `UID:${item.uid}`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART;TZID=${safeTz}:${dateCompact}T${startCompact}`,
        `DTEND;TZID=${safeTz}:${dateCompact}T${endCompact}`,
        'RRULE:FREQ=DAILY',
        `SUMMARY:${escapeIcsText(item.summary)}`,
        `DESCRIPTION:${escapeIcsText(item.description)}`,
        `URL:${item.url}`,
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(item.summary)}`,
        'TRIGGER:PT0M',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n')
    );
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WIRD//Adhkar Reminders//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('تذكيرات وِرد — أذكار الصباح والمساء')}`,
    `X-WR-TIMEZONE:${safeTz}`,
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function downloadAdhkarCalendarIcs(prefs: UserPreferencesState): boolean {
  if (!prefs.morningEnabled && !prefs.eveningEnabled) {
    return false;
  }
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://gen-lang-client-0521174523.web.app';
  const icsContent = buildAdhkarCalendarIcs(prefs, origin);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'wird-adhkar-reminders.ics';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
