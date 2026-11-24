import {
  computeNextDueUtcMs,
  getClockInTimezone,
  isWithinQuietHours,
} from './timezone.ts';
import type {
  AdhkarPeriod,
  D1Database,
  D1PreparedStatement,
  DeliveryJobRow,
  Env,
  JobPeriod,
  PushSubscriptionRow,
} from './types.ts';
import { sendWebPushNotification } from './webpush.ts';

export const DEFAULT_ADAPTIVE_BATCH = 3;
export const MIN_ADAPTIVE_BATCH = 1;
export const MAX_ADAPTIVE_BATCH = 4;
export const DUE_SUBSCRIPTIONS_PER_TICK = 15;
export const LEASE_DURATION_MS = 120_000;
export const MAX_IO_WALL_MS = 12_000;
export const D1_CIRCUIT_COOLDOWN_MS = 5 * 60_000;

export interface CronCycleSummary {
  ok: boolean;
  abortedReason?: string;
  recoveredStaleLeases: number;
  enqueuedJobs: number;
  attemptedJobs: number;
  sentJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  releasedEarlyJobs: number;
  adaptiveBatchSize: number;
}

export function isD1QuotaOrTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('exceeded') ||
    msg.includes('limit') ||
    msg.includes('sqlite_busy') ||
    msg.includes('too many') ||
    msg.includes('d1_error') ||
    msg.includes('storage') ||
    msg.includes('rate')
  );
}

async function getWorkerStateInt(db: D1Database, key: string, fallback: number): Promise<number> {
  const row = await db
    .prepare('SELECT value FROM worker_state WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

async function setWorkerStateInt(
  db: D1Database,
  key: string,
  value: number,
  nowMs: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO worker_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, String(value), nowMs)
    .run();
}

export function buildNotificationPayload(period: JobPeriod): Record<string, unknown> {
  if (period === 'morning') {
    return {
      title: 'وِرد · أذكار الصباح',
      body: 'صباح الخير ☀️ حان وقت أذكار الصباح حفظك الله',
      url: '/?session=morning',
      period: 'morning',
      tag: 'wird-morning-reminder',
    };
  }
  if (period === 'evening') {
    return {
      title: 'وِرد · أذكار المساء',
      body: 'مساء الخير 🌙 حان وقت أذكار المساء حفظك الله',
      url: '/?session=evening',
      period: 'evening',
      tag: 'wird-evening-reminder',
    };
  }
  return {
    title: 'وِرد · إشعار تجريبي مجدول',
    body: 'تم استلام الإشعار المجدول بنجاح عبر Cloudflare Worker ✓',
    url: '/?notifications=1',
    period: 'morning',
    tag: 'wird-scheduled-test',
  };
}

/**
 * Recovers jobs stuck in 'processing' past lease_until (likely previous CPU/timeout crash)
 * and reduces adaptive batch size when stale leases are detected.
 */
export async function recoverStaleLeases(
  db: D1Database,
  nowMs: number
): Promise<{ recovered: number; batchSize: number }> {
  const currentBatch = Math.min(
    MAX_ADAPTIVE_BATCH,
    Math.max(MIN_ADAPTIVE_BATCH, await getWorkerStateInt(db, 'adaptive_batch_size', DEFAULT_ADAPTIVE_BATCH))
  );

  const staleRes = await db
    .prepare(
      `SELECT * FROM delivery_jobs
       WHERE status = 'processing' AND lease_until IS NOT NULL AND lease_until < ?
       LIMIT 20`
    )
    .bind(nowMs)
    .all<DeliveryJobRow>();

  const staleRows = staleRes.results || [];
  if (staleRows.length === 0) {
    return { recovered: 0, batchSize: currentBatch };
  }

  const statements: D1PreparedStatement[] = [];
  for (const job of staleRows) {
    const nextAttempts = job.attempts + 1;
    if (nextAttempts >= job.max_attempts) {
      statements.push(
        db
          .prepare(
            `UPDATE delivery_jobs
             SET status = 'failed', attempts = ?, lease_until = NULL, next_retry_at = NULL,
                 last_error = ?, updated_at = ?
             WHERE job_id = ? AND status = 'processing'`
          )
          .bind(nextAttempts, 'Expired worker lease after max attempts', nowMs, job.job_id)
      );
    } else {
      statements.push(
        db
          .prepare(
            `UPDATE delivery_jobs
             SET status = 'pending', attempts = ?, lease_until = NULL,
                 last_error = ?, updated_at = ?
             WHERE job_id = ? AND status = 'processing'`
          )
          .bind(nextAttempts, 'Recovered from expired worker lease', nowMs, job.job_id)
      );
    }
  }

  const halvedBatch = Math.max(MIN_ADAPTIVE_BATCH, Math.floor(currentBatch / 2));
  statements.push(
    db
      .prepare(
        `INSERT INTO worker_state (key, value, updated_at) VALUES ('adaptive_batch_size', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(String(halvedBatch), nowMs),
    db
      .prepare(
        `INSERT INTO worker_state (key, value, updated_at) VALUES ('clean_streak', '0', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(nowMs)
  );

  await db.batch(statements);
  return { recovered: staleRows.length, batchSize: halvedBatch };
}

/**
 * Due-task-driven enqueueing: queries ONLY subscriptions whose next_morning_at <= nowMs
 * or next_evening_at <= nowMs via partial indexes. Zero full-table scans.
 */
export async function enqueueDueSubscriptionJobs(
  db: D1Database,
  nowMs: number,
  graceMinutes: number
): Promise<number> {
  let enqueued = 0;

  const periods: AdhkarPeriod[] = ['morning', 'evening'];
  for (const period of periods) {
    const col = period === 'morning' ? 'next_morning_at' : 'next_evening_at';
    const enabledCol = period === 'morning' ? 'morning_enabled' : 'evening_enabled';
    const completedCol = period === 'morning' ? 'completed_morning_date' : 'completed_evening_date';
    const timeCol = period === 'morning' ? 'morning_time' : 'evening_time';

    const dueSubs = await db
      .prepare(
        `SELECT * FROM push_subscriptions
         WHERE is_active = 1 AND ${enabledCol} = 1 AND ${col} IS NOT NULL AND ${col} <= ?
         ORDER BY ${col} ASC, subscription_id ASC
         LIMIT ?`
      )
      .bind(nowMs, DUE_SUBSCRIPTIONS_PER_TICK)
      .all<PushSubscriptionRow>();

    for (const sub of dueSubs.results || []) {
      const scheduledAt = period === 'morning' ? sub.next_morning_at : sub.next_evening_at;
      if (scheduledAt === null) continue;

      const scheduledClock = getClockInTimezone(sub.timezone, scheduledAt);
      const nowClock = getClockInTimezone(sub.timezone, nowMs);
      const completedDate = sub[completedCol];
      const targetTime = sub[timeCol];

      const elapsedMs = nowMs - scheduledAt;
      const withinGrace = elapsedMs >= 0 && elapsedMs <= graceMinutes * 60_000;
      const inQuietHours =
        sub.quiet_hours_enabled === 1 &&
        isWithinQuietHours(nowClock.hhmm, sub.quiet_hours_start, sub.quiet_hours_end);
      const completedToday = completedDate === scheduledClock.dateKey;

      const nextDueMs = computeNextDueUtcMs({
        enabled: true,
        timeHHMM: targetTime,
        timezone: sub.timezone,
        nowMs,
        completedDateKey: completedDate,
        forceAfterDateKey: scheduledClock.dateKey,
      });

      const batchStmts: D1PreparedStatement[] = [];
      let willInsert = false;

      if (withinGrace && !inQuietHours && !completedToday) {
        willInsert = true;
        const jobId = `job_${crypto.randomUUID().replace(/-/g, '')}`;
        const jobKey = `${sub.subscription_id}:${scheduledClock.dateKey}:${period}`;
        batchStmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO delivery_jobs (
                 job_id, job_key, subscription_id, device_id, period, date_key,
                 scheduled_for, status, attempts, max_attempts, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, ?, ?)`
            )
            .bind(
              jobId,
              jobKey,
              sub.subscription_id,
              sub.device_id,
              period,
              scheduledClock.dateKey,
              scheduledAt,
              nowMs,
              nowMs
            )
        );
      }

      batchStmts.push(
        db
          .prepare(
            `UPDATE push_subscriptions SET ${col} = ?, updated_at = ? WHERE subscription_id = ?`
          )
          .bind(nextDueMs, nowMs, sub.subscription_id)
      );

      const batchResults = await db.batch(batchStmts);
      if (willInsert && (batchResults[0]?.meta?.changes ?? 0) > 0) {
        enqueued++;
      }
    }
  }

  return enqueued;
}

/**
 * Claims up to `batchSize` eligible delivery jobs into 'processing' and dispatches
 * them sequentially, committing every outcome immediately to D1.
 */
export async function processDeliveryQueue(
  db: D1Database,
  env: Env,
  batchSize: number,
  cycleStartMs: number,
  fetchFn?: typeof fetch
): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  cancelled: number;
  releasedEarly: number;
}> {
  const nowMs = Date.now();
  const pendingRes = await db
    .prepare(
      `SELECT * FROM delivery_jobs
       WHERE status = 'pending' AND scheduled_for <= ?
       ORDER BY scheduled_for ASC, created_at ASC
       LIMIT ?`
    )
    .bind(nowMs, batchSize)
    .all<DeliveryJobRow>();

  const candidates: DeliveryJobRow[] = [...(pendingRes.results || [])];
  if (candidates.length < batchSize) {
    const remaining = batchSize - candidates.length;
    const retryRes = await db
      .prepare(
        `SELECT * FROM delivery_jobs
         WHERE status = 'failed'
           AND attempts < max_attempts
           AND next_retry_at IS NOT NULL
           AND next_retry_at <= ?
         ORDER BY next_retry_at ASC, created_at ASC
         LIMIT ?`
      )
      .bind(nowMs, remaining)
      .all<DeliveryJobRow>();
    candidates.push(...(retryRes.results || []));
  }

  if (candidates.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, cancelled: 0, releasedEarly: 0 };
  }

  const leaseUntil = nowMs + LEASE_DURATION_MS;
  const claimedJobs: DeliveryJobRow[] = [];

  for (const job of candidates) {
    const claimRes = await db
      .prepare(
        `UPDATE delivery_jobs
         SET status = 'processing', lease_until = ?, updated_at = ?
         WHERE job_id = ?
           AND (status = 'pending' OR (status = 'failed' AND next_retry_at <= ?))`
      )
      .bind(leaseUntil, nowMs, job.job_id, nowMs)
      .run();

    if ((claimRes.meta?.changes ?? 0) > 0) {
      claimedJobs.push({ ...job, status: 'processing', lease_until: leaseUntil });
    }
  }

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  let releasedEarly = 0;

  for (let i = 0; i < claimedJobs.length; i++) {
    const job = claimedJobs[i];

    // I/O wall-step checkpoint guard between deliveries
    if (i > 0 && Date.now() - cycleStartMs >= MAX_IO_WALL_MS) {
      const remainingIds = claimedJobs.slice(i).map((j) => j.job_id);
      const releaseStmts = remainingIds.map((id) =>
        db
          .prepare(
            `UPDATE delivery_jobs
             SET status = 'pending', lease_until = NULL, updated_at = ?
             WHERE job_id = ? AND status = 'processing'`
          )
          .bind(Date.now(), id)
      );
      await db.batch(releaseStmts);
      releasedEarly = remainingIds.length;
      break;
    }

    const freshSub = await db
      .prepare('SELECT * FROM push_subscriptions WHERE subscription_id = ?')
      .bind(job.subscription_id)
      .first<PushSubscriptionRow>();

    let cancelReason: string | null = null;
    if (!freshSub || freshSub.is_active !== 1) {
      cancelReason = 'subscription_inactive';
    } else if (job.period !== 'test') {
      const enabled =
        job.period === 'morning'
          ? freshSub.morning_enabled === 1
          : freshSub.evening_enabled === 1;
      const completedDate =
        job.period === 'morning'
          ? freshSub.completed_morning_date
          : freshSub.completed_evening_date;
      const nowClock = getClockInTimezone(freshSub.timezone, Date.now());

      if (!enabled) {
        cancelReason = 'period_disabled';
      } else if (completedDate === job.date_key) {
        cancelReason = 'completed_today';
      } else if (
        freshSub.quiet_hours_enabled === 1 &&
        isWithinQuietHours(nowClock.hhmm, freshSub.quiet_hours_start, freshSub.quiet_hours_end)
      ) {
        cancelReason = 'quiet_hours';
      }
    }

    if (cancelReason || !freshSub) {
      await db
        .prepare(
          `UPDATE delivery_jobs
           SET status = 'cancelled', lease_until = NULL, last_error = ?, updated_at = ?
           WHERE job_id = ?`
        )
        .bind(cancelReason || 'subscription_missing', Date.now(), job.job_id)
        .run();
      cancelled++;
      continue;
    }

    attempted++;

    let pushResult;
    try {
      pushResult = await sendWebPushNotification({
        endpoint: freshSub.endpoint,
        p256dh: freshSub.p256dh,
        auth: freshSub.auth,
        payload: buildNotificationPayload(job.period),
        vapidSubject: env.VAPID_SUBJECT,
        vapidPublicKey: env.VAPID_PUBLIC_KEY,
        vapidPrivateKey: env.VAPID_PRIVATE_KEY,
        ttlSeconds: job.period === 'test' ? 300 : 3600,
        urgency: job.period === 'test' ? 'high' : 'normal',
        fetchFn,
      });
    } catch (networkErr) {
      pushResult = {
        ok: false,
        statusCode: 0,
        permanentFailure: false,
        errorMessage:
          networkErr instanceof Error ? networkErr.message.slice(0, 180) : 'Push fetch exception',
      };
    }

    const finishedAt = Date.now();
    if (pushResult.ok) {
      await db
        .prepare(
          `UPDATE delivery_jobs
           SET status = 'sent', http_status = ?, last_error = NULL,
               lease_until = NULL, next_retry_at = NULL, sent_at = ?, updated_at = ?
           WHERE job_id = ?`
        )
        .bind(pushResult.statusCode, finishedAt, finishedAt, job.job_id)
        .run();
      sent++;
    } else {
      const nextAttempts = job.attempts + 1;
      const exhausted = pushResult.permanentFailure || nextAttempts >= job.max_attempts;
      const retryBackoffs = [60_000, 300_000, 900_000];
      const nextRetryAt = exhausted
        ? null
        : finishedAt + retryBackoffs[Math.min(nextAttempts - 1, retryBackoffs.length - 1)];

      const stmts: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE delivery_jobs
             SET status = 'failed', attempts = ?, http_status = ?, last_error = ?,
                 lease_until = NULL, next_retry_at = ?, updated_at = ?
             WHERE job_id = ?`
          )
          .bind(
            nextAttempts,
            pushResult.statusCode || null,
            pushResult.errorMessage || 'Delivery failed',
            nextRetryAt,
            finishedAt,
            job.job_id
          ),
      ];

      if (pushResult.statusCode === 404 || pushResult.statusCode === 410) {
        stmts.push(
          db
            .prepare(
              `UPDATE push_subscriptions
               SET is_active = 0, deactivated_reason = ?,
                   next_morning_at = NULL, next_evening_at = NULL, updated_at = ?
               WHERE subscription_id = ?`
            )
            .bind(`push_endpoint_gone_${pushResult.statusCode}`, finishedAt, freshSub.subscription_id)
        );
      }

      await db.batch(stmts);
      failed++;
    }
  }

  return { attempted, sent, failed, cancelled, releasedEarly };
}

async function maybePruneOldJobs(db: D1Database, nowMs: number): Promise<void> {
  const lastPrune = await getWorkerStateInt(db, 'last_prune_at', 0);
  if (nowMs - lastPrune < 86_400_000) return;

  const cutoff = nowMs - 7 * 86_400_000;
  await db
    .prepare(
      `DELETE FROM delivery_jobs
       WHERE job_id IN (
         SELECT job_id FROM delivery_jobs
         WHERE status IN ('sent', 'failed', 'cancelled') AND created_at < ?
         LIMIT 50
       )`
    )
    .bind(cutoff)
    .run();
  await setWorkerStateInt(db, 'last_prune_at', nowMs, nowMs);
}

export async function runCronCycle(
  env: Env,
  options: { nowMs?: number; fetchFn?: typeof fetch } = {}
): Promise<CronCycleSummary> {
  const cycleStartMs = options.nowMs ?? Date.now();
  const graceMinutes = Math.max(1, Math.min(60, Number(env.GRACE_MINUTES || '15') || 15));

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return {
      ok: false,
      abortedReason: 'VAPID credentials are not configured on Worker.',
      recoveredStaleLeases: 0,
      enqueuedJobs: 0,
      attemptedJobs: 0,
      sentJobs: 0,
      failedJobs: 0,
      cancelledJobs: 0,
      releasedEarlyJobs: 0,
      adaptiveBatchSize: DEFAULT_ADAPTIVE_BATCH,
    };
  }

  let recoveredStaleLeases = 0;
  let enqueuedJobs = 0;
  let batchSize = DEFAULT_ADAPTIVE_BATCH;

  try {
    const circuitUntil = await getWorkerStateInt(env.DB, 'd1_circuit_until', 0);
    if (circuitUntil > cycleStartMs) {
      return {
        ok: false,
        abortedReason: 'D1 circuit backoff active; skipping cycle to avoid unrecorded pushes.',
        recoveredStaleLeases: 0,
        enqueuedJobs: 0,
        attemptedJobs: 0,
        sentJobs: 0,
        failedJobs: 0,
        cancelledJobs: 0,
        releasedEarlyJobs: 0,
        adaptiveBatchSize: DEFAULT_ADAPTIVE_BATCH,
      };
    }

    const leaseRecovery = await recoverStaleLeases(env.DB, cycleStartMs);
    recoveredStaleLeases = leaseRecovery.recovered;
    batchSize = leaseRecovery.batchSize;

    enqueuedJobs = await enqueueDueSubscriptionJobs(env.DB, cycleStartMs, graceMinutes);

    const queueRes = await processDeliveryQueue(
      env.DB,
      env,
      batchSize,
      cycleStartMs,
      options.fetchFn
    );

    if (recoveredStaleLeases === 0 && queueRes.releasedEarly === 0) {
      const streak = (await getWorkerStateInt(env.DB, 'clean_streak', 0)) + 1;
      if (streak >= 3 && batchSize < MAX_ADAPTIVE_BATCH) {
        batchSize = Math.min(MAX_ADAPTIVE_BATCH, batchSize + 1);
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO worker_state (key, value, updated_at) VALUES ('adaptive_batch_size', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          ).bind(String(batchSize), cycleStartMs),
          env.DB.prepare(
            `INSERT INTO worker_state (key, value, updated_at) VALUES ('clean_streak', '0', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          ).bind(cycleStartMs),
        ]);
      } else {
        await setWorkerStateInt(env.DB, 'clean_streak', streak, cycleStartMs);
      }
    }

    if (Date.now() - cycleStartMs < MAX_IO_WALL_MS - 3000) {
      await maybePruneOldJobs(env.DB, cycleStartMs);
    }

    return {
      ok: true,
      recoveredStaleLeases,
      enqueuedJobs,
      attemptedJobs: queueRes.attempted,
      sentJobs: queueRes.sent,
      failedJobs: queueRes.failed,
      cancelledJobs: queueRes.cancelled,
      releasedEarlyJobs: queueRes.releasedEarly,
      adaptiveBatchSize: batchSize,
    };
  } catch (err) {
    if (isD1QuotaOrTransientError(err)) {
      try {
        await setWorkerStateInt(
          env.DB,
          'd1_circuit_until',
          cycleStartMs + D1_CIRCUIT_COOLDOWN_MS,
          cycleStartMs
        );
      } catch {
        // Ignore if D1 quota is completely exhausted
      }
      return {
        ok: false,
        abortedReason: 'D1 quota or transient failure; aborted before dispatching unrecorded pushes.',
        recoveredStaleLeases,
        enqueuedJobs,
        attemptedJobs: 0,
        sentJobs: 0,
        failedJobs: 0,
        cancelledJobs: 0,
        releasedEarlyJobs: 0,
        adaptiveBatchSize: batchSize,
      };
    }

    return {
      ok: false,
      abortedReason: err instanceof Error ? err.message : 'Cron cycle error',
      recoveredStaleLeases,
      enqueuedJobs,
      attemptedJobs: 0,
      sentJobs: 0,
      failedJobs: 0,
      cancelledJobs: 0,
      releasedEarlyJobs: 0,
      adaptiveBatchSize: batchSize,
    };
  }
}
