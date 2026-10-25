-- 排程草案（2026-10-25）：每個旅程的每日安排。一筆一列，可連到旅程清單裡的地點（poi_id），也可以只寫標題（例：下飛機）。
-- data 內容：date（YYYY-MM-DD）、start／end（HH:MM，可空）、poi_id（可空）、title（可空）、note（可空）、order（同一天內的順序，沒有時間的項目用它排）

-- 旅程起訖日期（排程依日期列出每一天）
alter table public.trips add column if not exists start_date date;
alter table public.trips add column if not exists end_date date;
update public.trips set start_date = '2026-11-15', end_date = '2026-11-19' where id = 'tokyo-2026-11' and start_date is null;
update public.trips set start_date = '2027-03-05', end_date = '2027-03-10' where id = 'okayama-2027-03' and start_date is null;

create table if not exists public.schedule_items (
  id          text primary key,
  trip_id     text not null references public.trips (id),
  data        jsonb not null default '{}'::jsonb,
  version     integer not null default 1,
  updated_at  timestamptz not null default now()
);
create index if not exists schedule_items_trip_idx on public.schedule_items (trip_id);

drop trigger if exists schedule_items_bump_version on public.schedule_items;
create trigger schedule_items_bump_version
  before update on public.schedule_items
  for each row execute function public.pois_bump_version();

alter table public.schedule_items enable row level security;
drop policy if exists "signed-in users can read" on public.schedule_items;
create policy "signed-in users can read" on public.schedule_items for select to authenticated using (true);
drop policy if exists "signed-in users can insert" on public.schedule_items;
create policy "signed-in users can insert" on public.schedule_items for insert to authenticated with check (true);
drop policy if exists "signed-in users can update" on public.schedule_items;
create policy "signed-in users can update" on public.schedule_items for update to authenticated using (true) with check (true);
drop policy if exists "signed-in users can delete" on public.schedule_items;
create policy "signed-in users can delete" on public.schedule_items for delete to authenticated using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_items') then
    alter publication supabase_realtime add table public.schedule_items;
  end if;
end $$;
alter table public.schedule_items replica identity full;


-- 東京行程骨架的初始資料含同行者姓名，不放進公開 repo（另外執行）。
select (select count(*) from public.schedule_items) as sched, (select count(*) from public.trips where start_date is not null) as trips_with_dates;
