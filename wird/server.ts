import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import * as webpush from 'web-push';
import { z } from 'zod';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function resolveDataDir(): string {
  const preferred = process.env.DATA_DIR?.trim()
    ? path.resolve(process.env.DATA_DIR.trim())
    : path.resolve(process.cwd(), '.data');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'wird-data');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const DATA_DIR = resolveDataDir();
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const STORE_FILE = path.join(DATA_DIR, 'push-store.json');

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: 'env' | 'local_generated';
}

function normalizeVapidSubject(raw?: string): string {
  const fallback = 'mailto:notifications@wird-adhkar.app';
  if (!raw) return fallback;
  const cleaned = raw.trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return fallback;

  let candidate = cleaned;
  if (!candidate.includes('://') && !candidate.startsWith('mailto:')) {
    if (candidate.includes('@')) {
      candidate = `mailto:${candidate}`;
    } else {
      candidate = `https://${candidate}`;
    }
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'mailto:' || parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return candidate;
    }
  } catch {
    // Fall through to safe fallback
  }
  console.warn(`Invalid VAPID_SUBJECT "${cleaned}", falling back to ${fallback}`);
  return fallback;
}

function loadOrCreateVapid(): VapidConfig {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim().replace(/^["']|["']$/g, '');
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, '');
  const envSubject = normalizeVapidSubject(process.env.VAPID_SUBJECT);

  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject: envSubject,
      source: 'env',
    };
  }

  if (fs.existsSync(VAPID_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')) as VapidConfig;
      if (saved.publicKey && saved.privateKey) {
        const normalizedSavedSubject = normalizeVapidSubject(saved.subject || envSubject);
        if (normalizedSavedSubject !== saved.subject) {
          saved.subject = normalizedSavedSubject;
          fs.writeFileSync(VAPID_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
        }
        return { ...saved, subject: normalizedSavedSubject, source: 'local_generated' };
      }
    } catch {
      // Regenerate below if corrupted
    }
  }

  const generated = webpush.generateVAPIDKeys();
  const config: VapidConfig = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: envSubject,
    source: 'local_generated',
  };
  fs.writeFileSync(VAPID_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

let vapidConfig = loadOrCreateVapid();
try {
  webpush.setVapidDetails(vapidConfig.subject, vapidConfig.publicKey, vapidConfig.privateKey);
} catch (err) {
  console.error('VAPID configuration error, generating safe local fallback keys:', err);
  const generated = webpush.generateVAPIDKeys();
  vapidConfig = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: 'mailto:notifications@wird-adhkar.app',
    source: 'local_generated',
  };
  webpush.setVapidDetails(vapidConfig.subject, vapidConfig.publicKey, vapidConfig.privateKey);
}

interface StoredSubscription {
  subscriptionId: string;
  deviceId: string;
  userId?: string;
  endpointHash: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  platform: string;
  timezone: string;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  morningTime: string;
  eveningTime: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  completedDates: {
    morning?: string[];
    evening?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRecord {
  id: string;
  deliveryKey: string;
  subscriptionId: string;
  deviceId: string;
  period: 'morning' | 'evening' | 'test';
  dateKey: string;
  status: 'sent' | 'failed' | 'expired_removed' | 'skipped_completed' | 'skipped_quiet_hours';
  statusCode?: number;
  errorMessage?: string;
  createdAt: string;
}

interface PushStore {
  subscriptions: Record<string, StoredSubscription>;
  deliveries: DeliveryRecord[];
}

function readStore(): PushStore {
  if (!fs.existsSync(STORE_FILE)) {
    return { subscriptions: {}, deliveries: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as PushStore;
    return {
      subscriptions: raw.subscriptions || {},
      deliveries: Array.isArray(raw.deliveries) ? raw.deliveries : [],
    };
  } catch {
    return { subscriptions: {}, deliveries: [] };
  }
}

function writeStore(store: PushStore): void {
  if (store.deliveries.length > 500) {
    store.deliveries = store.deliveries.slice(-500);
  }
  const tmpFile = path.join(DATA_DIR, `push-store.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, STORE_FILE);
}

function hashEndpoint(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

function getLocalClock(timezone: string, now = new Date()): { dateKey: string; hhmm: string } {
  let validTz = timezone || 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: validTz });
  } catch {
    validTz = 'UTC';
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${hour}:${get('minute')}`,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isWithinQuietHours(currentHHMM: string, start: string, end: string): boolean {
  const cur = toMinutes(currentHHMM);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  if (s < e) {
    return cur >= s && cur < e;
  }
  return cur >= s || cur < e;
}

function isTimeMatch(currentHHMM: string, targetHHMM: string, windowMinutes = 1): boolean {
  const cur = toMinutes(currentHHMM);
  const tgt = toMinutes(targetHHMM);
  const diff = Math.abs(cur - tgt);
  return diff <= windowMinutes || 1440 - diff <= windowMinutes;
}

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const subscribeSchema = z.object({
  deviceId: z.string().min(4).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
  userId: z
    .string()
    .max(128)
    .regex(/^[a-zA-Z0-9_\-]+$/)
    .or(z.literal(''))
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  platform: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(80),
  morningEnabled: z.boolean(),
  eveningEnabled: z.boolean(),
  morningTime: z.string().regex(timeRegex),
  eveningTime: z.string().regex(timeRegex),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(timeRegex),
  quietHoursEnd: z.string().regex(timeRegex),
  subscription: z.object({
    endpoint: z.string().url().max(2000),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(10).max(512),
      auth: z.string().min(6).max(256),
    }),
  }),
});

const preferencesSchema = z.object({
  deviceId: z.string().min(4).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
  timezone: z.string().trim().min(1).max(80),
  morningEnabled: z.boolean(),
  eveningEnabled: z.boolean(),
  morningTime: z.string().regex(timeRegex),
  eveningTime: z.string().regex(timeRegex),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(timeRegex),
  quietHoursEnd: z.string().regex(timeRegex),
});

const sessionStatusSchema = z.object({
  deviceId: z.string().min(4).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
  period: z.enum(['morning', 'evening']),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.boolean(),
});

const testPushSchema = z.object({
  deviceId: z.string().min(4).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
  period: z.enum(['morning', 'evening']).default('morning'),
});

const unsubscribeSchema = z.object({
  deviceId: z.string().min(4).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
});

function buildNotificationPayload(period: 'morning' | 'evening') {
  if (period === 'morning') {
    return JSON.stringify({
      title: 'وِرد · أذكار الصباح',
      body: 'صباح الخير ☀️ حان وقت أذكار الصباح حفظك الله',
      period: 'morning',
      url: '/?session=morning',
      tag: 'wird-morning-reminder',
    });
  }
  return JSON.stringify({
    title: 'وِرد · أذكار المساء',
    body: 'مساء الخير 🌙 حان وقت أذكار المساء حفظك الله',
    period: 'evening',
    url: '/?session=evening',
    tag: 'wird-evening-reminder',
  });
}

async function processDueReminders(forceCheck = false): Promise<{
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  expiredRemoved: number;
}> {
  const store = readStore();
  const subs = Object.values(store.subscriptions);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let expiredRemoved = 0;
  let dirty = false;

  for (const sub of subs) {
    const { dateKey, hhmm } = getLocalClock(sub.timezone);

    const periods: Array<{ period: 'morning' | 'evening'; enabled: boolean; time: string }> = [
      { period: 'morning', enabled: sub.morningEnabled, time: sub.morningTime },
      { period: 'evening', enabled: sub.eveningEnabled, time: sub.eveningTime },
    ];

    for (const item of periods) {
      if (!item.enabled) continue;
      if (!forceCheck && !isTimeMatch(hhmm, item.time, 2)) continue;

      const deliveryKey = `${sub.subscriptionId}:${dateKey}:${item.period}`;
      const alreadyDelivered = store.deliveries.some(
        (d) => d.deliveryKey === deliveryKey && d.status === 'sent'
      );
      if (alreadyDelivered) {
        skipped++;
        continue;
      }

      if (sub.quietHoursEnabled && isWithinQuietHours(hhmm, sub.quietHoursStart, sub.quietHoursEnd)) {
        skipped++;
        continue;
      }

      const completedList = sub.completedDates?.[item.period] || [];
      if (completedList.includes(dateKey)) {
        skipped++;
        continue;
      }

      try {
        const result = await webpush.sendNotification(
          sub.subscription,
          buildNotificationPayload(item.period),
          { TTL: 3600 }
        );
        store.deliveries.push({
          id: crypto.randomUUID(),
          deliveryKey,
          subscriptionId: sub.subscriptionId,
          deviceId: sub.deviceId,
          period: item.period,
          dateKey,
          status: 'sent',
          statusCode: result.statusCode,
          createdAt: new Date().toISOString(),
        });
        sent++;
        dirty = true;
      } catch (err: unknown) {
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 500;
        const message = err instanceof Error ? err.message : 'Push delivery failed';

        if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 410) {
          delete store.subscriptions[sub.subscriptionId];
          store.deliveries.push({
            id: crypto.randomUUID(),
            deliveryKey,
            subscriptionId: sub.subscriptionId,
            deviceId: sub.deviceId,
            period: item.period,
            dateKey,
            status: 'expired_removed',
            statusCode,
            errorMessage: 'Subscription expired or VAPID key changed — removed for auto-refresh',
            createdAt: new Date().toISOString(),
          });
          expiredRemoved++;
          dirty = true;
        } else {
          store.deliveries.push({
            id: crypto.randomUUID(),
            deliveryKey,
            subscriptionId: sub.subscriptionId,
            deviceId: sub.deviceId,
            period: item.period,
            dateKey,
            status: 'failed',
            statusCode,
            errorMessage: message.slice(0, 200),
            createdAt: new Date().toISOString(),
          });
          failed++;
          dirty = true;
        }
      }
    }
  }

  if (dirty) {
    writeStore(store);
  }

  return { checked: subs.length, sent, skipped, failed, expiredRemoved };
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', true);
  app.use(express.json({ limit: '32kb' }));

  // Health endpoints (/api/health and /healthz)
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    const store = readStore();
    res.json({
      ok: true,
      service: 'wird-backend',
      vapidConfiguredFromEnv: vapidConfig.source === 'env',
      activeSubscriptions: Object.keys(store.subscriptions).length,
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    });
  });

  // Expose ONLY the VAPID public key (private key stays strictly on server)
  app.get('/api/push/vapid-public-key', (_req: Request, res: Response) => {
    res.json({
      publicKey: vapidConfig.publicKey,
      configuredFromEnv: vapidConfig.source === 'env',
    });
  });

  // Register or update Web Push subscription
  app.post('/api/push/subscribe', (req: Request, res: Response) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'بيانات الاشتراك غير صالحة', details: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    const endpointHash = hashEndpoint(data.subscription.endpoint);
    const subscriptionId = `sub_${data.deviceId}`;
    const store = readStore();
    const existing = store.subscriptions[subscriptionId];
    const nowIso = new Date().toISOString();

    store.subscriptions[subscriptionId] = {
      subscriptionId,
      deviceId: data.deviceId,
      userId: data.userId,
      endpointHash,
      subscription: data.subscription,
      platform: data.platform,
      timezone: data.timezone,
      morningEnabled: data.morningEnabled,
      eveningEnabled: data.eveningEnabled,
      morningTime: data.morningTime,
      eveningTime: data.eveningTime,
      quietHoursEnabled: data.quietHoursEnabled,
      quietHoursStart: data.quietHoursStart,
      quietHoursEnd: data.quietHoursEnd,
      completedDates: existing?.completedDates || { morning: [], evening: [] },
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    writeStore(store);

    res.json({
      ok: true,
      subscriptionId,
      endpointHash,
      updatedAt: nowIso,
    });
  });

  // Update schedule preferences
  app.patch('/api/push/preferences', (req: Request, res: Response) => {
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'تفضيلات غير صالحة' });
      return;
    }
    const data = parsed.data;
    const store = readStore();
    const subscriptionId = `sub_${data.deviceId}`;
    const sub = store.subscriptions[subscriptionId];

    if (!sub) {
      res.status(404).json({ error: 'لا يوجد اشتراك إشعارات مسجل لهذا الجهاز بعد' });
      return;
    }

    sub.timezone = data.timezone;
    sub.morningEnabled = data.morningEnabled;
    sub.eveningEnabled = data.eveningEnabled;
    sub.morningTime = data.morningTime;
    sub.eveningTime = data.eveningTime;
    sub.quietHoursEnabled = data.quietHoursEnabled;
    sub.quietHoursStart = data.quietHoursStart;
    sub.quietHoursEnd = data.quietHoursEnd;
    sub.updatedAt = new Date().toISOString();
    writeStore(store);

    res.json({ ok: true, updatedAt: sub.updatedAt });
  });

  // Sync session completion status so reminders are suppressed once completed for that day
  app.post('/api/push/session-status', (req: Request, res: Response) => {
    const parsed = sessionStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'حالة الجلسة غير صالحة' });
      return;
    }
    const { deviceId, period, dateKey, completed } = parsed.data;
    const store = readStore();
    const sub = store.subscriptions[`sub_${deviceId}`];
    if (!sub) {
      res.json({ ok: true, tracked: false });
      return;
    }

    const currentList = sub.completedDates[period] || [];
    if (completed && !currentList.includes(dateKey)) {
      sub.completedDates[period] = [...currentList.slice(-14), dateKey];
    } else if (!completed) {
      sub.completedDates[period] = currentList.filter((d) => d !== dateKey);
    }
    sub.updatedAt = new Date().toISOString();
    writeStore(store);
    res.json({ ok: true, tracked: true });
  });

  // Unsubscribe device
  app.delete('/api/push/unsubscribe', (req: Request, res: Response) => {
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'معرف الجهاز غير صالح' });
      return;
    }
    const store = readStore();
    const subscriptionId = `sub_${parsed.data.deviceId}`;
    delete store.subscriptions[subscriptionId];
    writeStore(store);
    res.json({ ok: true });
  });

  // Send a REAL test push notification via web-push to verify OS/browser delivery
  app.post('/api/push/send-test', async (req: Request, res: Response) => {
    const parsed = testPushSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'طلب غير صالح' });
      return;
    }

    const { deviceId, period } = parsed.data;
    const store = readStore();
    const subscriptionId = `sub_${deviceId}`;
    const sub = store.subscriptions[subscriptionId];

    if (!sub) {
      res.status(404).json({
        error: 'الرجاء تفعيل الإشعارات أولاً لتسجيل اشتراك المتصفح.',
        needsResubscribe: true,
      });
      return;
    }

    const { dateKey } = getLocalClock(sub.timezone);
    const deliveryKey = `${subscriptionId}:${dateKey}:test:${Date.now()}`;

    try {
      const result = await webpush.sendNotification(
        sub.subscription,
        buildNotificationPayload(period),
        { TTL: 600 }
      );
      store.deliveries.push({
        id: crypto.randomUUID(),
        deliveryKey,
        subscriptionId,
        deviceId,
        period: 'test',
        dateKey,
        status: 'sent',
        statusCode: result.statusCode,
        createdAt: new Date().toISOString(),
      });
      writeStore(store);
      res.json({ ok: true, statusCode: result.statusCode });
    } catch (err: unknown) {
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode?: number }).statusCode)
          : 500;
      const message = err instanceof Error ? err.message : 'فشل إرسال الإشعار';

      if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 410) {
        delete store.subscriptions[subscriptionId];
        store.deliveries.push({
          id: crypto.randomUUID(),
          deliveryKey,
          subscriptionId,
          deviceId,
          period: 'test',
          dateKey,
          status: 'expired_removed',
          statusCode,
          errorMessage: 'Subscription expired or VAPID mismatch — cleared for auto-renewal',
          createdAt: new Date().toISOString(),
        });
        writeStore(store);
        res.status(410).json({
          error: 'تم تجديد مفتاح الإشعارات، جاري إعادة الربط تلقائياً.',
          needsResubscribe: true,
        });
        return;
      }

      store.deliveries.push({
        id: crypto.randomUUID(),
        deliveryKey,
        subscriptionId,
        deviceId,
        period: 'test',
        dateKey,
        status: 'failed',
        statusCode,
        errorMessage: message.slice(0, 200),
        createdAt: new Date().toISOString(),
      });
      writeStore(store);
      res.status(502).json({ error: `فشل تسليم الإشعار (${statusCode}): ${message}` });
    }
  });

  // Delivery audit log for current device
  app.get('/api/push/deliveries', (req: Request, res: Response) => {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
    if (!deviceId || !/^[a-zA-Z0-9_\-]{4,128}$/.test(deviceId)) {
      res.status(400).json({ error: 'معرف الجهاز مطلوب' });
      return;
    }
    const store = readStore();
    const list = store.deliveries
      .filter((d) => d.deviceId === deviceId)
      .slice(-15)
      .reverse();
    const hasActiveSubscription = Boolean(store.subscriptions[`sub_${deviceId}`]);
    res.json({ hasActiveSubscription, deliveries: list });
  });

  // Scheduled server-side reminder processor (triggered by Google Cloud Scheduler or server tick)
  app.post('/api/notifications/process-due', async (req: Request, res: Response) => {
    const configuredSecret = process.env.CRON_SECRET?.trim();
    if (configuredSecret) {
      const authHeader = req.headers.authorization || '';
      const cronHeader = typeof req.headers['x-cron-secret'] === 'string' ? req.headers['x-cron-secret'] : '';
      const provided = cronHeader ? `Bearer ${cronHeader}` : authHeader;
      const expected = `Bearer ${configuredSecret}`;
      const providedBuf = Buffer.from(provided);
      const expectedBuf = Buffer.from(expected);
      if (
        providedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(providedBuf, expectedBuf)
      ) {
        res.status(401).json({ error: 'Unauthorized scheduler call' });
        return;
      }
    } else if (IS_PROD) {
      res.status(403).json({
        error: 'CRON_SECRET environment variable must be configured in production',
      });
      return;
    }

    const summary = await processDueReminders(false);
    res.json({ ok: true, ...summary });
  });

  // Server-side 60s scheduler loop (active while Cloud Run container instance is warm)
  const schedulerInterval = setInterval(() => {
    processDueReminders(false).catch((err) => {
      console.error('Scheduled reminder loop error:', err);
    });
  }, 60_000);
  schedulerInterval.unref();

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: { server: httpServer },
        allowedHosts: true,
        ws: hmrDisabled ? false : { server: httpServer },
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });

    if (hmrDisabled) {
      app.get('/@vite/client', async (_req: Request, res: Response, next: NextFunction) => {
        try {
          const result = await vite.transformRequest('/@vite/client');
          if (!result) {
            next();
            return;
          }
          const startMarker = 'const transport = normalizeModuleRunnerTransport(';
          const endMarker = 'let willUnload = false;';
          const startIdx = result.code.indexOf(startMarker);
          const endIdx = startIdx !== -1 ? result.code.indexOf(endMarker, startIdx) : -1;
          const patched =
            startIdx !== -1 && endIdx !== -1
              ? result.code.slice(0, startIdx) +
                'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, send() {} });\n' +
                result.code.slice(endIdx)
              : result.code.replace(
                  'transport.connect(createHMRHandler(handleMessage));',
                  '/* HMR disabled via DISABLE_HMR=true */'
                );
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.send(patched);
        } catch (err) {
          next(err);
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');

    // Never cache the Service Worker or HTML entry so PWA updates & offline shell propagate cleanly
    app.get('/sw.js', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.sendFile(path.join(distDir, 'sw.js'));
    });

    app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.sendFile(path.join(distDir, 'manifest.webmanifest'));
    });

    app.use('/assets', express.static(path.join(distDir, 'assets'), { maxAge: '7d', immutable: true }));
    app.use(
      express.static(distDir, {
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );

    app.use('/api/*', (_req: Request, res: Response) => {
      res.status(404).json({ error: 'المسار غير موجود' });
    });

    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم' });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`WIRD server listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down WIRD server gracefully...`);
    clearInterval(schedulerInterval);
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8_000).unref();
  };

  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start WIRD server:', err);
  process.exit(1);
});
