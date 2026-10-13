-- 旅行決策 App：建立資料表與存取規則
-- 在 Supabase 的 SQL Editor 貼上全部內容後按 Run（只需要執行一次）。
--
-- 設計：一筆候選一列。欄位內容整份放在 data（JSON），跟舊版 Artifact 資料庫一樣，
-- 欄位定義沿用 `Claude outputs/schema.json`。trip 用來區分不同旅行（例如 tokyo-2026-11）。
-- version 每次修改 +1，寫入時比對版本，避免手機和 Claude 同時修改時互相覆蓋。

create table if not exists public.pois (
  id          text primary key,
  trip        text not null default 'tokyo-2026-11',
  data        jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now()
);

create index if not exists pois_trip_idx on public.pois (trip);

-- 每次更新自動把 version +1、更新時間改成現在
create or replace function public.pois_bump_version()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists pois_bump_version on public.pois;
create trigger pois_bump_version
  before update on public.pois
  for each row execute function public.pois_bump_version();

-- 存取規則：只有登入的使用者可以讀寫；沒登入的人（包括知道網址的人）什麼都看不到。
-- 請同時在 Authentication 設定裡關閉「Allow new users to sign up」，帳號只由你自己在後台建立。
alter table public.pois enable row level security;

drop policy if exists "signed-in users can read" on public.pois;
create policy "signed-in users can read" on public.pois
  for select to authenticated using (true);

drop policy if exists "signed-in users can insert" on public.pois;
create policy "signed-in users can insert" on public.pois
  for insert to authenticated with check (true);

drop policy if exists "signed-in users can update" on public.pois;
create policy "signed-in users can update" on public.pois
  for update to authenticated using (true) with check (true);

-- 不開放刪除：不要的候選用「封存」處理。

-- 即時同步：Claude 或另一台裝置改了資料，App 不用重新整理就會更新
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pois'
  ) then
    alter publication supabase_realtime add table public.pois;
  end if;
end $$;
