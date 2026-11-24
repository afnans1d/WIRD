export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSizeScale = 'sm' | 'md' | 'lg' | 'xl';

export interface UserPreferencesState {
  theme: ThemeMode;
  fontSize: FontSizeScale;
  hapticsEnabled: boolean;
  reducedMotion: boolean;
  quietModeDefault: boolean;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  morningTime: string;
  eveningTime: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface SessionProgress {
  period: 'morning' | 'evening';
  dateKey: string;
  currentIndex: number;
  counts: Record<string, number>;
  completedIds: string[];
  skippedIds: string[];
  isCompleted: boolean;
  updatedAt: string;
}

export interface HistoryRecord {
  id: string;
  period: 'morning' | 'evening';
  dateKey: string;
  completedCount: number;
  totalCount: number;
  skippedCount: number;
  completedAt: string;
}

const KEYS = {
  DEVICE_ID: 'wird_device_id_v1',
  PREFS: 'wird_preferences_v1',
  FAVORITES: 'wird_favorites_v1',
  SESSIONS: 'wird_sessions_v1',
  HISTORY: 'wird_history_v1',
};

export function getTodayDateKey(timezone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(KEYS.DEVICE_ID);
    if (existing && /^[a-zA-Z0-9_\-]{8,128}$/.test(existing)) {
      return existing;
    }
    const randomPart =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const id = `dev_${randomPart}`;
    localStorage.setItem(KEYS.DEVICE_ID, id);
    return id;
  } catch {
    return `dev_ephemeral_${Date.now()}`;
  }
}

export function getDefaultPreferences(): UserPreferencesState {
  const detectedTz =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh'
      : 'Asia/Riyadh';
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
    timezone: detectedTz,
    quietHoursEnabled: true,
    quietHoursStart: '23:00',
    quietHoursEnd: '04:30',
  };
}

export function loadPreferences(): UserPreferencesState {
  const defaults = getDefaultPreferences();
  try {
    const raw = localStorage.getItem(KEYS.PREFS);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<UserPreferencesState>) };
  } catch {
    return defaults;
  }
}

export function savePreferences(prefs: UserPreferencesState): void {
  try {
    localStorage.setItem(KEYS.PREFS, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(KEYS.FAVORITES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  try {
    localStorage.setItem(KEYS.FAVORITES, JSON.stringify(ids));
  } catch {
    // Ignore
  }
}

export function loadSessions(): Record<'morning' | 'evening', SessionProgress | null> {
  const today = getTodayDateKey();
  try {
    const raw = localStorage.getItem(KEYS.SESSIONS);
    if (!raw) return { morning: null, evening: null };
    const parsed = JSON.parse(raw) as Partial<Record<'morning' | 'evening', SessionProgress>>;
    const morning = parsed.morning?.dateKey === today ? parsed.morning : null;
    const evening = parsed.evening?.dateKey === today ? parsed.evening : null;
    return { morning, evening };
  } catch {
    return { morning: null, evening: null };
  }
}

export function saveSessionProgress(session: SessionProgress): void {
  try {
    const existing = loadSessions();
    const next = { ...existing, [session.period]: session };
    localStorage.setItem(KEYS.SESSIONS, JSON.stringify(next));
  } catch {
    // Ignore
  }
}

export function loadHistory(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(KEYS.HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryRecord[]) : [];
  } catch {
    return [];
  }
}

export function appendHistoryRecord(record: HistoryRecord): HistoryRecord[] {
  const current = loadHistory();
  const filtered = current.filter(
    (item) => !(item.dateKey === record.dateKey && item.period === record.period)
  );
  const next = [record, ...filtered].slice(0, 90);
  try {
    localStorage.setItem(KEYS.HISTORY, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}
