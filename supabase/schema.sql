-- 洋書トーク: database for accounts (Supabase).
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to run again (everything is "if not exists" / "or replace").

-- Plans: how much each kind of account may use per month.
create table if not exists public.plans (
  id text primary key,
  label text not null,
  talk_minutes int not null,   -- GPT-Live talk time per month
  ai_calls int not null        -- feedback, dictionary, chat, photo searches… per month
);
insert into public.plans (id, label, talk_minutes, ai_calls) values
  ('free',  '未登録',   0,    0),     -- signed up, no invite code / subscription yet
  ('trial', 'お試し',   60,   200),   -- friends trying the app (invite code)
  ('paid',  '有料プラン', 60,  200),   -- set by the payment system later
  ('admin', '管理者',   600,  5000)
on conflict (id) do nothing;

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
  ai_calls int not null default 0,
  primary key (user_id, month)
);

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

-- Adds to this month's usage and returns the new totals (relay server only).
create or replace function public.add_usage(p_user uuid, p_month text, p_seconds int, p_calls int)
returns public.usage language sql security definer set search_path = '' as $$
  insert into public.usage as u (user_id, month, talk_seconds, ai_calls)
  values (p_user, p_month, greatest(p_seconds, 0), greatest(p_calls, 0))
  on conflict (user_id, month) do update
    set talk_seconds = u.talk_seconds + greatest(p_seconds, 0),
        ai_calls = u.ai_calls + greatest(p_calls, 0)
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
