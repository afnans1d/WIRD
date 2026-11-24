import { runCronCycle } from './scheduler.ts';
import {
  computeNextDueUtcMs,
  getClockInTimezone,
  isValidHHMM,
  normalizeTimezone,
} from './timezone.ts';
import type {
  DeliveryJobRow,
  Env,
  ExecutionContext,
  PushSubscriptionRow,
  SchedulePreferencesInput,
  ScheduledController,
} from './types.ts';
import {
  isAllowedPushEndpoint,
  sendWebPushNotification,
} from './webpush.ts';

const MAX_BODY_BYTES = 8192;
const TEST_COOLDOWN_MS = 30_000;
const encoder = new TextEncoder();

function timingSafeEqualStr(a: string, b: string): boolean {
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  if (bytesA.length !== bytesB.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function getCorsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;

  const allowedList = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedList.includes(origin)) {
    return origin;
  }

  if (env.ALLOW_LOCAL_ORIGINS === 'true') {
    try {
      const url = new URL(origin);
      if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname.endsWith('.run.app')
      ) {
        return origin;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const allowedOrigin = getCorsOrigin(request, env);
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Token',
    'Access-Control-Max-Age': '86400',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function jsonResponse(
  request: Request,
  env: Env,
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...buildCorsHeaders(request, env),
    },
  });
}

async function readJsonBody<T extends Record<string, unknown>>(
  request: Request
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large.' };
  }

  const rawText = await request.text();
  if (encoder.encode(rawText).byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large.' };
  }

  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: 'Invalid JSON object.' };
    }
    return { ok: true, data: parsed as T };
  } catch {
    return { ok: false, status: 400, error: 'Malformed JSON body.' };
  }
}

function validateDeviceId(deviceId: unknown): deviceId is string {
  return typeof deviceId === 'string' && /^[a-zA-Z0-9_\-]{8,128}$/.test(deviceId);
}

function validateDeviceSecret(secret: string | null): secret is string {
  return typeof secret === 'string' && secret.trim().length >= 24 && secret.trim().length <= 256;
}

function normalizePreferences(raw: unknown): SchedulePreferencesInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const morningTime = typeof obj.morningTime === 'string' ? obj.morningTime.trim() : '06:00';
  const eveningTime = typeof obj.eveningTime === 'string' ? obj.eveningTime.trim() : '17:30';
  const quietHoursStart =
    typeof obj.quietHoursStart === 'string' ? obj.quietHoursStart.trim() : '23:00';
  const quietHoursEnd =
    typeof obj.quietHoursEnd === 'string' ? obj.quietHoursEnd.trim() : '04:30';

  if (
    !isValidHHMM(morningTime) ||
    !isValidHHMM(eveningTime) ||
    !isValidHHMM(quietHoursStart) ||
    !isValidHHMM(quietHoursEnd)
  ) {
    return null;
  }

  return {
    timezone: normalizeTimezone(typeof obj.timezone === 'string' ? obj.timezone : 'Asia/Riyadh'),
    morningEnabled: Boolean(obj.morningEnabled),
    eveningEnabled: Boolean(obj.eveningEnabled),
    morningTime,
    eveningTime,
    quietHoursEnabled: Boolean(obj.quietHoursEnabled),
    quietHoursStart,
    quietHoursEnd,
  };
}

async function authorizeDeviceSubscription(
  env: Env,
  deviceId: string,
  tokenHeader: string | null
): Promise<
  | { ok: true; subscription: PushSubscriptionRow | null; tokenHash: string }
  | { ok: false; status: number; error: string }
> {
  if (!validateDeviceSecret(tokenHeader)) {
    return { ok: false, status: 401, error: 'Missing or invalid X-Device-Token header.' };
  }

  const tokenHash = await sha256Hex(tokenHeader.trim());
  const existing = await env.DB.prepare(
    'SELECT * FROM push_subscriptions WHERE device_id = ? ORDER BY updated_at DESC LIMIT 1'
  )
    .bind(deviceId)
    .first<PushSubscriptionRow>();

  if (existing && !timingSafeEqualStr(existing.owner_token_hash, tokenHash)) {
    return { ok: false, status: 403, error: 'Device ownership token mismatch.' };
  }

  return { ok: true, subscription: existing, tokenHash };
}

export function createWorkerApp(options: { fetchFn?: typeof fetch } = {}) {
  return {
    async fetch(
      request: Request,
      env: Env,
      _ctx?: ExecutionContext
    ): Promise<Response> {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: buildCorsHeaders(request, env),
        });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'GET' && path === '/api/health') {
        return jsonResponse(request, env, { ok: true, service: 'wird-push-worker' });
      }

      if (request.method === 'GET' && path === '/api/push/vapid-public-key') {
        if (!env.VAPID_PUBLIC_KEY) {
          return jsonResponse(request, env, { error: 'VAPID public key is not configured.' }, 503);
        }
        return jsonResponse(request, env, { publicKey: env.VAPID_PUBLIC_KEY.trim() });
      }

      if (request.method === 'POST' && path === '/api/push/subscribe') {
        const parsed = await readJsonBody<{
          deviceId?: unknown;
          subscription?: {
            endpoint?: unknown;
            keys?: { p256dh?: unknown; auth?: unknown };
          };
          preferences?: unknown;
        }>(request);

        if (!parsed.ok) {
          return jsonResponse(request, env, { error: parsed.error }, parsed.status);
        }

        const { deviceId, subscription, preferences } = parsed.data;
        if (!validateDeviceId(deviceId)) {
          return jsonResponse(request, env, { error: 'Invalid deviceId.' }, 400);
        }

        const authRes = await authorizeDeviceSubscription(
          env,
          deviceId,
          request.headers.get('X-Device-Token')
        );
        if (!authRes.ok) {
          return jsonResponse(request, env, { error: authRes.error }, authRes.status);
        }

        const endpoint = subscription?.endpoint;
        const p256dh = subscription?.keys?.p256dh;
        const authKey = subscription?.keys?.auth;

        if (
          typeof endpoint !== 'string' ||
          typeof p256dh !== 'string' ||
          typeof authKey !== 'string' ||
          endpoint.length > 1024 ||
          p256dh.length < 20 ||
          authKey.length < 12
        ) {
          return jsonResponse(request, env, { error: 'Invalid PushSubscription payload.' }, 400);
        }

        if (!isAllowedPushEndpoint(endpoint)) {
          return jsonResponse(request, env, { error: 'Unsupported or disallowed Push endpoint.' }, 400);
        }

        const prefs = normalizePreferences(preferences);
        if (!prefs) {
          return jsonResponse(request, env, { error: 'Invalid notification preferences.' }, 400);
        }

        // Prevent hijacking an endpoint already registered to another device owner
        const byEndpoint = await env.DB.prepare(
          'SELECT subscription_id, device_id, owner_token_hash FROM push_subscriptions WHERE endpoint = ?'
        )
          .bind(endpoint)
          .first<{ subscription_id: string; device_id: string; owner_token_hash: string }>();

        if (
          byEndpoint &&
          byEndpoint.device_id !== deviceId &&
          !timingSafeEqualStr(byEndpoint.owner_token_hash, authRes.tokenHash)
        ) {
          return jsonResponse(
            request,
            env,
            { error: 'Endpoint belongs to another device ownership token.' },
            403
          );
        }

        const nowMs = Date.now();
        const subscriptionId =
          byEndpoint?.subscription_id ||
          authRes.subscription?.subscription_id ||
          `sub_${crypto.randomUUID().replace(/-/g, '')}`;

        const nextMorningAt = computeNextDueUtcMs({
          enabled: prefs.morningEnabled,
          timeHHMM: prefs.morningTime,
          timezone: prefs.timezone,
          nowMs,
          completedDateKey: authRes.subscription?.completed_morning_date,
          sameMinuteGraceMs: 60_000,
        });

        const nextEveningAt = computeNextDueUtcMs({
          enabled: prefs.eveningEnabled,
          timeHHMM: prefs.eveningTime,
          timezone: prefs.timezone,
          nowMs,
          completedDateKey: authRes.subscription?.completed_evening_date,
          sameMinuteGraceMs: 60_000,
        });

        await env.DB.prepare(
          `INSERT INTO push_subscriptions (
             subscription_id, device_id, owner_token_hash, endpoint, p256dh, auth,
             timezone, morning_enabled, evening_enabled, morning_time, evening_time,
             quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
             completed_morning_date, completed_evening_date,
             next_morning_at, next_evening_at, is_active, deactivated_reason,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
           ON CONFLICT(subscription_id) DO UPDATE SET
             device_id = excluded.device_id,
             endpoint = excluded.endpoint,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             timezone = excluded.timezone,
             morning_enabled = excluded.morning_enabled,
             evening_enabled = excluded.evening_enabled,
             morning_time = excluded.morning_time,
             evening_time = excluded.evening_time,
             quiet_hours_enabled = excluded.quiet_hours_enabled,
             quiet_hours_start = excluded.quiet_hours_start,
             quiet_hours_end = excluded.quiet_hours_end,
             next_morning_at = excluded.next_morning_at,
             next_evening_at = excluded.next_evening_at,
             is_active = 1,
             deactivated_reason = NULL,
             updated_at = excluded.updated_at`
        )
          .bind(
            subscriptionId,
            deviceId,
            authRes.tokenHash,
            endpoint,
            p256dh,
            authKey,
            prefs.timezone,
            prefs.morningEnabled ? 1 : 0,
            prefs.eveningEnabled ? 1 : 0,
            prefs.morningTime,
            prefs.eveningTime,
            prefs.quietHoursEnabled ? 1 : 0,
            prefs.quietHoursStart,
            prefs.quietHoursEnd,
            authRes.subscription?.completed_morning_date || null,
            authRes.subscription?.completed_evening_date || null,
            nextMorningAt,
            nextEveningAt,
            nowMs,
            nowMs
          )
          .run();

        return jsonResponse(request, env, {
          ok: true,
          subscriptionId,
          nextMorningAt,
          nextEveningAt,
        });
      }

      if (request.method === 'POST' && path === '/api/push/preferences') {
        const parsed = await readJsonBody<{
          deviceId?: unknown;
          preferences?: unknown;
        }>(request);

        if (!parsed.ok) {
          return jsonResponse(request, env, { error: parsed.error }, parsed.status);
        }

        if (!validateDeviceId(parsed.data.deviceId)) {
          return jsonResponse(request, env, { error: 'Invalid deviceId.' }, 400);
        }

        const authRes = await authorizeDeviceSubscription(
          env,
          parsed.data.deviceId,
          request.headers.get('X-Device-Token')
        );
        if (!authRes.ok) {
          return jsonResponse(request, env, { error: authRes.error }, authRes.status);
        }

        if (!authRes.subscription) {
          return jsonResponse(request, env, { error: 'Subscription not found for device.' }, 404);
        }

        const prefs = normalizePreferences(parsed.data.preferences);
        if (!prefs) {
          return jsonResponse(request, env, { error: 'Invalid notification preferences.' }, 400);
        }

        const nowMs = Date.now();
        const nextMorningAt = computeNextDueUtcMs({
          enabled: prefs.morningEnabled,
          timeHHMM: prefs.morningTime,
          timezone: prefs.timezone,
          nowMs,
          completedDateKey: authRes.subscription.completed_morning_date,
          sameMinuteGraceMs: 60_000,
        });
        const nextEveningAt = computeNextDueUtcMs({
          enabled: prefs.eveningEnabled,
          timeHHMM: prefs.eveningTime,
          timezone: prefs.timezone,
          nowMs,
          completedDateKey: authRes.subscription.completed_evening_date,
          sameMinuteGraceMs: 60_000,
        });

        await env.DB.prepare(
          `UPDATE push_subscriptions
           SET timezone = ?, morning_enabled = ?, evening_enabled = ?,
               morning_time = ?, evening_time = ?,
               quiet_hours_enabled = ?, quiet_hours_start = ?, quiet_hours_end = ?,
               next_morning_at = ?, next_evening_at = ?, updated_at = ?
           WHERE subscription_id = ?`
        )
          .bind(
            prefs.timezone,
            prefs.morningEnabled ? 1 : 0,
            prefs.eveningEnabled ? 1 : 0,
            prefs.morningTime,
            prefs.eveningTime,
            prefs.quietHoursEnabled ? 1 : 0,
            prefs.quietHoursStart,
            prefs.quietHoursEnd,
            nextMorningAt,
            nextEveningAt,
            nowMs,
            authRes.subscription.subscription_id
          )
          .run();

        return jsonResponse(request, env, {
          ok: true,
          nextMorningAt,
          nextEveningAt,
        });
      }

      if (request.method === 'POST' && path === '/api/push/session-status') {
        const parsed = await readJsonBody<{
          deviceId?: unknown;
          period?: unknown;
          dateKey?: unknown;
          isCompleted?: unknown;
        }>(request);

        if (!parsed.ok) {
          return jsonResponse(request, env, { error: parsed.error }, parsed.status);
        }

        const { deviceId, period, dateKey, isCompleted } = parsed.data;
        if (
          !validateDeviceId(deviceId) ||
          (period !== 'morning' && period !== 'evening') ||
          typeof dateKey !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)
        ) {
          return jsonResponse(request, env, { error: 'Invalid session status payload.' }, 400);
        }

        const authRes = await authorizeDeviceSubscription(
          env,
          deviceId,
          request.headers.get('X-Device-Token')
        );
        if (!authRes.ok) {
          return jsonResponse(request, env, { error: authRes.error }, authRes.status);
        }

        if (!authRes.subscription) {
          return jsonResponse(request, env, { ok: true, skipped: true });
        }

        const nowMs = Date.now();
        const completedVal = isCompleted ? dateKey : null;
        const nextCol = period === 'morning' ? 'next_morning_at' : 'next_evening_at';
        const completedCol =
          period === 'morning' ? 'completed_morning_date' : 'completed_evening_date';
        const enabled =
          period === 'morning'
            ? authRes.subscription.morning_enabled === 1
            : authRes.subscription.evening_enabled === 1;
        const targetTime =
          period === 'morning'
            ? authRes.subscription.morning_time
            : authRes.subscription.evening_time;

        const nextAt = computeNextDueUtcMs({
          enabled,
          timeHHMM: targetTime,
          timezone: authRes.subscription.timezone,
          nowMs,
          completedDateKey: completedVal,
        });

        await env.DB.prepare(
          `UPDATE push_subscriptions
           SET ${completedCol} = ?, ${nextCol} = ?, updated_at = ?
           WHERE subscription_id = ?`
        )
          .bind(completedVal, nextAt, nowMs, authRes.subscription.subscription_id)
          .run();

        return jsonResponse(request, env, { ok: true, nextAt });
      }

      if (request.method === 'POST' && path === '/api/push/unsubscribe') {
        const parsed = await readJsonBody<{ deviceId?: unknown }>(request);
        if (!parsed.ok) {
          return jsonResponse(request, env, { error: parsed.error }, parsed.status);
        }

        if (!validateDeviceId(parsed.data.deviceId)) {
          return jsonResponse(request, env, { error: 'Invalid deviceId.' }, 400);
        }

        const authRes = await authorizeDeviceSubscription(
          env,
          parsed.data.deviceId,
          request.headers.get('X-Device-Token')
        );
        if (!authRes.ok) {
          return jsonResponse(request, env, { error: authRes.error }, authRes.status);
        }

        if (!authRes.subscription) {
          return jsonResponse(request, env, { ok: true });
        }

        const nowMs = Date.now();
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE push_subscriptions
             SET is_active = 0, deactivated_reason = 'user_unsubscribed',
                 next_morning_at = NULL, next_evening_at = NULL, updated_at = ?
             WHERE subscription_id = ?`
          ).bind(nowMs, authRes.subscription.subscription_id),
          env.DB.prepare(
            `UPDATE delivery_jobs
             SET status = 'cancelled', last_error = 'user_unsubscribed', lease_until = NULL, updated_at = ?
             WHERE subscription_id = ? AND status IN ('pending', 'failed')`
          ).bind(nowMs, authRes.subscription.subscription_id),
        ]);

        return jsonResponse(request, env, { ok: true });
      }

      if (request.method === 'POST' && path === '/api/push/send-test') {
        const parsed = await readJsonBody<{
          deviceId?: unknown;
          period?: unknown;
        }>(request);
        if (!parsed.ok) {
          return jsonResponse(request, env, { error: parsed.error }, parsed.status);
        }

        const { deviceId, period } = parsed.data;
        if (!validateDeviceId(deviceId) || (period !== 'morning' && period !== 'evening')) {
          return jsonResponse(request, env, { error: 'Invalid deviceId or period.' }, 400);
        }

        const authRes = await authorizeDeviceSubscription(
          env,
          deviceId,
          request.headers.get('X-Device-Token')
        );
        if (!authRes.ok) {
          return jsonResponse(request, env, { error: authRes.error }, authRes.status);
        }

        const sub = authRes.subscription;
        if (!sub || sub.is_active !== 1) {
          return jsonResponse(request, env, { error: 'No active subscription found.' }, 404);
        }

        const nowMs = Date.now();
        if (sub.last_test_at && nowMs - sub.last_test_at < TEST_COOLDOWN_MS) {
          return jsonResponse(
            request,
            env,
            { error: 'Please wait 30 seconds before sending another test push.' },
            429
          );
        }

        const result = await sendWebPushNotification({
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          payload:
            period === 'morning'
              ? {
                  title: 'وِرد · أذكار الصباح (تجربة)',
                  body: 'صباح الخير ☀️ تم توصيل الإشعار عبر Cloudflare Worker',
                  url: '/?session=morning',
                  period: 'morning',
                  tag: 'wird-test-morning',
                }
              : {
                  title: 'وِرد · أذكار المساء (تجربة)',
                  body: 'مساء الخير 🌙 تم توصيل الإشعار عبر Cloudflare Worker',
                  url: '/?session=evening',
                  period: 'evening',
                  tag: 'wird-test-evening',
                },
          vapidSubject: env.VAPID_SUBJECT,
          vapidPublicKey: env.VAPID_PUBLIC_KEY,
          vapidPrivateKey: env.VAPID_PRIVATE_KEY,
          ttlSeconds: 300,
          urgency: 'high',
          fetchFn: options.fetchFn,
        });

        const clock = getClockInTimezone(sub.timezone, nowMs);
        const jobId = `job_${crypto.randomUUID().replace(/-/g, '')}`;
        const stmts = [
          env.DB.prepare('UPDATE push_subscriptions SET last_test_at = ?, updated_at = ? WHERE subscription_id = ?').bind(
            nowMs,
            nowMs,
            sub.subscription_id
          ),
          env.DB.prepare(
            `INSERT INTO delivery_jobs (
               job_id, job_key, subscription_id, device_id, period, date_key,
               scheduled_for, status, attempts, max_attempts, http_status, last_error,
               created_at, updated_at, sent_at
             ) VALUES (?, ?, ?, ?, 'test', ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)`
          ).bind(
            jobId,
            `instant_test:${sub.subscription_id}:${nowMs}`,
            sub.subscription_id,
            sub.device_id,
            clock.dateKey,
            nowMs,
            result.ok ? 'sent' : 'failed',
            result.statusCode || null,
            result.errorMessage || null,
            nowMs,
            nowMs,
            result.ok ? nowMs : null
          ),
        ];

        if (result.statusCode === 404 || result.statusCode === 410) {
          stmts.push(
            env.DB.prepare(
              `UPDATE push_subscriptions
               SET is_active = 0, deactivated_reason = ?, next_morning_at = NULL, next_evening_at = NULL, updated_at = ?
               WHERE subscription_id = ?`
            ).bind(`push_endpoint_gone_${result.statusCode}`, nowMs, sub.subscription_id)
          );
        }

        await env.DB.batch(stmts);

        if (!result.ok) {
          return jsonResponse(
            request,
            env,
            { ok: false, statusCode: result.statusCode, error: result.errorMessage },
            502
          );
        }

        return jsonResponse(request, env, { ok: true, statusCode: result.statusCode });
      }

      if (request.method === 'POST' && path === '/api/push/schedule-test') {
        const parsed = await readJsonBody<{
          deviceId?: unknown;
          delaySeconds?: unknown;
        }>(request);
        if (!parsed.ok) {
          return jsonResponse(request, env, { error: parsed.error }, parsed.status);
        }

        const { deviceId, delaySeconds } = parsed.data;
        if (!validateDeviceId(deviceId)) {
          return jsonResponse(request, env, { error: 'Invalid deviceId.' }, 400);
        }

        const authRes = await authorizeDeviceSubscription(
          env,
          deviceId,
          request.headers.get('X-Device-Token')
        );
        if (!authRes.ok) {
          return jsonResponse(request, env, { error: authRes.error }, authRes.status);
        }

        const sub = authRes.subscription;
        if (!sub || sub.is_active !== 1) {
          return jsonResponse(request, env, { error: 'No active subscription found.' }, 404);
        }

        const nowMs = Date.now();
        if (sub.last_test_at && nowMs - sub.last_test_at < TEST_COOLDOWN_MS) {
          return jsonResponse(
            request,
            env,
            { error: 'Please wait 30 seconds before scheduling another test.' },
            429
          );
        }

        const rawDelay = typeof delaySeconds === 'number' ? delaySeconds : 60;
        const clampedDelaySec = Math.max(30, Math.min(300, Math.round(rawDelay)));
        const scheduledFor = nowMs + clampedDelaySec * 1000;
        const clock = getClockInTimezone(sub.timezone, scheduledFor);
        const jobId = `job_${crypto.randomUUID().replace(/-/g, '')}`;

        await env.DB.batch([
          env.DB.prepare(
            'UPDATE push_subscriptions SET last_test_at = ?, updated_at = ? WHERE subscription_id = ?'
          ).bind(nowMs, nowMs, sub.subscription_id),
          env.DB.prepare(
            `INSERT INTO delivery_jobs (
               job_id, job_key, subscription_id, device_id, period, date_key,
               scheduled_for, status, attempts, max_attempts, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'test', ?, ?, 'pending', 0, 3, ?, ?)`
          ).bind(
            jobId,
            `sched_test:${sub.subscription_id}:${nowMs}`,
            sub.subscription_id,
            sub.device_id,
            clock.dateKey,
            scheduledFor,
            nowMs,
            nowMs
          ),
        ]);

        return jsonResponse(request, env, {
          ok: true,
          jobId,
          scheduledFor,
        });
      }

      if (request.method === 'GET' && path === '/api/push/deliveries') {
        const deviceId = url.searchParams.get('deviceId');
        if (!validateDeviceId(deviceId)) {
          return jsonResponse(request, env, { error: 'Invalid deviceId.' }, 400);
        }

        const authRes = await authorizeDeviceSubscription(
          env,
          deviceId,
          request.headers.get('X-Device-Token')
        );
        if (!authRes.ok) {
          return jsonResponse(request, env, { error: authRes.error }, authRes.status);
        }

        const jobsRes = await env.DB.prepare(
          `SELECT job_id, period, date_key, status, http_status, last_error, created_at, scheduled_for, sent_at
           FROM delivery_jobs
           WHERE device_id = ?
           ORDER BY created_at DESC
           LIMIT 20`
        )
          .bind(deviceId)
          .all<Partial<DeliveryJobRow>>();

        return jsonResponse(request, env, {
          isActive: Boolean(authRes.subscription && authRes.subscription.is_active === 1),
          nextMorningAt: authRes.subscription?.next_morning_at ?? null,
          nextEveningAt: authRes.subscription?.next_evening_at ?? null,
          deliveries: (jobsRes.results || []).map((row) => ({
            id: row.job_id,
            period: row.period,
            dateKey: row.date_key,
            status: row.status,
            statusCode: row.http_status ?? undefined,
            errorMessage: row.last_error ?? undefined,
            scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : undefined,
            createdAt: new Date(row.sent_at || row.created_at || Date.now()).toISOString(),
          })),
        });
      }

      if (request.method === 'POST' && path === '/api/notifications/process-due') {
        if (!env.CRON_SECRET) {
          return jsonResponse(request, env, { error: 'CRON_SECRET is not configured.' }, 503);
        }
        const authHeader = request.headers.get('Authorization') || '';
        const expected = `Bearer ${env.CRON_SECRET}`;
        if (!timingSafeEqualStr(authHeader, expected)) {
          return jsonResponse(request, env, { error: 'Unauthorized.' }, 401);
        }

        const summary = await runCronCycle(env, { fetchFn: options.fetchFn });
        return jsonResponse(request, env, summary, summary.ok ? 200 : 500);
      }

      return jsonResponse(request, env, { error: 'Not found.' }, 404);
    },

    async scheduled(
      _controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ): Promise<void> {
      ctx.waitUntil(runCronCycle(env, { fetchFn: options.fetchFn }));
    },
  };
}

export default createWorkerApp();
