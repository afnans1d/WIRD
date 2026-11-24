import {
  evaluateDueReminders,
  getClockInTimezone,
  type AdhkarPeriod,
} from './reminderScheduler';
import type { SessionProgress, UserPreferencesState } from './storage';

export interface PushCapabilities {
  isSupported: boolean;
  hasPushManager: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  isInsideIframe: boolean;
  requiresIOSHomeScreenInstall: boolean;
  permission: NotificationPermission | 'unsupported';
  platformLabel: string;
}

export interface DeliveryAuditItem {
  id: string;
  period: 'morning' | 'evening' | 'test';
  dateKey: string;
  status: 'sent' | 'failed' | 'pending' | 'processing' | 'cancelled';
  statusCode?: number;
  errorMessage?: string;
  scheduledFor?: string;
  createdAt: string;
}

export interface NotificationStatusResult {
  isActive: boolean;
  workerConfigured: boolean;
  workerActive: boolean;
  nextMorningAt: number | null;
  nextEveningAt: number | null;
  deliveries: DeliveryAuditItem[];
}

const OPT_OUT_KEY = 'wird_push_opted_out_v1';
const LOCAL_ACTIVE_KEY = 'wird_local_push_active_v1';
const LOCAL_NOTIFIED_KEY = 'wird_local_notified_v1';
const LOCAL_DELIVERIES_KEY = 'wird_local_deliveries_v1';
const DEVICE_SECRET_KEY = 'wird_device_secret_v1';

export function getPushWorkerBaseUrl(): string | null {
  try {
    const raw = (import.meta.env?.VITE_PUSH_WORKER_URL as string | undefined) || '';
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (!trimmed) return null;
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export function isWorkerPushConfigured(): boolean {
  return Boolean(getPushWorkerBaseUrl());
}

export function getOrCreateDeviceSecret(): string {
  try {
    const existing = localStorage.getItem(DEVICE_SECRET_KEY);
    if (existing && existing.length >= 24 && existing.length <= 256) {
      return existing;
    }
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const secret = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    localStorage.setItem(DEVICE_SECRET_KEY, secret);
    return secret;
  } catch {
    return `fallback_secret_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function isPushOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function setLocalNotificationEnabledState(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.removeItem(OPT_OUT_KEY);
      localStorage.setItem(LOCAL_ACTIVE_KEY, '1');
    } else {
      localStorage.setItem(OPT_OUT_KEY, '1');
      localStorage.removeItem(LOCAL_ACTIVE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function isLocalNotificationsActive(): boolean {
  try {
    return localStorage.getItem(LOCAL_ACTIVE_KEY) === '1' && !isPushOptedOut();
  } catch {
    return false;
  }
}

export function loadLocalDeliveries(): DeliveryAuditItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_DELIVERIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeliveryAuditItem[]) : [];
  } catch {
    return [];
  }
}

function appendLocalDelivery(item: DeliveryAuditItem): void {
  try {
    const existing = loadLocalDeliveries();
    const next = [item, ...existing].slice(0, 15);
    localStorage.setItem(LOCAL_DELIVERIES_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
}

function loadNotifiedMap(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_NOTIFIED_KEY) || '{}') as Record<
      string,
      boolean
    >;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveNotifiedMap(map: Record<string, boolean>, currentDateKey: string): void {
  try {
    const entries = Object.entries(map).filter(([key]) => {
      const [datePart] = key.split(':');
      return datePart >= currentDateKey;
    });
    localStorage.setItem(LOCAL_NOTIFIED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignore
  }
}

export function detectPushCapabilities(): PushCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isSupported: false,
      hasPushManager: false,
      isIOS: false,
      isStandalone: false,
      isInsideIframe: false,
      requiresIOSHomeScreenInstall: false,
      permission: 'unsupported',
      platformLabel: 'غير معروف',
    };
  }

  const ua = navigator.userAgent.toLowerCase();
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMac = /macintosh|mac os x/.test(ua) && !isIOS;
  const isAndroid = /android/.test(ua);

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  let isInsideIframe = false;
  try {
    isInsideIframe = window.self !== window.top;
  } catch {
    isInsideIframe = true;
  }

  const hasServiceWorker = 'serviceWorker' in navigator;
  const hasNotification = 'Notification' in window;
  const hasPushManager = 'PushManager' in window;

  const requiresIOSHomeScreenInstall = isIOS && !isStandalone;
  const isSupported =
    hasServiceWorker && hasNotification && !requiresIOSHomeScreenInstall;

  let platformLabel = 'متصفح سطح المكتب';
  if (isIOS) platformLabel = isStandalone ? 'iOS (تطبيق الشاشة الرئيسية)' : 'iOS Safari';
  else if (isAndroid) platformLabel = isStandalone ? 'Android (تطبيق مثبت)' : 'Android Chrome';
  else if (isMac) platformLabel = /safari/.test(ua) && !/chrome/.test(ua) ? 'macOS Safari' : 'macOS Chrome';

  return {
    isSupported,
    hasPushManager,
    isIOS,
    isStandalone,
    isInsideIframe,
    requiresIOSHomeScreenInstall,
    permission: hasNotification ? Notification.permission : 'unsupported',
    platformLabel,
  };
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('المتصفح لا يدعم مشغّل الخدمات (Service Worker).');
  }

  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    const swUrl = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
    reg = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
      type: import.meta.env.DEV ? 'module' : 'classic',
    });
  }

  const readyReg = await Promise.race<ServiceWorkerRegistration>([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) =>
      window.setTimeout(
        () => reject(new Error('استغرق تجهيز مشغّل الإشعارات وقتاً أطول من المعتاد، حاول تحديث الصفحة.')),
        8000
      )
    ),
  ]);

  return readyReg || reg;
}

async function dispatchNativeNotification(
  period: AdhkarPeriod,
  isTest = false
): Promise<boolean> {
  const title = period === 'morning' ? 'وِرد · أذكار الصباح' : 'وِرد · أذكار المساء';
  const body =
    period === 'morning'
      ? 'صباح الخير ☀️ حان وقت أذكار الصباح حفظك الله'
      : 'مساء الخير 🌙 حان وقت أذكار المساء حفظك الله';
  const tag = isTest ? `wird-test-${period}` : `wird-${period}-reminder`;

  try {
    const reg = await getReadyServiceWorkerRegistration();
    await reg.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      dir: 'rtl',
      lang: 'ar',
      tag,
      data: { url: `/?session=${period}`, period },
    });
    return true;
  } catch {
    try {
      new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
        dir: 'rtl',
        lang: 'ar',
        tag,
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function subscribeBrowserToWorker(
  reg: ServiceWorkerRegistration,
  workerBase: string,
  deviceId: string,
  prefs: UserPreferencesState
): Promise<{ ok: boolean; error?: string }> {
  if (!('PushManager' in window)) {
    return {
      ok: false,
      error: 'هذا المتصفح لا يدعم Web Push في الخلفية؛ ستعمل التنبيهات المحلية أثناء فتح التطبيق فقط.',
    };
  }

  const vapidRes = await fetch(`${workerBase}/api/push/vapid-public-key`);
  if (!vapidRes.ok) {
    return { ok: false, error: 'تعذر جلب مفتاح VAPID من خادم الإشعارات (Worker).' };
  }
  const vapidJson = (await vapidRes.json()) as { publicKey?: string };
  if (!vapidJson.publicKey) {
    return { ok: false, error: 'مفتاح VAPID غير مضبوط بعد على خادم Cloudflare Worker.' };
  }

  const appServerKey = urlBase64ToUint8Array(vapidJson.publicKey);
  let subscription = await reg.pushManager.getSubscription();

  if (subscription) {
    const currentKeyBuf = subscription.options?.applicationServerKey;
    if (currentKeyBuf) {
      const currentKeyB64 = uint8ArrayToBase64Url(new Uint8Array(currentKeyBuf));
      if (currentKeyB64 !== vapidJson.publicKey) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
  }

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  const res = await fetch(`${workerBase}/api/push/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Token': getOrCreateDeviceSecret(),
    },
    body: JSON.stringify({
      deviceId,
      subscription: subscription.toJSON(),
      preferences: {
        timezone: prefs.timezone,
        morningEnabled: prefs.morningEnabled,
        eveningEnabled: prefs.eveningEnabled,
        morningTime: prefs.morningTime,
        eveningTime: prefs.eveningTime,
        quietHoursEnabled: prefs.quietHoursEnabled,
        quietHoursStart: prefs.quietHoursStart,
        quietHoursEnd: prefs.quietHoursEnd,
      },
    }),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: errBody.error || `تعذر تسجيل الاشتراك في خادم الإشعارات (${res.status}).`,
    };
  }

  return { ok: true };
}

export async function enableNotifications(
  deviceId?: string,
  prefs?: UserPreferencesState
): Promise<{ ok: boolean; mode?: 'worker' | 'local'; error?: string }> {
  const caps = detectPushCapabilities();

  if (caps.requiresIOSHomeScreenInstall) {
    return {
      ok: false,
      error:
        'على أجهزة iPhone و iPad يجب إضافة تطبيق وِرد إلى الشاشة الرئيسية أولاً عبر Safari لتفعيل الإشعارات.',
    };
  }

  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    return {
      ok: false,
      error: 'هذا المتصفح لا يدعم إشعارات الويب.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    if (caps.isInsideIframe) {
      return {
        ok: false,
        error:
          'يمنع المتصفح طلب إذن الإشعارات داخل نافذة المعاينة المدمجة. افتح رابط التطبيق مباشرة في المتصفح ثم فعّل الإشعارات.',
      };
    }
    return {
      ok: false,
      error:
        permission === 'denied'
          ? 'تم حظر إذن الإشعارات من إعدادات المتصفح. يمكنك السماح بها يدوياً من إعدادات الموقع.'
          : 'لم يتم منح إذن الإشعارات.',
    };
  }

  try {
    const reg = await getReadyServiceWorkerRegistration();
    setLocalNotificationEnabledState(true);

    const workerBase = getPushWorkerBaseUrl();
    if (workerBase && deviceId && prefs) {
      const workerRes = await subscribeBrowserToWorker(reg, workerBase, deviceId, prefs);
      if (!workerRes.ok) {
        return { ok: false, mode: 'local', error: workerRes.error };
      }
      return { ok: true, mode: 'worker' };
    }

    return { ok: true, mode: 'local' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'حدث خطأ أثناء تفعيل الإشعارات',
    };
  }
}

export async function enableLocalNotifications(): Promise<{ ok: boolean; error?: string }> {
  const res = await enableNotifications();
  return { ok: res.ok, error: res.error };
}

export async function disableNotifications(deviceId?: string): Promise<void> {
  setLocalNotificationEnabledState(false);

  const workerBase = getPushWorkerBaseUrl();
  if (workerBase && deviceId) {
    try {
      await fetch(`${workerBase}/api/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': getOrCreateDeviceSecret(),
        },
        body: JSON.stringify({ deviceId }),
      });
    } catch {
      // Offline or unavailable; browser PushSubscription unsubscribe below still proceeds
    }
  }

  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    }
  } catch {
    // Ignore
  }
}

export async function disableLocalNotifications(): Promise<void> {
  return disableNotifications();
}

export async function syncPreferencesToWorker(
  deviceId: string,
  prefs: UserPreferencesState
): Promise<void> {
  const workerBase = getPushWorkerBaseUrl();
  if (!workerBase || isPushOptedOut() || !isLocalNotificationsActive()) {
    return;
  }

  try {
    const res = await fetch(`${workerBase}/api/push/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': getOrCreateDeviceSecret(),
      },
      body: JSON.stringify({
        deviceId,
        preferences: {
          timezone: prefs.timezone,
          morningEnabled: prefs.morningEnabled,
          eveningEnabled: prefs.eveningEnabled,
          morningTime: prefs.morningTime,
          eveningTime: prefs.eveningTime,
          quietHoursEnabled: prefs.quietHoursEnabled,
          quietHoursStart: prefs.quietHoursStart,
          quietHoursEnd: prefs.quietHoursEnd,
        },
      }),
    });

    if (res.status === 404 && 'serviceWorker' in navigator && Notification.permission === 'granted') {
      const reg = await getReadyServiceWorkerRegistration();
      await subscribeBrowserToWorker(reg, workerBase, deviceId, prefs);
    }
  } catch {
    // Offline; local prefs are already saved
  }
}

export async function syncSessionCompletionToWorker(
  deviceId: string,
  period: AdhkarPeriod,
  dateKey: string,
  isCompleted: boolean
): Promise<void> {
  const workerBase = getPushWorkerBaseUrl();
  if (!workerBase || isPushOptedOut() || !isLocalNotificationsActive()) {
    return;
  }

  try {
    await fetch(`${workerBase}/api/push/session-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': getOrCreateDeviceSecret(),
      },
      body: JSON.stringify({
        deviceId,
        period,
        dateKey,
        isCompleted,
      }),
    });
  } catch {
    // Offline; ignore cleanly
  }
}

export async function sendTestNotification(
  period: AdhkarPeriod,
  prefs: UserPreferencesState,
  deviceId?: string
): Promise<{ ok: boolean; viaWorker?: boolean; error?: string }> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { ok: false, error: 'هذا المتصفح لا يدعم الإشعارات.' };
  }

  if (Notification.permission !== 'granted') {
    const activated = await enableNotifications(deviceId, prefs);
    if (!activated.ok) return activated;
  }

  const workerBase = getPushWorkerBaseUrl();
  if (workerBase && deviceId && 'PushManager' in window) {
    try {
      const res = await fetch(`${workerBase}/api/push/send-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': getOrCreateDeviceSecret(),
        },
        body: JSON.stringify({ deviceId, period }),
      });

      if (res.ok) {
        return { ok: true, viaWorker: true };
      }

      if (res.status === 429) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: errData.error || 'يرجى الانتظار 30 ثانية قبل إرسال تجربة أخرى.' };
      }

      if (res.status === 404) {
        const reg = await getReadyServiceWorkerRegistration();
        const subRes = await subscribeBrowserToWorker(reg, workerBase, deviceId, prefs);
        if (subRes.ok) {
          const retryRes = await fetch(`${workerBase}/api/push/send-test`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Device-Token': getOrCreateDeviceSecret(),
            },
            body: JSON.stringify({ deviceId, period }),
          });
          if (retryRes.ok) return { ok: true, viaWorker: true };
        }
      }
    } catch {
      // Fall through to local notification fallback when offline
    }
  }

  const { dateKey } = getClockInTimezone(prefs.timezone);
  const shown = await dispatchNativeNotification(period, true);
  if (shown) {
    appendLocalDelivery({
      id: `local_${Date.now()}_${period}`,
      period: 'test',
      dateKey,
      status: 'sent',
      statusCode: 200,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, viaWorker: false };
  }

  appendLocalDelivery({
    id: `local_err_${Date.now()}_${period}`,
    period: 'test',
    dateKey,
    status: 'failed',
    errorMessage: 'تعذر عرض الإشعار من المتصفح',
    createdAt: new Date().toISOString(),
  });
  return {
    ok: false,
    error: 'تعذر عرض الإشعار. تأكد من السماح بالإشعارات في إعدادات المتصفح والجهاز.',
  };
}

export async function scheduleApproxOneMinuteTest(
  deviceId: string,
  prefs: UserPreferencesState
): Promise<{ ok: boolean; scheduledFor?: number; error?: string }> {
  const workerBase = getPushWorkerBaseUrl();
  if (!workerBase) {
    return {
      ok: false,
      error: 'لم يتم ربط عنوان Cloudflare Worker (VITE_PUSH_WORKER_URL) في إعدادات البناء بعد.',
    };
  }

  if (Notification.permission !== 'granted') {
    const activated = await enableNotifications(deviceId, prefs);
    if (!activated.ok) return activated;
  }

  try {
    const res = await fetch(`${workerBase}/api/push/schedule-test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': getOrCreateDeviceSecret(),
      },
      body: JSON.stringify({ deviceId, delaySeconds: 60 }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      scheduledFor?: number;
      error?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `تعذر جدولة الاختبار (${res.status}).`,
      };
    }

    return { ok: true, scheduledFor: data.scheduledFor };
  } catch {
    return {
      ok: false,
      error: 'تعذر الاتصال بخادم Cloudflare Worker لجدولة الاختبار.',
    };
  }
}

export function fetchLocalNotificationStatus(): {
  isActive: boolean;
  deliveries: DeliveryAuditItem[];
} {
  const caps = detectPushCapabilities();
  const isActive = caps.permission === 'granted' && isLocalNotificationsActive();
  return {
    isActive,
    deliveries: loadLocalDeliveries(),
  };
}

export async function fetchNotificationStatus(deviceId?: string): Promise<NotificationStatusResult> {
  const local = fetchLocalNotificationStatus();
  const workerBase = getPushWorkerBaseUrl();
  if (!workerBase || !deviceId) {
    return {
      isActive: local.isActive,
      workerConfigured: Boolean(workerBase),
      workerActive: false,
      nextMorningAt: null,
      nextEveningAt: null,
      deliveries: local.deliveries,
    };
  }

  try {
    const res = await fetch(
      `${workerBase}/api/push/deliveries?deviceId=${encodeURIComponent(deviceId)}`,
      {
        headers: {
          'X-Device-Token': getOrCreateDeviceSecret(),
        },
      }
    );

    if (!res.ok) {
      return {
        isActive: local.isActive,
        workerConfigured: true,
        workerActive: false,
        nextMorningAt: null,
        nextEveningAt: null,
        deliveries: local.deliveries,
      };
    }

    const data = (await res.json()) as {
      isActive?: boolean;
      nextMorningAt?: number | null;
      nextEveningAt?: number | null;
      deliveries?: DeliveryAuditItem[];
    };

    const merged = [...(data.deliveries || []), ...local.deliveries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    return {
      isActive: local.isActive,
      workerConfigured: true,
      workerActive: Boolean(data.isActive),
      nextMorningAt: data.nextMorningAt ?? null,
      nextEveningAt: data.nextEveningAt ?? null,
      deliveries: merged,
    };
  } catch {
    return {
      isActive: local.isActive,
      workerConfigured: true,
      workerActive: false,
      nextMorningAt: null,
      nextEveningAt: null,
      deliveries: local.deliveries,
    };
  }
}

export async function checkAndFireLocalDueReminder(
  prefs: UserPreferencesState,
  sessions: Record<AdhkarPeriod, SessionProgress | null>
): Promise<AdhkarPeriod[]> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return [];
  }

  const notifiedMap = loadNotifiedMap();
  const evaluation = evaluateDueReminders({
    prefs,
    sessions,
    notifiedMap,
    optedOut: isPushOptedOut() || !isLocalNotificationsActive(),
    permission: Notification.permission,
  });

  if (evaluation.duePeriods.length === 0) {
    return [];
  }

  for (const period of evaluation.duePeriods) {
    notifiedMap[`${evaluation.dateKey}:${period}`] = true;
  }
  saveNotifiedMap(notifiedMap, evaluation.dateKey);

  const fired: AdhkarPeriod[] = [];
  for (const period of evaluation.duePeriods) {
    const shown = await dispatchNativeNotification(period, false);
    if (shown) {
      fired.push(period);
      appendLocalDelivery({
        id: `local_${Date.now()}_${period}`,
        period,
        dateKey: evaluation.dateKey,
        status: 'sent',
        statusCode: 200,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return fired;
}
