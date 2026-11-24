import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeNextDueUtcMs,
  getClockInTimezone,
  isWithinQuietHours,
  zonedDateTimeToUtcMs,
} from '../worker/src/timezone.ts';
import {
  base64UrlDecode,
  base64UrlEncode,
  createVapidJwt,
  decryptWebPushPayload,
  encryptWebPushPayload,
  isAllowedPushEndpoint,
} from '../worker/src/webpush.ts';
import { createWorkerApp } from '../worker/src/index.ts';
import { runCronCycle } from '../worker/src/scheduler.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  DeliveryJobRow,
  Env,
  PushSubscriptionRow,
} from '../worker/src/types.ts';

class MockD1Database implements D1Database {
  public subscriptions = new Map<string, PushSubscriptionRow>();
  public jobs = new Map<string, DeliveryJobRow>();
  public state = new Map<string, { key: string; value: string; updated_at: number }>([
    ['adaptive_batch_size', { key: 'adaptive_batch_size', value: '3', updated_at: 0 }],
    ['clean_streak', { key: 'clean_streak', value: '0', updated_at: 0 }],
    ['last_prune_at', { key: 'last_prune_at', value: '0', updated_at: 0 }],
    ['d1_circuit_until', { key: 'd1_circuit_until', value: '0', updated_at: 0 }],
  ]);
  public failNextWithQuotaError = false;
  public quotaErrorOnQuerySubstr: string | null = null;

  private checkError(sql: string) {
    if (this.failNextWithQuotaError) {
      this.failNextWithQuotaError = false;
      throw new Error('D1_ERROR: daily row write quota exceeded');
    }
    if (this.quotaErrorOnQuerySubstr && sql.includes(this.quotaErrorOnQuerySubstr)) {
      throw new Error('D1_ERROR: SQLITE_BUSY / quota limit reached');
    }
  }

  prepare(query: string): D1PreparedStatement {
    const db = this;
    const normalized = query.replace(/\s+/g, ' ').trim();
    let boundArgs: unknown[] = [];

    const stmt: D1PreparedStatement = {
      bind(...values: unknown[]) {
        boundArgs = values;
        return stmt;
      },
      async first<T = Record<string, unknown>>() {
        const res = await stmt.all<T>();
        return res.results[0] ?? null;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        db.checkError(normalized);
        return db.execute<T>(normalized, boundArgs);
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        db.checkError(normalized);
        return db.execute<T>(normalized, boundArgs);
      },
    };
    return stmt;
  }

  async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[]
  ): Promise<Array<D1Result<T>>> {
    const results: Array<D1Result<T>> = [];
    for (const s of statements) {
      results.push(await s.run<T>());
    }
    return results;
  }

  private execute<T>(sql: string, args: unknown[]): D1Result<T> {
    // worker_state
    if (sql.startsWith('SELECT value FROM worker_state WHERE key = ?')) {
      const row = this.state.get(String(args[0]));
      return { results: (row ? [{ value: row.value }] : []) as T[], success: true, meta: {} };
    }

    if (sql.startsWith('INSERT INTO worker_state')) {
      const hasStaticKey = sql.match(/VALUES \('([^']+)',/);
      if (hasStaticKey) {
        const key = hasStaticKey[1];
        if (args.length === 2) {
          this.state.set(key, { key, value: String(args[0]), updated_at: Number(args[1]) });
        } else {
          this.state.set(key, { key, value: '0', updated_at: Number(args[0]) });
        }
      } else {
        const [key, value, updatedAt] = args;
        this.state.set(String(key), {
          key: String(key),
          value: String(value),
          updated_at: Number(updatedAt),
        });
      }
      return { results: [], success: true, meta: { changes: 1 } };
    }

    // push_subscriptions lookups
    if (sql.startsWith('SELECT * FROM push_subscriptions WHERE device_id = ?')) {
      const rows = Array.from(this.subscriptions.values())
        .filter((s) => s.device_id === String(args[0]))
        .sort((a, b) => b.updated_at - a.updated_at);
      return { results: rows.slice(0, 1) as T[], success: true, meta: {} };
    }

    if (sql.startsWith('SELECT subscription_id, device_id, owner_token_hash FROM push_subscriptions WHERE endpoint = ?')) {
      const rows = Array.from(this.subscriptions.values()).filter(
        (s) => s.endpoint === String(args[0])
      );
      return { results: rows as T[], success: true, meta: {} };
    }

    if (sql.startsWith('SELECT * FROM push_subscriptions WHERE subscription_id = ?')) {
      const row = this.subscriptions.get(String(args[0]));
      return { results: (row ? [row] : []) as T[], success: true, meta: {} };
    }

    // Partial index due subscriptions query
    if (sql.includes('FROM push_subscriptions WHERE is_active = 1 AND morning_enabled = 1 AND next_morning_at IS NOT NULL AND next_morning_at <= ?')) {
      const nowMs = Number(args[0]);
      const limit = Number(args[1]);
      const rows = Array.from(this.subscriptions.values())
        .filter(
          (s) =>
            s.is_active === 1 &&
            s.morning_enabled === 1 &&
            s.next_morning_at !== null &&
            s.next_morning_at <= nowMs
        )
        .sort(
          (a, b) =>
            (a.next_morning_at! - b.next_morning_at!) ||
            a.subscription_id.localeCompare(b.subscription_id)
        )
        .slice(0, limit);
      return { results: rows as T[], success: true, meta: {} };
    }

    if (sql.includes('FROM push_subscriptions WHERE is_active = 1 AND evening_enabled = 1 AND next_evening_at IS NOT NULL AND next_evening_at <= ?')) {
      const nowMs = Number(args[0]);
      const limit = Number(args[1]);
      const rows = Array.from(this.subscriptions.values())
        .filter(
          (s) =>
            s.is_active === 1 &&
            s.evening_enabled === 1 &&
            s.next_evening_at !== null &&
            s.next_evening_at <= nowMs
        )
        .sort(
          (a, b) =>
            (a.next_evening_at! - b.next_evening_at!) ||
            a.subscription_id.localeCompare(b.subscription_id)
        )
        .slice(0, limit);
      return { results: rows as T[], success: true, meta: {} };
    }

    // Upsert subscription
    if (sql.startsWith('INSERT INTO push_subscriptions')) {
      const [
        subscription_id,
        device_id,
        owner_token_hash,
        endpoint,
        p256dh,
        auth,
        timezone,
        morning_enabled,
        evening_enabled,
        morning_time,
        evening_time,
        quiet_hours_enabled,
        quiet_hours_start,
        quiet_hours_end,
        completed_morning_date,
        completed_evening_date,
        next_morning_at,
        next_evening_at,
        created_at,
        updated_at,
      ] = args;

      const existing = this.subscriptions.get(String(subscription_id));
      const row: PushSubscriptionRow = {
        subscription_id: String(subscription_id),
        device_id: String(device_id),
        owner_token_hash: existing ? existing.owner_token_hash : String(owner_token_hash),
        endpoint: String(endpoint),
        p256dh: String(p256dh),
        auth: String(auth),
        timezone: String(timezone),
        morning_enabled: Number(morning_enabled),
        evening_enabled: Number(evening_enabled),
        morning_time: String(morning_time),
        evening_time: String(evening_time),
        quiet_hours_enabled: Number(quiet_hours_enabled),
        quiet_hours_start: String(quiet_hours_start),
        quiet_hours_end: String(quiet_hours_end),
        completed_morning_date: (completed_morning_date as string | null) ?? existing?.completed_morning_date ?? null,
        completed_evening_date: (completed_evening_date as string | null) ?? existing?.completed_evening_date ?? null,
        next_morning_at: (next_morning_at as number | null) ?? null,
        next_evening_at: (next_evening_at as number | null) ?? null,
        last_test_at: existing?.last_test_at ?? null,
        is_active: 1,
        deactivated_reason: null,
        created_at: existing?.created_at ?? Number(created_at),
        updated_at: Number(updated_at),
      };
      this.subscriptions.set(row.subscription_id, row);
      return { results: [], success: true, meta: { changes: 1 } };
    }

    // Update subscription fields
    if (sql.startsWith('UPDATE push_subscriptions SET next_morning_at = ?, updated_at = ? WHERE subscription_id = ?')) {
      const sub = this.subscriptions.get(String(args[2]));
      if (sub) {
        sub.next_morning_at = (args[0] as number | null) ?? null;
        sub.updated_at = Number(args[1]);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    }

    if (sql.startsWith('UPDATE push_subscriptions SET next_evening_at = ?, updated_at = ? WHERE subscription_id = ?')) {
      const sub = this.subscriptions.get(String(args[2]));
      if (sub) {
        sub.next_evening_at = (args[0] as number | null) ?? null;
        sub.updated_at = Number(args[1]);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    }

    if (sql.startsWith('UPDATE push_subscriptions SET timezone = ?')) {
      const sub = this.subscriptions.get(String(args[11]));
      if (sub) {
        sub.timezone = String(args[0]);
        sub.morning_enabled = Number(args[1]);
        sub.evening_enabled = Number(args[2]);
        sub.morning_time = String(args[3]);
        sub.evening_time = String(args[4]);
        sub.quiet_hours_enabled = Number(args[5]);
        sub.quiet_hours_start = String(args[6]);
        sub.quiet_hours_end = String(args[7]);
        sub.next_morning_at = (args[8] as number | null) ?? null;
        sub.next_evening_at = (args[9] as number | null) ?? null;
        sub.updated_at = Number(args[10]);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    }

    if (sql.startsWith('UPDATE push_subscriptions SET completed_morning_date = ?')) {
      const sub = this.subscriptions.get(String(args[3]));
      if (sub) {
        sub.completed_morning_date = (args[0] as string | null) ?? null;
        sub.next_morning_at = (args[1] as number | null) ?? null;
        sub.updated_at = Number(args[2]);
      }
      return { results: [], success: true, meta: { changes: sub ? 1 : 0 } };
    }

    if (sql.startsWith('UPDATE push_subscriptions SET completed_evening_date = ?')) {
      const sub = this.subscriptions.get(String(args[3]));
      if (sub) {
        sub.completed_evening_date = (args[0] as string | null) ?? null;
        sub.next_evening_at = (args[1] as number | null) ?? null;
        sub.updated_at = Number(args[2]);
      }
      return { results: [], success: true, meta: { changes: sub ? 1 : 0 } };
    }

    if (sql.startsWith("UPDATE push_subscriptions SET is_active = 0, deactivated_reason = 'user_unsubscribed'")) {
      const sub = this.subscriptions.get(String(args[1]));
      if (sub) {
        sub.is_active = 0;
        sub.deactivated_reason = 'user_unsubscribed';
        sub.next_morning_at = null;
        sub.next_evening_at = null;
        sub.updated_at = Number(args[0]);
      }
      return { results: [], success: true, meta: { changes: sub ? 1 : 0 } };
    }

    if (sql.startsWith('UPDATE push_subscriptions SET is_active = 0, deactivated_reason = ?')) {
      const sub = this.subscriptions.get(String(args[2]));
      if (sub) {
        sub.is_active = 0;
        sub.deactivated_reason = String(args[0]);
        sub.next_morning_at = null;
        sub.next_evening_at = null;
        sub.updated_at = Number(args[1]);
      }
      return { results: [], success: true, meta: { changes: sub ? 1 : 0 } };
    }

    if (sql.startsWith('UPDATE push_subscriptions SET last_test_at = ?, updated_at = ? WHERE subscription_id = ?')) {
      const sub = this.subscriptions.get(String(args[2]));
      if (sub) {
        sub.last_test_at = Number(args[0]);
        sub.updated_at = Number(args[1]);
      }
      return { results: [], success: true, meta: { changes: sub ? 1 : 0 } };
    }

    // delivery_jobs queries
    if (sql.includes("FROM delivery_jobs WHERE status = 'processing' AND lease_until IS NOT NULL AND lease_until < ?")) {
      const nowMs = Number(args[0]);
      const rows = Array.from(this.jobs.values())
        .filter((j) => j.status === 'processing' && j.lease_until !== null && j.lease_until < nowMs)
        .slice(0, 20);
      return { results: rows as T[], success: true, meta: {} };
    }

    if (sql.includes("FROM delivery_jobs WHERE status = 'pending' AND scheduled_for <= ?")) {
      const nowMs = Number(args[0]);
      const limit = Number(args[1]);
      const rows = Array.from(this.jobs.values())
        .filter((j) => j.status === 'pending' && j.scheduled_for <= nowMs)
        .sort((a, b) => (a.scheduled_for - b.scheduled_for) || (a.created_at - b.created_at))
        .slice(0, limit);
      return { results: rows as T[], success: true, meta: {} };
    }

    if (sql.includes("FROM delivery_jobs WHERE status = 'failed' AND attempts < max_attempts")) {
      const nowMs = Number(args[0]);
      const limit = Number(args[1]);
      const rows = Array.from(this.jobs.values())
        .filter(
          (j) =>
            j.status === 'failed' &&
            j.attempts < j.max_attempts &&
            j.next_retry_at !== null &&
            j.next_retry_at <= nowMs
        )
        .sort((a, b) => (a.next_retry_at! - b.next_retry_at!) || (a.created_at - b.created_at))
        .slice(0, limit);
      return { results: rows as T[], success: true, meta: {} };
    }

    if (sql.includes('FROM delivery_jobs WHERE device_id = ?')) {
      const rows = Array.from(this.jobs.values())
        .filter((j) => j.device_id === String(args[0]))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 20);
      return { results: rows as T[], success: true, meta: {} };
    }

    // INSERT OR IGNORE delivery_jobs
    if (sql.startsWith('INSERT OR IGNORE INTO delivery_jobs')) {
      const [
        job_id,
        job_key,
        subscription_id,
        device_id,
        period,
        date_key,
        scheduled_for,
        created_at,
        updated_at,
      ] = args;
      const duplicateKey = Array.from(this.jobs.values()).some((j) => j.job_key === String(job_key));
      if (duplicateKey) {
        return { results: [], success: true, meta: { changes: 0 } };
      }
      const row: DeliveryJobRow = {
        job_id: String(job_id),
        job_key: String(job_key),
        subscription_id: String(subscription_id),
        device_id: String(device_id),
        period: period as DeliveryJobRow['period'],
        date_key: String(date_key),
        scheduled_for: Number(scheduled_for),
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
        lease_until: null,
        next_retry_at: null,
        http_status: null,
        last_error: null,
        created_at: Number(created_at),
        updated_at: Number(updated_at),
        sent_at: null,
      };
      this.jobs.set(row.job_id, row);
      return { results: [], success: true, meta: { changes: 1 } };
    }

    // Immediate/scheduled test job INSERT INTO delivery_jobs
    if (sql.startsWith('INSERT INTO delivery_jobs') && sql.includes("'sent'")) {
      throw new Error('Unexpected SQL');
    }
    if (sql.startsWith('INSERT INTO delivery_jobs')) {
      if (sql.includes("VALUES (?, ?, ?, ?, 'test', ?, ?, 'pending'")) {
        const [job_id, job_key, subscription_id, device_id, date_key, scheduled_for, created_at, updated_at] = args;
        const row: DeliveryJobRow = {
          job_id: String(job_id),
          job_key: String(job_key),
          subscription_id: String(subscription_id),
          device_id: String(device_id),
          period: 'test',
          date_key: String(date_key),
          scheduled_for: Number(scheduled_for),
          status: 'pending',
          attempts: 0,
          max_attempts: 3,
          lease_until: null,
          next_retry_at: null,
          http_status: null,
          last_error: null,
          created_at: Number(created_at),
          updated_at: Number(updated_at),
          sent_at: null,
        };
        this.jobs.set(row.job_id, row);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      const [
        job_id,
        job_key,
        subscription_id,
        device_id,
        date_key,
        scheduled_for,
        status,
        http_status,
        last_error,
        created_at,
        updated_at,
        sent_at,
      ] = args;
      const row: DeliveryJobRow = {
        job_id: String(job_id),
        job_key: String(job_key),
        subscription_id: String(subscription_id),
        device_id: String(device_id),
        period: 'test',
        date_key: String(date_key),
        scheduled_for: Number(scheduled_for),
        status: status as DeliveryJobRow['status'],
        attempts: 1,
        max_attempts: 1,
        lease_until: null,
        next_retry_at: null,
        http_status: (http_status as number | null) ?? null,
        last_error: (last_error as string | null) ?? null,
        created_at: Number(created_at),
        updated_at: Number(updated_at),
        sent_at: (sent_at as number | null) ?? null,
      };
      this.jobs.set(row.job_id, row);
      return { results: [], success: true, meta: { changes: 1 } };
    }

    // delivery_jobs updates
    if (sql.startsWith("UPDATE delivery_jobs SET status = 'processing'")) {
      const [lease_until, updated_at, job_id, nowMs] = args;
      const job = this.jobs.get(String(job_id));
      if (
        job &&
        (job.status === 'pending' ||
          (job.status === 'failed' && job.next_retry_at !== null && job.next_retry_at <= Number(nowMs)))
      ) {
        job.status = 'processing';
        job.lease_until = Number(lease_until);
        job.updated_at = Number(updated_at);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    }

    if (sql.startsWith("UPDATE delivery_jobs SET status = 'sent'")) {
      const [http_status, sent_at, updated_at, job_id] = args;
      const job = this.jobs.get(String(job_id));
      if (job) {
        job.status = 'sent';
        job.http_status = Number(http_status);
        job.last_error = null;
        job.lease_until = null;
        job.next_retry_at = null;
        job.sent_at = Number(sent_at);
        job.updated_at = Number(updated_at);
      }
      return { results: [], success: true, meta: { changes: job ? 1 : 0 } };
    }

    if (sql.startsWith("UPDATE delivery_jobs SET status = 'failed', attempts = ?, http_status = ?")) {
      const [attempts, http_status, last_error, next_retry_at, updated_at, job_id] = args;
      const job = this.jobs.get(String(job_id));
      if (job) {
        job.status = 'failed';
        job.attempts = Number(attempts);
        job.http_status = (http_status as number | null) ?? null;
        job.last_error = String(last_error);
        job.lease_until = null;
        job.next_retry_at = (next_retry_at as number | null) ?? null;
        job.updated_at = Number(updated_at);
      }
      return { results: [], success: true, meta: { changes: job ? 1 : 0 } };
    }

    if (sql.startsWith("UPDATE delivery_jobs SET status = 'failed', attempts = ?, lease_until = NULL")) {
      const [attempts, last_error, updated_at, job_id] = args;
      const job = this.jobs.get(String(job_id));
      if (job && job.status === 'processing') {
        job.status = 'failed';
        job.attempts = Number(attempts);
        job.lease_until = null;
        job.next_retry_at = null;
        job.last_error = String(last_error);
        job.updated_at = Number(updated_at);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    }

    if (sql.startsWith("UPDATE delivery_jobs SET status = 'pending', attempts = ?, lease_until = NULL")) {
      const [attempts, last_error, updated_at, job_id] = args;
      const job = this.jobs.get(String(job_id));
      if (job && job.status === 'processing') {
        job.status = 'pending';
        job.attempts = Number(attempts);
        job.lease_until = null;
        job.last_error = String(last_error);
        job.updated_at = Number(updated_at);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    }

    if (sql.startsWith("UPDATE delivery_jobs SET status = 'pending', lease_until = NULL")) {
      const [updated_at, job_id] = args;
      const job = this.jobs.get(String(job_id));
      if (job && job.status === 'processing') {
        job.status = 'pending';
        job.lease_until = null;
        job.updated_at = Number(updated_at);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    }

    if (sql.startsWith("UPDATE delivery_jobs SET status = 'cancelled', last_error = 'user_unsubscribed'")) {
      const [updated_at, sub_id] = args;
      let changes = 0;
      for (const job of this.jobs.values()) {
        if (job.subscription_id === String(sub_id) && (job.status === 'pending' || job.status === 'failed')) {
          job.status = 'cancelled';
          job.last_error = 'user_unsubscribed';
          job.lease_until = null;
          job.updated_at = Number(updated_at);
          changes++;
        }
      }
      return { results: [], success: true, meta: { changes } };
    }

    if (sql.startsWith("UPDATE delivery_jobs SET status = 'cancelled'")) {
      const [last_error, updated_at, job_id] = args;
      const job = this.jobs.get(String(job_id));
      if (job) {
        job.status = 'cancelled';
        job.lease_until = null;
        job.last_error = String(last_error);
        job.updated_at = Number(updated_at);
      }
      return { results: [], success: true, meta: { changes: job ? 1 : 0 } };
    }

    if (sql.startsWith('DELETE FROM delivery_jobs')) {
      const cutoff = Number(args[0]);
      let deleted = 0;
      for (const [id, job] of Array.from(this.jobs.entries())) {
        if (
          (job.status === 'sent' || job.status === 'failed' || job.status === 'cancelled') &&
          job.created_at < cutoff
        ) {
          this.jobs.delete(id);
          deleted++;
          if (deleted >= 50) break;
        }
      }
      return { results: [], success: true, meta: { changes: deleted } };
    }

    throw new Error(`Unhandled SQL in MockD1Database: ${sql}`);
  }
}

async function generateVapidTestPair() {
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    publicKey: base64UrlEncode(pubRaw),
    privateKey: jwk.d!,
    verifyPublicKey: kp.publicKey,
  };
}

async function generateUaPushKeys() {
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )) as CryptoKeyPair;
  const pubRawBuf = await crypto.subtle.exportKey('raw', kp.publicKey);
  const pubRaw = new Uint8Array(pubRawBuf.slice(0));
  const auth = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return {
    privateKey: kp.privateKey,
    publicKeyBytes: pubRaw,
    authBytes: auth,
    p256dh: base64UrlEncode(pubRaw),
    auth: base64UrlEncode(auth),
  };
}

test('Web Push RFC 8292 VAPID ES256 signature & RFC 8291 aes128gcm Arabic payload round-trip', async () => {
  const vapid = await generateVapidTestPair();
  const ua = await generateUaPushKeys();
  const endpoint = 'https://web.push.apple.com/QABCD1234567890';

  const jwt = await createVapidJwt({
    endpoint,
    vapidSubject: 'mailto:admin@wird.app',
    vapidPublicKey: vapid.publicKey,
    vapidPrivateKey: vapid.privateKey,
    nowSeconds: 1_760_000_000,
  });

  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:admin@wird.app');

  const sigValid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.verifyPublicKey,
    base64UrlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  assert.equal(sigValid, true);

  const original = JSON.stringify({
    title: 'وِرد · أذكار الصباح',
    body: 'صباح الخير ☀️ حان وقت أذكار الصباح حفظك الله',
    url: '/?session=morning',
  });
  const encrypted = await encryptWebPushPayload(original, ua.p256dh, ua.auth);
  const decrypted = await decryptWebPushPayload(
    encrypted,
    ua.privateKey,
    ua.publicKeyBytes,
    ua.authBytes
  );
  assert.equal(decrypted, original);
});

test('Endpoint SSRF allowlist accepts Apple APNs / FCM / Mozilla and rejects unsafe endpoints', () => {
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/Q123456'), true);
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz'), true);
  assert.equal(isAllowedPushEndpoint('http://web.push.apple.com/Q123456'), false);
  assert.equal(isAllowedPushEndpoint('https://localhost:3000/push'), false);
  assert.equal(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedPushEndpoint('https://evil.example.com/steal-vapid'), false);
});

test('Timezone & DST scheduling handles Asia/Riyadh midnight boundary and DST spring/fall transitions', () => {
  // 21:15 UTC on 2026-05-01 is 00:15 on 2026-05-02 in Asia/Riyadh (UTC+3)
  const riyadhClock = getClockInTimezone('Asia/Riyadh', Date.UTC(2026, 4, 1, 21, 15, 0));
  assert.equal(riyadhClock.dateKey, '2026-05-02');
  assert.equal(riyadhClock.hhmm, '00:15');

  // Morning 06:00 in Asia/Riyadh on 2026-05-02 == 03:00 UTC
  const riyadhMorningUtc = zonedDateTimeToUtcMs('Asia/Riyadh', '2026-05-02', '06:00');
  assert.equal(riyadhMorningUtc, Date.UTC(2026, 4, 2, 3, 0, 0));

  // Quiet hours crossing midnight 23:00 -> 04:30
  assert.equal(isWithinQuietHours('00:15', '23:00', '04:30'), true);
  assert.equal(isWithinQuietHours('05:30', '23:00', '04:30'), false);

  // Europe/London DST Spring Forward: 2026-03-29 clocks jump 01:00 -> 02:00 BST (UTC+1)
  // 06:00 BST on 2026-03-29 must resolve to 05:00 UTC (NOT 06:00 UTC)
  const londonDstSpring = zonedDateTimeToUtcMs('Europe/London', '2026-03-29', '06:00');
  assert.equal(londonDstSpring, Date.UTC(2026, 2, 29, 5, 0, 0));

  // Europe/London DST Fall Back: 2026-10-25 clocks fall back to GMT (UTC+0)
  // 06:00 GMT on 2026-10-25 must resolve to 06:00 UTC
  const londonDstFall = zonedDateTimeToUtcMs('Europe/London', '2026-10-25', '06:00');
  assert.equal(londonDstFall, Date.UTC(2026, 9, 25, 6, 0, 0));

  // Completed today skips to tomorrow
  const nextMorning = computeNextDueUtcMs({
    enabled: true,
    timeHHMM: '06:00',
    timezone: 'Asia/Riyadh',
    nowMs: Date.UTC(2026, 4, 2, 2, 0, 0), // 05:00 Riyadh before 06:00
    completedDateKey: '2026-05-02',
  });
  assert.equal(nextMorning, Date.UTC(2026, 4, 3, 3, 0, 0));
});

test('Worker API ownership authentication blocks missing/wrong X-Device-Token and prevents hijacking', async () => {
  const db = new MockD1Database();
  const vapid = await generateVapidTestPair();
  const ua = await generateUaPushKeys();
  const app = createWorkerApp();

  const env: Env = {
    DB: db,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:admin@wird.app',
    CRON_SECRET: 'cron_super_secret_123456',
    ALLOWED_ORIGINS: 'https://gen-lang-client-0521174523.web.app',
  };

  const tokenA = 'device_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const tokenB = 'device_secret_bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  // Reject missing token
  const noTok = await app.fetch(
    new Request('https://worker.example/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'dev_iphone_user_1',
        subscription: {
          endpoint: 'https://web.push.apple.com/Qdevice1',
          keys: { p256dh: ua.p256dh, auth: ua.auth },
        },
        preferences: {
          timezone: 'Asia/Riyadh',
          morningEnabled: true,
          eveningEnabled: true,
          morningTime: '06:00',
          eveningTime: '17:30',
          quietHoursEnabled: true,
          quietHoursStart: '23:00',
          quietHoursEnd: '04:30',
        },
      }),
    }),
    env
  );
  assert.equal(noTok.status, 401);

  // Register device with tokenA
  const subOk = await app.fetch(
    new Request('https://worker.example/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': tokenA,
      },
      body: JSON.stringify({
        deviceId: 'dev_iphone_user_1',
        subscription: {
          endpoint: 'https://web.push.apple.com/Qdevice1',
          keys: { p256dh: ua.p256dh, auth: ua.auth },
        },
        preferences: {
          timezone: 'Asia/Riyadh',
          morningEnabled: true,
          eveningEnabled: true,
          morningTime: '06:00',
          eveningTime: '17:30',
          quietHoursEnabled: true,
          quietHoursStart: '23:00',
          quietHoursEnd: '04:30',
        },
      }),
    }),
    env
  );
  assert.equal(subOk.status, 200);

  // Attacker with wrong tokenB cannot read deliveries, change prefs, or unsubscribe
  const hijackedPrefs = await app.fetch(
    new Request('https://worker.example/api/push/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': tokenB,
      },
      body: JSON.stringify({
        deviceId: 'dev_iphone_user_1',
        preferences: {
          timezone: 'Asia/Riyadh',
          morningEnabled: false,
          eveningEnabled: false,
          morningTime: '06:00',
          eveningTime: '17:30',
          quietHoursEnabled: false,
          quietHoursStart: '23:00',
          quietHoursEnd: '04:30',
        },
      }),
    }),
    env
  );
  assert.equal(hijackedPrefs.status, 403);

  const hijackedDeliveries = await app.fetch(
    new Request('https://worker.example/api/push/deliveries?deviceId=dev_iphone_user_1', {
      headers: { 'X-Device-Token': tokenB },
    }),
    env
  );
  assert.equal(hijackedDeliveries.status, 403);
});

test('Due-task Cron scheduling sends once per period, skips quiet/completed, recovers stale leases, and handles 410 + D1 quota errors', async () => {
  const db = new MockD1Database();
  const vapid = await generateVapidTestPair();
  const ua = await generateUaPushKeys();

  const dueAt = Date.UTC(2026, 4, 2, 3, 0, 0); // 06:00 Asia/Riyadh
  const cronNow = Date.UTC(2026, 4, 2, 3, 1, 0); // 06:01 Asia/Riyadh

  // Seed active due subscription (06:00 Riyadh) + idle future subscription (tomorrow)
  db.subscriptions.set('sub_due', {
    subscription_id: 'sub_due',
    device_id: 'dev_due',
    owner_token_hash: 'hash_due',
    endpoint: 'https://web.push.apple.com/QdueUser',
    p256dh: ua.p256dh,
    auth: ua.auth,
    timezone: 'Asia/Riyadh',
    morning_enabled: 1,
    evening_enabled: 1,
    morning_time: '06:00',
    evening_time: '17:30',
    quiet_hours_enabled: 1,
    quiet_hours_start: '23:00',
    quiet_hours_end: '04:30',
    completed_morning_date: null,
    completed_evening_date: null,
    next_morning_at: dueAt,
    next_evening_at: Date.UTC(2026, 4, 2, 14, 30, 0),
    last_test_at: null,
    is_active: 1,
    deactivated_reason: null,
    created_at: dueAt - 10_000,
    updated_at: dueAt - 10_000,
  });

  db.subscriptions.set('sub_idle', {
    ...db.subscriptions.get('sub_due')!,
    subscription_id: 'sub_idle',
    device_id: 'dev_idle',
    endpoint: 'https://web.push.apple.com/QidleUser',
    next_morning_at: dueAt + 86_400_000,
  });

  let pushPosts = 0;
  const mockFetch: typeof fetch = async (_input, _init) => {
    pushPosts++;
    return new Response(null, { status: 201 });
  };

  const env: Env = {
    DB: db,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:admin@wird.app',
  };

  // Run 1: enqueues only sub_due, sends 1 push, advances next_morning_at to tomorrow
  const cycle1 = await runCronCycle(env, { nowMs: cronNow, fetchFn: mockFetch });
  assert.equal(cycle1.ok, true);
  assert.equal(cycle1.enqueuedJobs, 1);
  assert.equal(cycle1.sentJobs, 1);
  assert.equal(pushPosts, 1);
  assert.equal(db.subscriptions.get('sub_due')?.next_morning_at, dueAt + 86_400_000);

  // Run 2 at 06:02: must NOT duplicate
  const cycle2 = await runCronCycle(env, { nowMs: cronNow + 60_000, fetchFn: mockFetch });
  assert.equal(cycle2.enqueuedJobs, 0);
  assert.equal(cycle2.sentJobs, 0);
  assert.equal(pushPosts, 1);

  // Simulate stale crashed lease + adaptive batch reduction
  db.jobs.set('job_stale_test', {
    job_id: 'job_stale_test',
    job_key: 'test:sub_due:stale',
    subscription_id: 'sub_due',
    device_id: 'dev_due',
    period: 'test',
    date_key: '2026-05-02',
    scheduled_for: cronNow - 180_000,
    status: 'processing',
    attempts: 0,
    max_attempts: 3,
    lease_until: cronNow - 10_000, // expired
    next_retry_at: null,
    http_status: null,
    last_error: null,
    created_at: cronNow - 180_000,
    updated_at: cronNow - 180_000,
    sent_at: null,
  });

  const cycle3 = await runCronCycle(env, { nowMs: cronNow + 120_000, fetchFn: mockFetch });
  assert.equal(cycle3.recoveredStaleLeases, 1);
  assert.equal(cycle3.adaptiveBatchSize, 1); // halved from 3 -> 1
  assert.equal(cycle3.sentJobs, 1);
  assert.equal(db.jobs.get('job_stale_test')?.status, 'sent');

  // Simulate D1 quota failure BEFORE push dispatch: must abort without calling fetch
  db.jobs.set('job_quota_guard', {
    job_id: 'job_quota_guard',
    job_key: 'test:sub_due:quota_guard',
    subscription_id: 'sub_due',
    device_id: 'dev_due',
    period: 'test',
    date_key: '2026-05-02',
    scheduled_for: cronNow,
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    lease_until: null,
    next_retry_at: null,
    http_status: null,
    last_error: null,
    created_at: cronNow,
    updated_at: cronNow,
    sent_at: null,
  });
  const countBeforeQuota = pushPosts;
  db.quotaErrorOnQuerySubstr = "WHERE status = 'pending'";
  const quotaCycle = await runCronCycle(env, { nowMs: cronNow + 180_000, fetchFn: mockFetch });
  db.quotaErrorOnQuerySubstr = null;
  assert.equal(quotaCycle.ok, false);
  assert.equal(pushPosts, countBeforeQuota);
  assert.equal(db.jobs.get('job_quota_guard')?.status, 'pending');

  // Clear D1 circuit backoff and simulate 410 Gone deactivating subscription permanently
  db.state.set('d1_circuit_until', { key: 'd1_circuit_until', value: '0', updated_at: 0 });
  const cycle410 = await runCronCycle(env, {
    nowMs: cronNow + 240_000,
    fetchFn: async () => new Response('Gone', { status: 410 }),
  });
  assert.equal(cycle410.failedJobs, 1);
  assert.equal(db.jobs.get('job_quota_guard')?.status, 'failed');
  assert.equal(db.subscriptions.get('sub_due')?.is_active, 0);
  assert.equal(db.subscriptions.get('sub_due')?.next_morning_at, null);
  assert.equal(db.subscriptions.get('sub_due')?.next_evening_at, null);
});
