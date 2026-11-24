export type AdhkarPeriod = 'morning' | 'evening';
export type JobPeriod = AdhkarPeriod | 'test';
export type JobStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface D1Meta {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
}

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
  noRetry?: () => void;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  CRON_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  ALLOW_LOCAL_ORIGINS?: string;
  GRACE_MINUTES?: string;
}

export interface PushSubscriptionRow {
  subscription_id: string;
  device_id: string;
  owner_token_hash: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone: string;
  morning_enabled: number;
  evening_enabled: number;
  morning_time: string;
  evening_time: string;
  quiet_hours_enabled: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  completed_morning_date: string | null;
  completed_evening_date: string | null;
  next_morning_at: number | null;
  next_evening_at: number | null;
  last_test_at: number | null;
  is_active: number;
  deactivated_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface DeliveryJobRow {
  job_id: string;
  job_key: string;
  subscription_id: string;
  device_id: string;
  period: JobPeriod;
  date_key: string;
  scheduled_for: number;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  lease_until: number | null;
  next_retry_at: number | null;
  http_status: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
}

export interface SchedulePreferencesInput {
  timezone: string;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  morningTime: string;
  eveningTime: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}
