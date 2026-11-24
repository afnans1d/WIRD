-- Cloudflare D1 Schema for WIRD | وِرد Scheduled Web Push Worker
-- Optimized for due-task-driven scheduling (zero full-table scans on idle rows)

CREATE TABLE IF NOT EXISTS push_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  owner_token_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  morning_enabled INTEGER NOT NULL DEFAULT 1,
  evening_enabled INTEGER NOT NULL DEFAULT 1,
  morning_time TEXT NOT NULL DEFAULT '06:00',
  evening_time TEXT NOT NULL DEFAULT '17:30',
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 1,
  quiet_hours_start TEXT NOT NULL DEFAULT '23:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '04:30',
  completed_morning_date TEXT,
  completed_evening_date TEXT,
  next_morning_at INTEGER,
  next_evening_at INTEGER,
  last_test_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  deactivated_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subs_device
  ON push_subscriptions(device_id, is_active);

CREATE INDEX IF NOT EXISTS idx_subs_next_morning
  ON push_subscriptions(next_morning_at, subscription_id)
  WHERE is_active = 1 AND morning_enabled = 1 AND next_morning_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subs_next_evening
  ON push_subscriptions(next_evening_at, subscription_id)
  WHERE is_active = 1 AND evening_enabled = 1 AND next_evening_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_jobs (
  job_id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  subscription_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('morning', 'evening', 'test')),
  date_key TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_until INTEGER,
  next_retry_at INTEGER,
  http_status INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(subscription_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_due_pending
  ON delivery_jobs(status, scheduled_for, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_jobs_due_retry
  ON delivery_jobs(status, next_retry_at, created_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_stale_lease
  ON delivery_jobs(status, lease_until)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_jobs_device_recent
  ON delivery_jobs(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS worker_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO worker_state (key, value, updated_at)
VALUES
  ('adaptive_batch_size', '3', 0),
  ('clean_streak', '0', 0),
  ('last_prune_at', '0', 0),
  ('d1_circuit_until', '0', 0);
