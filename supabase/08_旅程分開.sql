-- 旅程分開（2026-10-19）：地點資料庫（pois）所有旅程共用；每個旅程有自己的清單（trip_pois）。
-- 只屬於某次旅程的設定（期待度、目標、必去／已預約、封存、狀態）存在 trip_pois，不寫進地點資料庫。
-- 同一個地點下次旅行再加入時，查證過的資料（地址、營業時間、評分、座標、照片…）直接沿用。
--
-- 分兩段執行：
--   第一段（建立資料表＋搬資料）：不會改動舊資料，舊版 App 照常可用。
--   第二段（從地點資料庫移除旅程設定）：新版 App 上線後再執行。

-- ===== 第一段 =====

-- 旅程：用「年月＋目的地」區分，例如 2026/11 東京
create table if not exists public.trips (
  id          text primary key,
  name        text not null,                 -- 顯示名稱，例如「2026/11 東京」
  dest        text not null,                 -- 目的地
  ym          text not null,                 -- 年月，例如 2026-11
  center      jsonb,                         -- 地圖預設中心 [lat, lng]
  zoom        integer not null default 12,
  created_at  timestamptz not null default now()
);

-- 旅程清單：某個地點在某次旅程裡的設定
create table if not exists public.trip_pois (
  trip_id     text not null references public.trips (id),
  poi_id      text not null references public.pois (id),
  data        jsonb not null default '{}'::jsonb,   -- expectation、goals、must_go、archived、archive_date、archive_reason、status
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (trip_id, poi_id)
);

drop trigger if exists trip_pois_bump_version on public.trip_pois;
create trigger trip_pois_bump_version
  before update on public.trip_pois
  for each row execute function public.pois_bump_version();

-- 存取規則：和 pois 一樣，只有登入的使用者可以讀寫
alter table public.trips enable row level security;
alter table public.trip_pois enable row level security;

drop policy if exists "signed-in users can read" on public.trips;
create policy "signed-in users can read" on public.trips for select to authenticated using (true);
drop policy if exists "signed-in users can insert" on public.trips;
create policy "signed-in users can insert" on public.trips for insert to authenticated with check (true);
drop policy if exists "signed-in users can update" on public.trips;
create policy "signed-in users can update" on public.trips for update to authenticated using (true) with check (true);

drop policy if exists "signed-in users can read" on public.trip_pois;
create policy "signed-in users can read" on public.trip_pois for select to authenticated using (true);
drop policy if exists "signed-in users can insert" on public.trip_pois;
create policy "signed-in users can insert" on public.trip_pois for insert to authenticated with check (true);
drop policy if exists "signed-in users can update" on public.trip_pois;
create policy "signed-in users can update" on public.trip_pois for update to authenticated using (true) with check (true);
-- 「從這個旅程移除」＝刪掉旅程清單裡的那一列（地點資料保留）
drop policy if exists "signed-in users can delete" on public.trip_pois;
create policy "signed-in users can delete" on public.trip_pois for delete to authenticated using (true);

-- 即時同步
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips') then
    alter publication supabase_realtime add table public.trips;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_pois') then
    alter publication supabase_realtime add table public.trip_pois;
  end if;
end $$;
-- 刪除時即時同步需要舊資料的主鍵
alter table public.trip_pois replica identity full;

-- 建立現有的兩個旅程
insert into public.trips (id, name, dest, ym, center, zoom) values
  ('tokyo-2026-11', '2026/11 東京', '東京', '2026-11', '[35.69, 139.75]', 12),
  ('okayama-2027-03', '2027/03 岡山', '岡山', '2027-03', '[34.6661, 133.9185]', 9)
on conflict (id) do nothing;

-- 把目前每個地點的旅程設定搬到 2026/11 東京 的清單
insert into public.trip_pois (trip_id, poi_id, data)
select p.trip, p.id, jsonb_strip_nulls(jsonb_build_object(
  'expectation', p.data->'expectation',
  'goals', coalesce(p.data->'goals', '[]'::jsonb),
  'must_go', coalesce(p.data->'must_go', 'false'::jsonb),
  'archived', coalesce(p.data->'archived', 'false'::jsonb),
  'archive_date', p.data->'archive_date',
  'archive_reason', p.data->'archive_reason',
  'status', p.data->'status'))
from public.pois p
where p.trip = 'tokyo-2026-11'
on conflict (trip_id, poi_id) do nothing;

select (select count(*) from public.trips) as trips, (select count(*) from public.trip_pois) as trip_pois, (select count(*) from public.pois) as pois;

-- ===== 第二段：已改寫成 09_旅程分開_第二段.sql 並執行（2026-10-19）=====
-- update public.pois set data = data - 'expectation' - 'goals' - 'must_go' - 'archived' - 'archive_date' - 'archive_reason' - 'status' - 'trip';
