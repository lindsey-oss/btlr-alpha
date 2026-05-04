-- ─────────────────────────────────────────────────────────────────────────────
-- BTLR — maintenance_tasks table
-- Stores recurring home-maintenance tasks per property.
-- Seeded by the property-ages engine; can also be created manually.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.maintenance_tasks (
  id              uuid primary key default gen_random_uuid(),
  property_id     bigint not null references public.properties(id) on delete cascade,
  user_id         uuid   not null references auth.users(id)         on delete cascade,

  -- Task identity
  title           text   not null,
  category        text   not null,   -- 'HVAC' | 'Safety' | 'Plumbing' | 'Exterior' | 'Appliances' | 'Yard' | 'Pest' | ...
  cadence         text   not null,   -- human label e.g. 'Every 30 days' | 'Quarterly' | 'Annual'
  cadence_days    int,               -- machine-readable interval for snooze math (nullable = one-time)
  points          int    not null default 10,

  -- Scheduling
  due_date        date   not null,
  status          text   not null default 'planned'
                         check (status in ('overdue','due-soon','scheduled','booked','planned','done')),

  -- Optional vendor linkage
  vendor_name     text,
  vendor_id       uuid,              -- references saved_contacts if we have one

  -- Completion / snooze
  completed_at    timestamptz,
  snoozed_until   date,              -- set by snooze; clears when past

  -- Audit
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists maintenance_tasks_updated_at on public.maintenance_tasks;
create trigger maintenance_tasks_updated_at
  before update on public.maintenance_tasks
  for each row execute function public.set_updated_at();

-- Indexes
create index if not exists maintenance_tasks_property_idx on public.maintenance_tasks(property_id);
create index if not exists maintenance_tasks_user_idx     on public.maintenance_tasks(user_id);
create index if not exists maintenance_tasks_due_idx      on public.maintenance_tasks(due_date);
create index if not exists maintenance_tasks_status_idx   on public.maintenance_tasks(status);

-- ── Row-Level Security ────────────────────────────────────────────────────────
alter table public.maintenance_tasks enable row level security;

-- Users can only see and touch their own tasks
create policy "maintenance_tasks: select own"
  on public.maintenance_tasks for select
  using (auth.uid() = user_id);

create policy "maintenance_tasks: insert own"
  on public.maintenance_tasks for insert
  with check (auth.uid() = user_id);

create policy "maintenance_tasks: update own"
  on public.maintenance_tasks for update
  using (auth.uid() = user_id);

create policy "maintenance_tasks: delete own"
  on public.maintenance_tasks for delete
  using (auth.uid() = user_id);
