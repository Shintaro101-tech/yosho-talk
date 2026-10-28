-- 洋書トーク: database for accounts (Supabase).
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to run again (everything is "if not exists" / "or replace").

-- Plans: how much each kind of account may use per month.
-- The app shows only the talk time; the other limits are safety caps against misuse
-- (an ordinary reader never reaches them), so the dictionary and questions feel unlimited.
create table if not exists public.plans (
  id text primary key,
  label text not null,
  talk_minutes int not null,          -- GPT-Live talk time
  dict_calls int not null default 0,  -- dictionary look-ups
  ask_calls int not null default 0,   -- questions in the chat (表現について質問)
  feedback_calls int not null default 0, -- feedback after a talk
  visual_calls int not null default 0    -- photo keywords for word-book words (background, 40 words each)
);
alter table public.plans drop column if exists ai_calls;
alter table public.plans add column if not exists dict_calls int not null default 0;
alter table public.plans add column if not exists ask_calls int not null default 0;
alter table public.plans add column if not exists feedback_calls int not null default 0;
alter table public.plans add column if not exists visual_calls int not null default 0;
insert into public.plans (id, label, talk_minutes, dict_calls, ask_calls, feedback_calls, visual_calls) values
  ('free',     '無料',         0,   0,    0,    0,   0),    -- bookshelf, word book, photos only
  ('trial',    'お試し',       60,  1000, 300,  60,  100),  -- friends trying the app (invite code)
  ('light',    'ライト',       30,  1000, 300,  40,  100),  -- for the payment system later
  ('standard', 'スタンダード', 60,  1000, 300,  60,  100),
  ('admin',    '管理者',       600, 5000, 5000, 600, 1000)
on conflict (id) do update set label = excluded.label, talk_minutes = excluded.talk_minutes,
  dict_calls = excluded.dict_calls, ask_calls = excluded.ask_calls,
  feedback_calls = excluded.feedback_calls, visual_calls = excluded.visual_calls;

-- One row per account: the name the avatar uses, app settings, and the plan.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  settings jsonb not null default '{}',
  plan text not null default 'free' references public.plans,
  created_at timestamptz not null default now()
);

-- Books, words and talks, one row each (doc = the same object the app keeps).
create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('book', 'vocab', 'talk')),
  id text not null,
  doc jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

-- Monthly usage (Japan time), written only by the relay server.
create table if not exists public.usage (
  user_id uuid not null references auth.users on delete cascade,
  month text not null,                 -- '2026-10'
  talk_seconds int not null default 0,
  dict_calls int not null default 0,
  ask_calls int not null default 0,
  feedback_calls int not null default 0,
  visual_calls int not null default 0,
  primary key (user_id, month)
);
alter table public.usage drop column if exists ai_calls;
alter table public.usage add column if not exists dict_calls int not null default 0;
alter table public.usage add column if not exists ask_calls int not null default 0;
alter table public.usage add column if not exists feedback_calls int not null default 0;
alter table public.usage add column if not exists visual_calls int not null default 0;

-- A profile is created for every new account.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Adds talk seconds and/or one call of a job ('dict', 'ask', 'feedback', 'visual') to
-- this month's usage and returns the new totals (relay server only).
drop function if exists public.add_usage(uuid, text, int, int);
create or replace function public.add_usage(p_user uuid, p_month text, p_seconds int, p_job text default null)
returns public.usage language sql security definer set search_path = '' as $$
  insert into public.usage as u (user_id, month, talk_seconds, dict_calls, ask_calls, feedback_calls, visual_calls)
  values (p_user, p_month, greatest(p_seconds, 0),
    coalesce(p_job = 'dict', false)::int, coalesce(p_job = 'ask', false)::int, coalesce(p_job = 'feedback', false)::int, coalesce(p_job = 'visual', false)::int)
  on conflict (user_id, month) do update
    set talk_seconds = u.talk_seconds + greatest(p_seconds, 0),
        dict_calls = u.dict_calls + coalesce(p_job = 'dict', false)::int,
        ask_calls = u.ask_calls + coalesce(p_job = 'ask', false)::int,
        feedback_calls = u.feedback_calls + coalesce(p_job = 'feedback', false)::int,
        visual_calls = u.visual_calls + coalesce(p_job = 'visual', false)::int
  returning u.*;
$$;
revoke execute on function public.add_usage from public, anon, authenticated;
grant execute on function public.add_usage to service_role;

-- Row level security: each account sees and changes only its own rows.
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.usage enable row level security;

drop policy if exists "plans are readable" on public.plans;
create policy "plans are readable" on public.plans for select to authenticated using (true);

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- The plan can't be changed from the app (only the name and settings).
revoke update on public.profiles from authenticated;
grant update (name, settings) on public.profiles to authenticated;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own usage" on public.usage;
create policy "own usage" on public.usage for select to authenticated using (user_id = auth.uid());
