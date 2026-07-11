-- Squook — projects schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
-- (DDL can't be done with the service_role REST key, so it's a one-time manual step.)

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  prompt       text not null,
  format       text,
  preset       text,                              -- aspect/runtime preset (landscape | reel)
  genre        text not null default 'auto',      -- content preset (auto | educational | animation | images | custom-…)
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

-- Existing databases created before content presets: add the column in place.
-- (No-op once the column exists; safe to run alongside the create-table above.)
alter table public.projects add column if not exists genre text not null default 'auto';


-- ── Content presets (the "genre" dimension) ────────────────────────────────
-- A user's saved, reusable style. `bundle` is the full preset shape the flow
-- consumes (media_policy, theme, guidance, voice/music defaults). Built-in
-- presets live in code, not here — this table is only the user's own.
create table if not exists public.presets (
  id         text primary key,                    -- 'custom-xxxxxxxx' (assigned by the server)
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  bundle     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists presets_user_created_idx
  on public.presets (user_id, created_at desc);

alter table public.presets enable row level security;

drop policy if exists "presets_own_select" on public.presets;
create policy "presets_own_select" on public.presets
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "presets_own_insert" on public.presets;
create policy "presets_own_insert" on public.presets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "presets_own_update" on public.presets;
create policy "presets_own_update" on public.presets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "presets_own_delete" on public.presets;
create policy "presets_own_delete" on public.presets
  for delete to authenticated
  using ((select auth.uid()) = user_id);
