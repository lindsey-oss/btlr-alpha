-- ─────────────────────────────────────────────────────────────────────────────
-- BTLR — notification_prefs table
-- One row per user. Stores trigger toggles and channel toggles.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.notification_prefs (
  user_id               uuid primary key references auth.users(id) on delete cascade,

  -- Trigger toggles
  overdue_maintenance   boolean not null default true,
  due_soon              boolean not null default true,
  score_change          boolean not null default true,
  vendor_reply          boolean not null default true,
  weekly_digest         boolean not null default false,
  monthly_report        boolean not null default true,

  -- Channel toggles
  channel_email         boolean not null default true,
  channel_sms           boolean not null default false,   -- disabled until Twilio is wired
  channel_push          boolean not null default false,   -- disabled until mobile app ships

  -- Audit
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists notification_prefs_updated_at on public.notification_prefs;
create trigger notification_prefs_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
alter table public.notification_prefs enable row level security;

create policy "notification_prefs: select own"
  on public.notification_prefs for select
  using (auth.uid() = user_id);

create policy "notification_prefs: insert own"
  on public.notification_prefs for insert
  with check (auth.uid() = user_id);

create policy "notification_prefs: update own"
  on public.notification_prefs for update
  using (auth.uid() = user_id);
