-- 旅程分開第二段（2026-10-19，新版 App 上線、使用者確認正常後執行）
-- 1. 備註裡只屬於這次旅程的句子（期待度合計、已預約）搬到 2026/11 東京 清單的 status
update public.trip_pois set data = jsonb_set(data, '{status}', to_jsonb(coalesce(data->>'status', '') || '｜已預約 11/15（日）20:00，必去（使用者指定）'))
  where trip_id = 'tokyo-2026-11' and poi_id = 'poi_20261013_yoyofl' and coalesce(data->>'status', '') not like '%11/15%';
update public.trip_pois set data = jsonb_set(data, '{status}', to_jsonb(coalesce(data->>'status', '') || '｜2026-10-19 使用者指定：欣賞銀杏（原本期待度4）＋蕾絲銀杏御守+3＝合計7'))
  where trip_id = 'tokyo-2026-11' and poi_id = 'poi_007_97fc106f' and coalesce(data->>'status', '') not like '%合計7%';
update public.pois set data = jsonb_set(data, '{notes}', to_jsonb(replace(data->>'notes', '：欣賞銀杏含在原本期待度4，御守追加3，合計7', '')))
  where id = 'poi_007_97fc106f';
update public.pois set data = jsonb_set(data, '{notes}', to_jsonb(regexp_replace(data->>'notes', '使用者已預約 11/15（日）20:00，必去由使用者指定[。，；]?', '')))
  where id = 'poi_20261013_yoyofl';
update public.pois set data = jsonb_set(data, '{notes}', to_jsonb(replace(data->>'notes', '使用者2026-10-19新增：原本期待度4，目標「社群推薦冰拿鐵」+3，合計7。', '')))
  where id = 'poi_20261019_bongen';
update public.pois set data = jsonb_set(data, '{notes}', to_jsonb(replace(replace(data->>'notes', '使用者已預約 11/18 晚餐（必去、已預約晚餐+5 依使用者規則）。', ''), '原本期待度未填（使用者未提供），', '')))
  where id = 'poi_20261019_gyulem';
-- 2. 地點資料庫移除旅程欄位（已在第一段搬到 trip_pois）
update public.pois set data = data - 'expectation' - 'goals' - 'must_go' - 'archived' - 'archive_date' - 'archive_reason' - 'status' - 'trip'
  where data ?| array['expectation', 'goals', 'must_go', 'archived', 'archive_date', 'archive_reason', 'status', 'trip'];
-- 檢查：地點資料庫不應再有旅程欄位；清單筆數不變
select (select count(*) from public.pois where data ?| array['expectation', 'goals', 'must_go', 'archived', 'status']) as pois_with_trip_fields,
       (select count(*) from public.trip_pois where trip_id = 'tokyo-2026-11') as tokyo_list,
       (select count(*) from public.pois where data->>'notes' ~ '期待度|已預約|合計7') as notes_left,
       (select data->>'status' from public.trip_pois where poi_id = 'poi_20261013_yoyofl') as yoyofl_status;
