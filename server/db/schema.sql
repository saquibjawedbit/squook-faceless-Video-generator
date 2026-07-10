-- Squook — projects schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
-- (DDL can't be done with the service_role REST key, so it's a one-time manual step.)

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  prompt       text not null,
  format       text,
  preset       text,
  status       text not null default 'queued',   -- queued | running | done | failed
  stage        text,
  progress     int  not null default 0,
  error        text,
  storage_path text,                              -- <user_id>/<id>.mp4 in the `videos` bucket
  thumb_path   text,                              -- <user_id>/<id>.jpg
  duration_s   numeric,
  uploads      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists projects_user_created_idx
  on public.projects (user_id, created_at desc);

-- Row Level Security: a user can only ever see/change their own projects.
-- The Node worker uses the service_role key, which bypasses RLS; these policies
-- protect the table if it's ever reached directly with the publishable key.
alter table public.projects enable row level security;

drop policy if exists "projects_own_select" on public.projects;
create policy "projects_own_select" on public.projects
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "projects_own_insert" on public.projects;
create policy "projects_own_insert" on public.projects
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "projects_own_update" on public.projects;
create policy "projects_own_update" on public.projects
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "projects_own_delete" on public.projects;
create policy "projects_own_delete" on public.projects
  for delete to authenticated
  using ((select auth.uid()) = user_id);
