-- ─────────────────────────────────────────────────────────────────────────────
-- BTLR Monitoring Tables
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Error logs (app crashes, API failures)
create table if not exists error_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  error_type  text not null,           -- 'ui_crash' | 'api_error' | 'parse_error'
  message     text,
  stack       text,
  route       text,                    -- which page/endpoint
  metadata    jsonb default '{}',
  severity    text default 'error',    -- 'warning' | 'error' | 'critical'
  created_at  timestamptz default now()
);

-- Security events (auth anomalies, unusual access)
create table if not exists security_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  event_type  text not null,           -- 'failed_login' | 'unusual_access' | 'rate_limit' | 'admin_action'
  description text,
  ip_address  text,
  metadata    jsonb default '{}',
  severity    text default 'info',     -- 'info' | 'warning' | 'critical'
  created_at  timestamptz default now()
);

-- User feedback (in-app NPS, bug reports, feature requests)
create table if not exists user_feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  feedback_type text not null,         -- 'nps' | 'bug' | 'feature' | 'general'
  score        int,                    -- NPS score 0–10
  message      text,
  route        text,                   -- where in the app it was submitted
  metadata     jsonb default '{}',
  created_at   timestamptz default now()
);

-- User preferences (feature toggles, notification settings, UI prefs)
create table if not exists user_preferences (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users(id) on delete cascade unique,
  email_alerts          boolean default true,
  maintenance_reminders boolean default true,
  score_updates         boolean default true,
  repair_alerts         boolean default true,
  preferred_theme       text default 'light',
  onboarding_complete   boolean default false,
  metadata              jsonb default '{}',
  updated_at            timestamptz default now()
);

-- Platform health checks
create table if not exists health_checks (
  id          uuid primary key default gen_random_uuid(),
  status      text not null,           -- 'ok' | 'degraded' | 'down'
  db_ok       boolean default true,
  storage_ok  boolean default true,
  latency_ms  int,
  metadata    jsonb default '{}',
  checked_at  timestamptz default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table error_logs       enable row level security;
alter table security_events  enable row level security;
alter table user_feedback    enable row level security;
alter table user_preferences enable row level security;
alter table health_checks    enable row level security;

-- Service role only for error/security logs (admins see all, users see nothing directly)
create policy "Service role full access to error_logs"
  on error_logs for all using (auth.role() = 'service_role');

create policy "Service role full access to security_events"
  on security_events for all using (auth.role() = 'service_role');

-- Users can insert their own feedback, read their own
create policy "Users insert own feedback"
  on user_feedback for insert with check (auth.uid() = user_id);
create policy "Users read own feedback"
  on user_feedback for select using (auth.uid() = user_id);
create policy "Service role full access to feedback"
  on user_feedback for all using (auth.role() = 'service_role');

-- Users manage their own preferences
create policy "Users manage own preferences"
  on user_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Service role full access to preferences"
  on user_preferences for all using (auth.role() = 'service_role');

-- Health checks — service role only
create policy "Service role full access to health_checks"
  on health_checks for all using (auth.role() = 'service_role');

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_error_logs_created     on error_logs(created_at desc);
create index if not exists idx_error_logs_severity    on error_logs(severity);
create index if not exists idx_security_events_type   on security_events(event_type, created_at desc);
create index if not exists idx_user_preferences_uid   on user_preferences(user_id);
