-- ─────────────────────────────────────────────────────────────────────────────
-- BTLR — push_tokens table
-- Stores FCM/APNs device tokens per user so the server can send push notifications.
-- One row per device. Upserted on each app launch.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  token       text not null,
  platform    text not null check (platform in ('ios', 'android', 'web')),

  -- Audit
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Unique per user+token so upserts don't duplicate
create unique index if not exists push_tokens_user_token_idx
  on public.push_tokens(user_id, token);

create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

-- Keep updated_at fresh
drop trigger if exists push_tokens_updated_at on public.push_tokens;
create trigger push_tokens_updated_at
  before update on public.push_tokens
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
alter table public.push_tokens enable row level security;

create policy "push_tokens: select own"
  on public.push_tokens for select
  using (auth.uid() = user_id);

create policy "push_tokens: insert own"
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

create policy "push_tokens: update own"
  on public.push_tokens for update
  using (auth.uid() = user_id);

create policy "push_tokens: delete own"
  on public.push_tokens for delete
  using (auth.uid() = user_id);
