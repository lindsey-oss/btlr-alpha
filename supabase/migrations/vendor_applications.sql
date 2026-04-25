-- Vendor network applications
-- Run in Supabase SQL Editor

create table if not exists vendor_applications (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  trade        text not null,
  name         text not null,
  company      text not null,
  email        text not null,
  phone        text,
  zip          text,
  status       text not null default 'pending'   -- pending | approved | rejected
);

-- Index for quick lookup by email or status
create index if not exists vendor_applications_email_idx  on vendor_applications (email);
create index if not exists vendor_applications_status_idx on vendor_applications (status);
create index if not exists vendor_applications_trade_idx  on vendor_applications (trade);

-- Allow anon inserts from the landing page (no auth required)
alter table vendor_applications enable row level security;

create policy "Anyone can apply"
  on vendor_applications for insert
  with check (true);

-- Only service role can read / update (you in the Supabase dashboard)
create policy "Service role full access"
  on vendor_applications for all
  using (auth.role() = 'service_role');
